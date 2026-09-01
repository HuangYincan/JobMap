// Validate and dedupe recruitment source companies before a DB upsert.
// Live insert waits on DATABASE_URL + migrations 002/006. Tests cover
// the dry-run path only.

import { createHash } from 'node:crypto';
import { getPool } from './db.ts';
import type {
  RecruitmentAdapter,
  SourceCompany,
  SourceFileDiagnostic,
  SourcePosition,
} from './recruitment-source.ts';
import { TIER_DEFAULT } from './lod.ts';
import { bossAdapter } from './recruitment-adapters/boss.ts';
import { embodiedJobsAdapter } from './recruitment-adapters/embodied-jobs.ts';
import { nowcoderAdapter } from './recruitment-adapters/nowcoder.ts';
import { officialCareerAdapter } from './recruitment-adapters/official-career.ts';
import { qqdocJobsAdapter } from './recruitment-adapters/qqdoc-jobs.ts';
import { qqdocOfficialAdapter } from './recruitment-adapters/qqdoc-official.ts';
import { radarAdapter } from './recruitment-adapters/radar.ts';
import { shixisengAdapter } from './recruitment-adapters/shixiseng.ts';
import { isAuthenticPositionRecord } from './freshness.ts';
import { HANGZHOU_DISTRICTS } from './spatial-filters.ts';
import type { CompanySite, JobTaxonomy } from './types.ts';
import { sourceMetadataFor, SOURCE_META } from './recruitment-provenance.ts';
import { listAdapter } from './recruitment-source.ts';

export interface ImportIssue {
  slug: string;
  field: string;
  message: string;
}

export interface ImportPlan {
  companies: SourceCompany[];
  issues: ImportIssue[];
  dropped: number;
  diagnostics?: SourceFileDiagnostic[];
  /** False means at least one source input was not a complete snapshot. */
  complete?: boolean;
}

const FAMILIES = new Set(['intern', 'campus', 'social']);
const SCALES = new Set(['startup', 'unicorn', 'bigtech', 'enterprise']);
const STATUSES = new Set(['open', 'closed', 'paused']);
const SOURCE_CODE_RE = /^[a-z][a-z0-9-]*$/;

function issue(slug: string, field: string, message: string): ImportIssue {
  return { slug, field, message };
}

/**
 * URL 语义校验：scheme、主机和 pathname 必须可解析；拒绝重复 scheme、dot
 * path segment，以及 HTML 文件后继续拼接另一段路径。HTTP URL 能被 URL
 * 构造器接受并不代表它是可用投递链接，因此这里保留路径级质量闸门。
 */
export function hasValidUrlScheme(raw: string | null | undefined): boolean {
  if (!raw) return true;
  if (raw.trim() !== raw || !/^https?:\/\//i.test(raw) || /^https?:\/\/https?:\/\//i.test(raw)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!parsed.hostname) return false;

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return false;
  const htmlFile = /\.(?:html?|shtml?)$/i;
  const fileIndex = segments.findIndex((segment) => htmlFile.test(segment));
  return fileIndex === -1 || fileIndex === segments.length - 1;
}

/** 首批目标城市（tech/18 D2）。地址解析只认这些城市的名字。 */
const TARGET_CITIES = ['北京', '上海', '广州', '深圳', '成都', '武汉', '杭州'] as const;

/**
 * site 城市名（写入 company_sites.city）：site.city 字段优先（WS2 drop 形状）；
 * 否则从 location.address 解析 —— 地址等于目标城市名、以「城市名+市」开头，
 * 或以杭州区名开头（'西湖区龙井路1号' → 杭州）。多城市文本（'北京/上海'）与
 * 无法识别地址返回 null（保持现状，不猜）。
 */
export function siteCityOf(site: CompanySite): string | null {
  const city = site.city?.trim();
  if (city) return city;
  const address = site.location?.address?.trim();
  if (!address) return null;
  for (const name of TARGET_CITIES) {
    if (address === name || address.startsWith(`${name}市`)) return name;
  }
  if (HANGZHOU_DISTRICTS.some((district) => address.startsWith(district.value))) return '杭州';
  return null;
}

export function validateSourceCompany(company: SourceCompany): ImportIssue[] {
  const slug = company.slug?.trim() || '(missing-slug)';
  const issues: ImportIssue[] = [];
  if (!company.slug?.trim()) issues.push(issue(slug, 'slug', 'required'));
  if (!company.name?.trim()) issues.push(issue(slug, 'name', 'required'));
  if (!Array.isArray(company.industries) || company.industries.length === 0) {
    issues.push(issue(slug, 'industries', 'need at least one'));
  }
  if (company.scale && !SCALES.has(company.scale)) {
    issues.push(issue(slug, 'scale', `unknown ${company.scale}`));
  }
  if (company.tier !== undefined && !(Number.isInteger(company.tier) && company.tier >= 0 && company.tier <= 21)) {
    issues.push(issue(slug, 'tier', `unknown ${company.tier}`));
  }
  if (company.source !== undefined && !SOURCE_CODE_RE.test(company.source)) {
    issues.push(issue(slug, 'source', 'must match sources.code ^[a-z][a-z0-9-]*$'));
  }
  if (!hasValidUrlScheme(company.careerUrl)) {
    issues.push(issue(slug, 'careerUrl', 'must start with http(s):// and have no repeated scheme'));
  }
  if (!hasValidUrlScheme(company.logoUrl)) {
    issues.push(issue(slug, 'logoUrl', 'must start with http(s):// and have no repeated scheme'));
  }
  if (!company.sites.length) issues.push(issue(slug, 'sites', 'need at least one site'));

  const siteIds = new Set<string>();
  for (const site of company.sites) {
    if (!site.id?.trim()) issues.push(issue(slug, 'sites.id', 'required'));
    else if (siteIds.has(site.id)) issues.push(issue(slug, 'sites.id', `duplicate ${site.id}`));
    else siteIds.add(site.id);
    const loc = site.location;
    if (loc) {
      // Address-only sites are valid (pending geocode); validate only present coords.
      if (loc.lng !== undefined && (!Number.isFinite(loc.lng) || loc.lng < -180 || loc.lng > 180)) {
        issues.push(issue(slug, 'sites.lng', `invalid ${loc.lng}`));
      }
      if (loc.lat !== undefined && (!Number.isFinite(loc.lat) || loc.lat < -90 || loc.lat > 90)) {
        issues.push(issue(slug, 'sites.lat', `invalid ${loc.lat}`));
      }
    }
    if (!hasValidUrlScheme(site.careerUrl)) issues.push(issue(slug, 'sites.careerUrl', 'invalid url scheme'));
    if (!hasValidUrlScheme(site.logoUrl)) issues.push(issue(slug, 'sites.logoUrl', 'invalid url scheme'));
  }

  const externals = new Set<string>();
  for (const pos of company.positions) {
    const problems = validatePosition(pos, siteIds);
    for (const field of problems) issues.push(issue(slug, field, 'invalid'));
    if (pos.externalId && externals.has(pos.externalId)) {
      issues.push(issue(slug, 'positions.externalId', `duplicate ${pos.externalId}`));
    } else if (pos.externalId) {
      externals.add(pos.externalId);
    }
  }
  return issues;
}

function validatePosition(pos: SourcePosition, siteIds: Set<string>): string[] {
  const bad: string[] = [];
  if (!pos.externalId?.trim()) bad.push('positions.externalId');
  if (!pos.title?.trim()) bad.push('positions.title');
  if (!FAMILIES.has(pos.family)) bad.push('positions.family');
  if (!STATUSES.has(pos.status)) bad.push('positions.status');
  if (!pos.siteId || !siteIds.has(pos.siteId)) bad.push('positions.siteId');
  if (!hasValidUrlScheme(pos.applyUrl)) bad.push('positions.applyUrl');
  // positions.deadline is a date column; non-ISO deadlines crash the apply.
  if (pos.deadline && normalizeDeadline(pos.deadline) === null) bad.push('positions.deadline');
  return bad;
}

/** Keep the first company per slug; merge extra sites/positions onto it. */
export function dedupeSourceCompanies(input: SourceCompany[]): SourceCompany[] {
  const bySlug = new Map<string, SourceCompany>();
  for (const raw of input) {
    const slug = raw.slug.trim();
    const existing = bySlug.get(slug);
    if (!existing) {
      bySlug.set(slug, cloneCompany(raw));
      continue;
    }
    mergeCompany(existing, raw);
  }
  return [...bySlug.values()];
}

function cloneCompany(company: SourceCompany): SourceCompany {
  const companySource = company.source;
  return {
    ...company,
    industries: [...company.industries],
    sites: company.sites.map((site) => ({
      ...site,
      source: site.source ?? companySource,
      location: site.location ? { ...site.location } : undefined,
    })),
    positions: company.positions.map((pos) => ({
      ...pos,
      source: pos.source ?? companySource,
      majors: pos.majors ? [...pos.majors] : undefined,
      skills: pos.skills ? [...pos.skills] : undefined,
    })),
  };
}

function mergeCompany(target: SourceCompany, extra: SourceCompany): void {
  // logo 合并 (2026-08-19 Bug2): 非空不覆盖 — dedupe 保留第一个公司
  // (真实 drops 先行、seed 垫底), seed 的 logoUrl/logoEmoji 补上 drops 的
  // 空缺, 但不覆盖 drop 自带值 (drop 与 seed 均可提供)。
  if (!target.logoUrl && extra.logoUrl) target.logoUrl = extra.logoUrl;
  if (!target.logoEmoji && extra.logoEmoji) target.logoEmoji = extra.logoEmoji;
  for (const site of extra.sites) {
    if (!target.sites.some((row) => row.id === site.id)) {
      target.sites.push({
        ...site,
        source: site.source ?? extra.source,
        location: site.location ? { ...site.location } : undefined,
      });
    }
  }
  const seen = new Set(target.positions.map((pos) => pos.externalId));
  for (const pos of extra.positions) {
    if (!seen.has(pos.externalId)) {
      target.positions.push({
        ...pos,
        source: pos.source ?? extra.source,
        majors: pos.majors ? [...pos.majors] : undefined,
        skills: pos.skills ? [...pos.skills] : undefined,
      });
      seen.add(pos.externalId);
    }
  }
}

export function planRecruitmentImport(input: SourceCompany[]): ImportPlan {
  const merged = dedupeSourceCompanies(input);
  const issues: ImportIssue[] = [];
  const companies: SourceCompany[] = [];
  for (const company of merged) {
    const found = validateSourceCompany(company);
    if (found.length) {
      issues.push(...found);
      continue;
    }
    companies.push(company);
  }
  return {
    companies,
    issues,
    dropped: merged.length - companies.length,
    diagnostics: [],
    complete: true,
  };
}

export async function planSeedImport(): Promise<ImportPlan> {
  const adapters: RecruitmentAdapter[] = [
    qqdocOfficialAdapter(),
    qqdocJobsAdapter(),
    officialCareerAdapter(),
    bossAdapter(),
    nowcoderAdapter(),
    shixisengAdapter(),
    radarAdapter(),
    embodiedJobsAdapter(),
  ];
  const batches = await Promise.all(adapters.map((adapter) => listAdapter(adapter)));
  const [qqdocOfficial, qqdocJobs, official, boss, nowcoder, shixiseng, radar, embodiedJobs] = batches.map(
    (batch) => batch.companies,
  );
  // 严格 DB-only(2026-08-26): seed 示例数据已归档 tech/backup/seed-data,
  // 不再作为灌库数据源; 仅真实 drop(radar/portal/qqdoc/official/embodied 等)入库。
  const plan = planRecruitmentImport([
    ...embodiedJobs,
    ...qqdocOfficial,
    ...qqdocJobs,
    ...official,
    ...radar,
    ...boss,
    ...nowcoder,
    ...shixiseng,
  ]);
  // 数据策略 (2026-08-19): 公司有 portal-* 官方直爬岗位时, 抑制其 radar-*
  // 聚合行。radar 是快照聚合 (合成岗位, 非真实 JD); 官方 ATS 直爬是雇主录入
  // 的真实岗位 —— 同 slug 并存时后者优先 (dedupe 已保官方站点/坐标)。
  return suppressRadarForPortalCompanies({
    ...plan,
    diagnostics: batches.flatMap((batch) => batch.diagnostics),
    complete: batches.every((batch) => batch.completeness === 'complete'),
  });
}

/** 有 portal-* 真实岗位的公司 → 丢弃同公司的 radar-* 快照行 (2026-08-19)。 */
export function suppressRadarForPortalCompanies(plan: ImportPlan): ImportPlan {
  const companies = plan.companies.map((company) => {
    const hasPortal = company.positions.some((pos) => pos.externalId.startsWith('portal-'));
    if (!hasPortal) return company;
    return {
      ...company,
      positions: company.positions.filter((pos) => !pos.externalId.startsWith('radar-')),
    };
  });
  return { ...plan, companies };
}

export async function planOfficialCareerImport(dir?: string): Promise<ImportPlan> {
  const batch = await listAdapter(officialCareerAdapter(dir));
  const plan = planRecruitmentImport(batch.companies);
  return {
    ...plan,
    diagnostics: batch.diagnostics,
    complete: batch.completeness === 'complete',
  };
}

export interface ImportApplyResult {
  wrote: boolean;
  reason?: 'no-database' | 'empty-plan' | 'incomplete-input';
  companies: number;
  sites: number;
  positions: number;
}

type ApplyDbClient = {
  query<T = { id: string }>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};

type ApplyDbPool = {
  connect(): Promise<ApplyDbClient>;
};

/**
 * Normalize a position deadline to an ISO date or null (positions.deadline is a
 * date column). Mirrors crawler parse_deadline: YYYY[-/ .]MM[-/ .]DD, delimiters
 * optional; calendar-invalid dates and human text ("招满即止") → null.
 */
function normalizeDeadline(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})\s*[-/.]?\s*(\d{1,2})\s*[-/.]?\s*(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return null;
  }
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Position taxonomy jsonb payload: keep the drop's family (and any other
 * taxonomy fields) and carry the aggregate flag so the DB read path can
 * show aggregate rows honestly. Family must never be dropped.
 */
export function positionTaxonomy(pos: SourcePosition): JobTaxonomy {
  return {
    ...(pos.taxonomy ?? { family: pos.family }),
    ...(pos.aggregate ? { aggregate: true } : {}),
  };
}

const IMPORT_INPUT_VERSION = 'recruitment-plan-v1';
const IMPORT_PARSER_VERSION = 'recruitment-import/2.0.0';

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Return a source-supplied timestamp without inventing one at apply time. */
function normalizeAuditTimestamp(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

interface AuditPosition {
  companySlug: string;
  siteId: string;
  position: SourcePosition;
  sourceCode: string;
  retrievedAt: string;
  expiresAt: string | null;
  contentHash: string;
  recordVersion: string;
}

interface AuditFailure {
  externalId: string;
  companySlug: string;
  sourceCode: string;
  reason: string;
}

interface AuditSourceBatch {
  records: AuditPosition[];
  failures: AuditFailure[];
}

function effectiveSource(position: SourcePosition, company: SourceCompany): string {
  return position.source?.trim() || company.source?.trim() || 'seed';
}

function prepareAudit(plan: SourceCompany[]): Map<string, AuditSourceBatch> {
  const batches = new Map<string, AuditSourceBatch>();
  const ensure = (sourceCode: string): AuditSourceBatch => {
    const existing = batches.get(sourceCode);
    if (existing) return existing;
    const created: AuditSourceBatch = { records: [], failures: [] };
    batches.set(sourceCode, created);
    return created;
  };

  for (const company of plan) {
    // A source with no eligible positions still gets a zero-record import run;
    // that makes an empty/filtered batch observable without fabricating records.
    ensure(company.source?.trim() || 'seed');
    for (const site of company.sites) ensure(site.source?.trim() || company.source?.trim() || 'seed');
    for (const position of company.positions) {
      const sourceCode = effectiveSource(position, company);
      const batch = ensure(sourceCode);
      const retrievedAt = normalizeAuditTimestamp(position.retrievedAt);
      const expiresAt = normalizeAuditTimestamp(position.expiresAt);
      if (!retrievedAt) {
        batch.failures.push({
          externalId: position.externalId,
          companySlug: company.slug,
          sourceCode,
          reason: 'missing-or-invalid-retrievedAt',
        });
        continue;
      }
      if (position.expiresAt && !expiresAt) {
        batch.failures.push({
          externalId: position.externalId,
          companySlug: company.slug,
          sourceCode,
          reason: 'invalid-expiresAt',
        });
        continue;
      }
      const evidence = {
        entityType: 'position',
        companySlug: company.slug,
        siteId: position.siteId,
        externalId: position.externalId,
        source: sourceCode,
        title: position.title,
        family: position.family,
        status: position.status,
      };
      const contentHash = hashJson({ source: sourceCode, position });
      batch.records.push({
        companySlug: company.slug,
        siteId: position.siteId,
        position,
        sourceCode,
        retrievedAt,
        expiresAt,
        contentHash,
        recordVersion: `${IMPORT_PARSER_VERSION}:${contentHash.slice(0, 24)}`,
      });
      // Keep this object construction adjacent to hashing: normalized evidence
      // is recreated from the same source fields when source_records is written.
      void evidence;
    }
  }
  return batches;
}

/** Upsert a validated plan and leave an auditable import/source-record chain. */
export async function applyRecruitmentImport(
  plan: ImportPlan,
  pool: ApplyDbPool | null = getPool(),
): Promise<ImportApplyResult> {
  if (plan.companies.length === 0) {
    return { wrote: false, reason: 'empty-plan', companies: 0, sites: 0, positions: 0 };
  }
  // Authenticity is source-provenance driven. official-career retains its
  // historical portal-* compatibility rule; embodied-jobs is approved by its
  // registered source policy, so embj-* is not silently discarded.
  const authentic = plan.companies.map((company) => ({
    ...company,
    positions: company.positions.filter((pos) =>
      isAuthenticPositionRecord({ externalId: pos.externalId, source: effectiveSource(pos, company) }),
    ),
  }));
  if (!pool) {
    return {
      wrote: false,
      reason: 'no-database',
      companies: authentic.length,
      sites: authentic.reduce((n, c) => n + c.sites.length, 0),
      positions: authentic.reduce((n, c) => n + c.positions.length, 0),
    };
  }
  // planSeedImport is an all-source snapshot. If any adapter could not produce
  // a complete snapshot, keep all validated records available for diagnostics
  // planSeedImport is an all-source snapshot. If any adapter could not produce
  // a complete snapshot, keep all validated records available for diagnostics
  // but refuse the entire DB apply. The explicit `true` check also fails closed
  // for legacy or hand-built plans that do not carry completeness evidence.
  // This prevents a missing/broken optional drop directory from being interpreted
  // as a legitimate empty snapshot and triggering stale-row reconciliation. A
  // future per-source lifecycle runner may narrow this gate once it can isolate
  // reconciliation by source.
  if (plan.complete !== true) {
    return {
      wrote: false,
      reason: 'incomplete-input',
      companies: authentic.length,
      sites: authentic.reduce((n, company) => n + company.sites.length, 0),
      positions: authentic.reduce((n, company) => n + company.positions.length, 0),
    };
  }

  const audit = prepareAudit(authentic);
  const client = await pool.connect();
  const sourceIds = new Map<string, string>();
  const runIds = new Map<string, string>();
  let pluginManifestId = '';
  let companies = 0;
  let sites = 0;
  let positions = 0;

  const sourceIdFor = async (code: string): Promise<string> => {
    const cached = sourceIds.get(code);
    if (cached) return cached;
    const meta = sourceMetadataFor(code);
    const source = await client.query<{ id: string }>(
      `INSERT INTO sources (
         code, origin_uri, authorization_basis, allowed_access_method,
         attribution_text, retention_policy, deletion_policy
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET origin_uri = EXCLUDED.origin_uri
       RETURNING id::text`,
      [code, meta.originUri, meta.authorizationBasis, meta.accessMethod, meta.attribution, meta.retention, meta.deletion],
    );
    const id = source.rows[0]?.id;
    if (!id) throw new Error(`source upsert returned no id for ${code}`);
    sourceIds.set(code, id);
    return id;
  };

  const runFor = async (code: string): Promise<string> => {
    const cached = runIds.get(code);
    if (cached) return cached;
    const sourceId = await sourceIdFor(code);
    const batch = audit.get(code) ?? { records: [], failures: [] };
    const inputHash = hashJson({
      inputVersion: IMPORT_INPUT_VERSION,
      source: code,
      records: batch.records.map((record) => ({ recordVersion: record.recordVersion, contentHash: record.contentHash })),
      failures: batch.failures,
    });
    const recordCount = batch.records.length + batch.failures.length;
    const run = await client.query<{ id: string }>(
      `INSERT INTO import_runs (
         source_id, plugin_manifest_id, status, input_version, input_hash,
         parser_version, record_count, success_count, failure_count, failures
       ) VALUES ($1, $2, 'running', $3, $4, $5, $6, 0, $7, $8::jsonb)
       ON CONFLICT (source_id, plugin_manifest_id, input_hash, parser_version)
       DO UPDATE SET
         status = 'running', started_at = now(), finished_at = NULL,
         input_version = EXCLUDED.input_version, record_count = EXCLUDED.record_count,
         success_count = 0, failure_count = EXCLUDED.failure_count,
         failures = EXCLUDED.failures
       RETURNING id::text`,
      [sourceId, pluginManifestId, IMPORT_INPUT_VERSION, inputHash, IMPORT_PARSER_VERSION, recordCount, batch.failures.length, JSON.stringify(batch.failures)],
    );
    const id = run.rows[0]?.id;
    if (!id) throw new Error(`import run upsert returned no id for ${code}`);
    runIds.set(code, id);
    return id;
  };

  const finalizeRuns = async (status: 'succeeded' | 'failed', failedBatch = false): Promise<void> => {
    for (const [code, runId] of runIds) {
      const batch = audit.get(code) ?? { records: [], failures: [] };
      const failureCount = failedBatch ? batch.records.length + batch.failures.length : batch.failures.length;
      const failures = failedBatch
        ? [...batch.failures, ...batch.records.map((record) => ({
            externalId: record.position.externalId,
            companySlug: record.companySlug,
            sourceCode: code,
            reason: 'transaction-rolled-back',
          }))]
        : batch.failures;
      const successCount = failedBatch ? 0 : batch.records.length;
      // A batch that had any failed record is audited as 'failed' even when the
      // business transaction itself committed — the run row keeps the exact
      // success/failure counts for the partial-success distinction.
      const finalStatus = failureCount > 0 ? 'failed' : status;
      await client.query(
        `UPDATE import_runs
            SET status = $2, finished_at = now(), success_count = $3,
                failure_count = $4, record_count = $5, failures = $6::jsonb
          WHERE id = $1`,
        [runId, finalStatus, successCount, failureCount, batch.records.length + batch.failures.length, JSON.stringify(failures)],
      );
    }
  };

  try {
    // Resolve the plugin and source rows in a short setup transaction. The run
    // rows must commit before business writes so a later rollback can record a
    // durable failed batch instead of rolling the audit row away too.
    await client.query('BEGIN');
    const manifest = await client.query<{ id: string }>(
      `INSERT INTO plugin_manifests (
         code, version, owner_kind, entity_type, item_type, capabilities, data_policy
       ) VALUES ('recruitment', '1.0.0', 'platform', 'company', 'position',
                 ARRAY['seed-import', 'spatial-query', 'map-render']::text[], '{}'::jsonb)
       ON CONFLICT (code, version) DO UPDATE SET data_policy = EXCLUDED.data_policy
       RETURNING id::text`,
    );
    pluginManifestId = manifest.rows[0]?.id ?? '';
    if (!pluginManifestId) throw new Error('plugin manifest upsert returned no id');
    for (const code of audit.keys()) await runFor(code);
    await client.query('COMMIT');

    await client.query('BEGIN');

    // Per-source cleanup only removes duplicate rows that already have the same
    // provenance. It deliberately does not migrate a row from another source:
    // that old behavior was the provenance corruption this importer is fixing.
    for (const [code, batch] of audit) {
      const ids = [...new Set(batch.records.map((record) => record.position.externalId))];
      if (ids.length === 0) continue;
      const sourceId = await sourceIdFor(code);
      await client.query(
        `DELETE FROM positions p
          USING (
            SELECT source_id, external_id, MIN(id) AS keep_id
              FROM positions
             WHERE source_id = $2 AND external_id = ANY($1::text[])
             GROUP BY source_id, external_id
          ) keep
         WHERE p.source_id = keep.source_id
           AND p.external_id = keep.external_id
           AND p.id <> keep.keep_id`,
        [ids, sourceId],
      );
    }

    const auditByPosition = new Map<SourcePosition, AuditPosition>();
    for (const batch of audit.values()) {
      for (const record of batch.records) auditByPosition.set(record.position, record);
    }

    for (const company of authentic) {
      const upserted = await client.query<{ id: string }>(
        `INSERT INTO companies (slug, name, industries, scale, rating, summary, career_url, logo_url, logo_emoji, tier, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           industries = EXCLUDED.industries,
           scale = EXCLUDED.scale,
           rating = EXCLUDED.rating,
           summary = EXCLUDED.summary,
           career_url = EXCLUDED.career_url,
           logo_url = COALESCE(EXCLUDED.logo_url, companies.logo_url),
           logo_emoji = COALESCE(EXCLUDED.logo_emoji, companies.logo_emoji),
           tier = EXCLUDED.tier,
           category = EXCLUDED.category,
           updated_at = now()
         RETURNING id::text`,
        [
          company.slug,
          company.name,
          company.industries,
          company.scale ?? null,
          company.rating ?? null,
          company.summary ?? null,
          company.careerUrl ?? null,
          company.logoUrl ?? null,
          company.logoEmoji ?? null,
          company.tier ?? TIER_DEFAULT,
          company.category ?? 'other',
        ],
      );
      const companyId = upserted.rows[0]?.id;
      if (!companyId) throw new Error(`company upsert returned no id for ${company.slug}`);
      companies += 1;

      const siteIds = new Map<string, string>();
      for (const site of company.sites) {
        const siteCity = siteCityOf(site);
        const siteSourceId = await sourceIdFor(site.source?.trim() || company.source?.trim() || 'seed');
        const existing = await client.query<{ id: string }>(
          `SELECT id::text FROM company_sites WHERE company_id = $1 AND site_key = $2 LIMIT 1`,
          [companyId, site.id],
        );
        let siteRowId = existing.rows[0]?.id;
        if (!siteRowId) {
          const legacy = await client.query<{ id: string }>(
            `SELECT id::text FROM company_sites
              WHERE company_id = $1 AND name = $2 AND site_key IS NULL
                AND city IS NOT DISTINCT FROM $3
              LIMIT 1`,
            [companyId, site.name, siteCity],
          );
          if (legacy.rows[0]) {
            siteRowId = legacy.rows[0].id;
            await client.query(
              `UPDATE company_sites SET site_key = $3 WHERE id = $1 AND company_id = $2`,
              [siteRowId, companyId, site.id],
            );
          }
        }
        if (!siteRowId) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO company_sites (company_id, name, site_key, address, city, province, city_code, lng, lat, career_url, logo_url, source_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id::text`,
            [
              companyId,
              site.name,
              site.id,
              site.location?.address ?? null,
              siteCity,
              site.province ?? null,
              site.cityCode ?? null,
              site.location?.lng ?? null,
              site.location?.lat ?? null,
              site.careerUrl ?? null,
              site.logoUrl ?? null,
              siteSourceId,
            ],
          );
          siteRowId = inserted.rows[0]?.id;
        } else {
          await client.query(
            `UPDATE company_sites SET
               site_key = $3,
               address = $4, city = $5, province = $6, city_code = $7,
               lng = COALESCE($8, lng), lat = COALESCE($9, lat),
               career_url = $10, logo_url = $11, source_id = $12, updated_at = now()
             WHERE id = $1 AND company_id = $2`,
            [
              siteRowId,
              companyId,
              site.id,
              site.location?.address ?? null,
              siteCity,
              site.province ?? null,
              site.cityCode ?? null,
              site.location?.lng ?? null,
              site.location?.lat ?? null,
              site.careerUrl ?? null,
              site.logoUrl ?? null,
              siteSourceId,
            ],
          );
        }
        if (!siteRowId) throw new Error(`site upsert returned no id for ${company.slug}/${site.id}`);
        siteIds.set(site.id, siteRowId);
        sites += 1;
      }

      for (const pos of company.positions) {
        const siteRowId = siteIds.get(pos.siteId);
        const record = auditByPosition.get(pos);
        // No source retrieval timestamp means no source_record and no position
        // write. This is an explicit auditable failure, never `now()`.
        if (!siteRowId || !record) continue;
        const sourceId = await sourceIdFor(record.sourceCode);
        const runId = await runFor(record.sourceCode);
        const evidence = {
          entityType: 'position',
          companySlug: company.slug,
          siteId: pos.siteId,
          externalId: pos.externalId,
          source: record.sourceCode,
          title: pos.title,
          family: pos.family,
          status: pos.status,
        };
        await client.query(
          `INSERT INTO source_records (
             source_id, import_run_id, external_id, record_version, retrieved_at,
             content_hash, parser_version, original_payload, normalized_evidence
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
           ON CONFLICT (source_id, external_id, record_version) DO UPDATE SET
             import_run_id = EXCLUDED.import_run_id,
             retrieved_at = EXCLUDED.retrieved_at,
             content_hash = EXCLUDED.content_hash,
             parser_version = EXCLUDED.parser_version,
             original_payload = EXCLUDED.original_payload,
             normalized_evidence = EXCLUDED.normalized_evidence`,
          [
            sourceId,
            runId,
            pos.externalId,
            record.recordVersion,
            record.retrievedAt,
            record.contentHash,
            IMPORT_PARSER_VERSION,
            JSON.stringify(pos),
            JSON.stringify(evidence),
          ],
        );
        await client.query(
          `INSERT INTO positions (
             company_id, site_id, external_id, title, department, family, taxonomy,
             salary_min, salary_max, education, majors, skills, description, deadline,
             apply_source, apply_url, status, source_id, retrieved_at, expires_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7::jsonb,
             $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20
           )
           ON CONFLICT (source_id, external_id) DO UPDATE SET
             title = EXCLUDED.title,
             department = EXCLUDED.department,
             family = EXCLUDED.family,
             taxonomy = EXCLUDED.taxonomy,
             salary_min = EXCLUDED.salary_min,
             salary_max = EXCLUDED.salary_max,
             education = EXCLUDED.education,
             majors = EXCLUDED.majors,
             skills = EXCLUDED.skills,
             description = EXCLUDED.description,
             deadline = EXCLUDED.deadline,
             apply_source = EXCLUDED.apply_source,
             apply_url = EXCLUDED.apply_url,
             status = EXCLUDED.status,
             site_id = EXCLUDED.site_id,
             retrieved_at = EXCLUDED.retrieved_at,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()`,
          [
            companyId,
            siteRowId,
            pos.externalId,
            pos.title,
            pos.department ?? null,
            pos.family,
            JSON.stringify(positionTaxonomy(pos)),
            pos.salary?.min ?? null,
            pos.salary?.max ?? null,
            pos.education ?? null,
            pos.majors ?? [],
            pos.skills ?? [],
            pos.description ?? null,
            pos.deadline ? normalizeDeadline(pos.deadline) : null,
            pos.applySource ?? null,
            pos.applyUrl ?? null,
            pos.status,
            sourceId,
            record.retrievedAt,
            record.expiresAt,
          ],
        );
        positions += 1;
      }
    }
    // A complete, failure-free source batch is an authoritative snapshot for
    // that source. Rows absent from it become explicit closed/expired
    // tombstones; rows from other sources are never touched. Any record-level
    // audit failure skips reconciliation for the whole source, even when other
    // records from that source were valid.
    for (const [code, batch] of audit) {
      if (batch.failures.length > 0) continue;
      const sourceId = await sourceIdFor(code);
      const externalIds = [...new Set(batch.records.map((record) => record.position.externalId))];
      const absent = externalIds.length > 0
        ? ' AND NOT (external_id = ANY($2::text[]))'
        : '';
      const params = externalIds.length > 0 ? [sourceId, externalIds] : [sourceId];
      await client.query(
        `UPDATE positions
            SET status = 'closed', expires_at = CURRENT_TIMESTAMP, updated_at = now()
          WHERE source_id = $1${absent}
            AND (status <> 'closed' OR expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
        params,
      );
    }
    await finalizeRuns('succeeded');
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await finalizeRuns('failed', true);
      await client.query('COMMIT');
    } catch {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original apply error when audit finalization also fails.
      }
    }
    throw error;
  } finally {
    client.release();
  }
  return { wrote: true, companies, sites, positions };
}
