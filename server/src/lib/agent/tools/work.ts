// Work-domain Agent tools (tech/31 §5.5). Search and detail reuse the public
// catalog / position-filter / alive pipeline; they do not copy a second job
// filter engine. Tool text is sanitized and never includes full JD text.

import type { AgentTool, AgentContext, ToolResult, AgentMapHint } from '../types.ts';
import { sanitizeToolText } from '../run-agent.ts';
import { agentSearchOrigin } from '../search-origin.ts';
import { mergeAgentImages, type AgentImage } from '../result-images.ts';
import {
  clampPage,
  clampPageSize,
  searchPublicCatalog,
  spatialClipFromSearch,
} from '../../public-search.ts';
import { loadServerCatalog } from '../../server-catalog.ts';
import {
  loadWorkPositionByExternalIdFromDb,
  type WorkPositionDetailRecord,
} from '../../recruitment-store.ts';
import { filterPositions, type PositionFilters } from '../../position-filters.ts';
import { alivePositions, isAlivePosition } from '../../position-alive.ts';
import {
  formatDistance,
  haversineDistance,
  isRecruitmentPOI,
  type JobFamily,
  type POI,
  type Position,
  type RecruitmentPOI,
} from '../../types.ts';
import type { SpatialClip as SpatialClipQuery } from '../../spatial-query.ts';

const AGENT_PAGE_SIZE_CAP = 20;
const MAX_QUERY_CHARS = 200;
const MAX_CITY_CHARS = 64;
const MAX_ID_CHARS = 128;
const MAX_ROLES = 8;
const FAMILIES = new Set<JobFamily>(['intern', 'campus', 'social']);

export interface WorkPositionSummary {
  positionId: string;
  title: string;
  city?: string;
  siteLabel?: string;
  siteId?: string;
  companyCatalogId: string;
  companyName: string;
  family: JobFamily;
  salary?: { min: number; max: number };
  applySource?: string;
  deadline?: string;
  distanceMeters?: number;
  logoUrl?: string;
  location?: { lng: number; lat: number };
}

export interface WorkToolDeps {
  loadCatalog?: (clip?: SpatialClipQuery) => Promise<POI[] | null>;
  getPosition?: (positionId: string) => Promise<WorkPositionDetailRecord | null | undefined>;
  now?: () => Date;
}

function textOk(text: string, images?: AgentImage[], mapHints?: AgentMapHint[]): ToolResult {
  const result: { ok: true; text: string; images?: AgentImage[]; mapHints?: AgentMapHint[] } = {
    ok: true,
    text: sanitizeToolText(text),
  };
  if (images && images.length > 0) result.images = images;
  if (mapHints && mapHints.length > 0) result.mapHints = mapHints;
  return result;
}

function textErr(text: string): ToolResult {
  return { ok: false, error: sanitizeToolText(text) };
}

function asString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}

function asFamily(value: unknown): JobFamily | undefined {
  return typeof value === 'string' && FAMILIES.has(value as JobFamily)
    ? (value as JobFamily)
    : undefined;
}

function asRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, MAX_ROLES);
}

function siteLabel(poi: RecruitmentPOI): string | undefined {
  return poi.sites?.[0]?.name ?? poi.name;
}

function siteCity(poi: RecruitmentPOI): string | undefined {
  return poi.sites?.[0]?.city ?? undefined;
}

function positionOrigin(poi: RecruitmentPOI, position: Position): { lng: number; lat: number } | undefined {
  const site = poi.sites?.find((item) => item.id === position.siteId) ?? poi.sites?.[0];
  const loc = site?.location ?? poi.location;
  if (!Number.isFinite(loc?.lng) || !Number.isFinite(loc?.lat)) return undefined;
  return { lng: loc.lng, lat: loc.lat };
}

function companyLogoUrl(poi: RecruitmentPOI): string | undefined {
  const siteLogo = poi.sites?.[0]?.logoUrl;
  const companyLogo = poi.company.logoUrl;
  const url = siteLogo || companyLogo;
  return typeof url === 'string' && url.trim() ? url.trim() : undefined;
}

function toSummary(
  poi: RecruitmentPOI,
  position: Position,
  origin?: { lng: number; lat: number },
): WorkPositionSummary {
  const summary: WorkPositionSummary = {
    positionId: position.id,
    title: position.title,
    companyCatalogId: poi.id,
    companyName: poi.company.name,
    family: position.taxonomy?.family ?? position.type,
  };
  const city = siteCity(poi);
  if (city) summary.city = city;
  const label = siteLabel(poi);
  if (label) summary.siteLabel = label;
  if (position.siteId) summary.siteId = position.siteId;
  if (position.salary) summary.salary = position.salary;
  if (position.apply?.source) summary.applySource = position.apply.source;
  if (position.deadline) summary.deadline = position.deadline;
  const logoUrl = companyLogoUrl(poi);
  if (logoUrl) summary.logoUrl = logoUrl;
  const loc = positionOrigin(poi, position);
  if (loc) summary.location = loc;
  if (origin && loc) summary.distanceMeters = haversineDistance(origin, loc);
  return summary;
}

function hintLabel(companyName: string, title: string): string {
  const full = `${companyName} · ${title}`;
  if (full.length <= 50) return full;
  if (companyName.length <= 50) return companyName;
  return companyName.slice(0, 50);
}

function toMapHint(row: { location?: { lng: number; lat: number }; companyName: string; title: string; companyCatalogId: string; positionId: string }): AgentMapHint | undefined {
  if (!row.location) return undefined;
  return {
    lng: row.location.lng,
    lat: row.location.lat,
    label: hintLabel(row.companyName, row.title),
    mapId: row.companyCatalogId,
    positionId: row.positionId,
  };
}

function formatSummary(row: WorkPositionSummary, index: number): string {
  const parts = [
    `${index}. ${row.title} · ${row.companyName}`,
    row.city ?? '城市未提供',
    row.siteLabel ?? '办公点未提供',
    row.family,
    `mapId=${row.companyCatalogId}`,
    `positionId=${row.positionId}`,
  ];
  if (row.location) parts.push(`办公点 GCJ-02 ${row.location.lng},${row.location.lat}`);
  if (row.distanceMeters !== undefined) parts.push(`距起点 ${formatDistance(row.distanceMeters)}`);
  if (row.salary) parts.push(`薪资 ${row.salary.min}-${row.salary.max}`);
  if (row.applySource) parts.push(`来源 ${row.applySource}`);
  if (row.deadline) parts.push(`截止 ${row.deadline}`);
  return parts.join(' | ');
}

function formatDetail(row: WorkPositionDetailRecord): string {
  const parts = [
    `positionId=${row.positionId}`,
    `title=${row.title}`,
    `company=${row.companyName} (${row.companyCatalogId})`,
    `mapId=${row.companyCatalogId}`,
    `family=${row.family}`,
    `status=${row.status}`,
  ];
  if (row.city) parts.push(`city=${row.city}`);
  if (row.siteLabel) parts.push(`site=${row.siteLabel}`);
  if (row.siteId) parts.push(`siteId=${row.siteId}`);
  if (row.salary) parts.push(`薪资 ${row.salary.min}-${row.salary.max}`);
  if (row.education) parts.push(`学历 ${row.education}`);
  if (row.department) parts.push(`部门 ${row.department}`);
  if (row.applySource) parts.push(`来源 ${row.applySource}`);
  if (row.deadline) parts.push(`截止 ${row.deadline}`);
  if (row.location) {
    parts.push(
      `办公点坐标 ${row.location.lng},${row.location.lat} (${row.location.coordinateSystem})`,
    );
  }
  return parts.join('\n');
}

function positionFromPoi(
  catalog: POI[],
  positionId: string,
  now: Date,
): WorkPositionDetailRecord | undefined {
  for (const poi of catalog) {
    if (!isRecruitmentPOI(poi)) continue;
    const position = poi.positions.find((item) => item.id === positionId);
    if (!position) continue;
    if (!isAlivePosition(position, now)) return undefined;
    const site = poi.sites?.find((item) => item.id === position.siteId) ?? poi.sites?.[0];
    const record: WorkPositionDetailRecord = {
      positionId: position.id,
      title: position.title,
      family: position.taxonomy?.family ?? position.type,
      companyCatalogId: poi.id,
      companyName: poi.company.name,
      status: position.status,
    };
    if (position.department) record.department = position.department;
    if (site?.city) record.city = site.city;
    if (position.siteId) record.siteId = position.siteId;
    if (site?.name) record.siteLabel = site.name;
    if (position.salary) record.salary = position.salary;
    if (position.education) record.education = position.education;
    if (position.deadline) record.deadline = position.deadline;
    if (position.apply?.source) record.applySource = position.apply.source;
    const loc = site?.location ?? poi.location;
    if (Number.isFinite(loc?.lng) && Number.isFinite(loc?.lat)) {
      record.location = { lng: loc.lng, lat: loc.lat, coordinateSystem: 'gcj02' };
    }
    return record;
  }
  return undefined;
}

async function defaultGetPosition(positionId: string): Promise<WorkPositionDetailRecord | null | undefined> {
  return loadWorkPositionByExternalIdFromDb(positionId);
}

export function workTools(deps: WorkToolDeps = {}): AgentTool[] {
  const loadCatalog = deps.loadCatalog ?? ((clip?: SpatialClipQuery) => loadServerCatalog('work', clip));
  const getPosition = deps.getPosition ?? defaultGetPosition;
  const nowFn = deps.now ?? (() => new Date());

  return [
    {
      name: 'work__searchPositions',
      description:
        '在当前招聘目录中搜索仍在招的岗位摘要。默认以用户位置为起点由近到远排序,用户位置未知时才用视野中心;输入关键词、城市和有限结构化条件。返回岗位名、公司、mapId(select/openDetail 必须用此 id)、办公点 GCJ-02 坐标、positionId(仅供 getPositionDetail,禁止展示给用户)。不含全文 JD。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词,匹配岗位标题或公司名' },
          city: { type: 'string', description: '城市,如「杭州」' },
          family: { type: 'string', enum: ['intern', 'campus', 'social'] },
          roles: { type: 'array', items: { type: 'string' }, description: '职能多选,组内 OR' },
          page: { type: 'number' },
          pageSize: { type: 'number', description: '每页条数,最大 20' },
        },
      },
      provider: 'work',
      async call(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
        const query = asString(input.query, MAX_QUERY_CHARS) ?? '';
        const city = asString(input.city, MAX_CITY_CHARS);
        const family = asFamily(input.family);
        const roles = asRoles(input.roles);
        const page = clampPage(typeof input.page === 'number' ? input.page : 1);
        const pageSize = Math.min(
          AGENT_PAGE_SIZE_CAP,
          clampPageSize(typeof input.pageSize === 'number' ? input.pageSize : AGENT_PAGE_SIZE_CAP),
        );
        const origin = agentSearchOrigin(ctx);
        const filters: Record<string, unknown> = { alive: true };
        if (city) filters.city = city;
        if (family) filters.jobTaxonomy = family;
        const clip = spatialClipFromSearch({
          mode: 'work',
          q: query,
          filters,
        });
        const catalog = await loadCatalog(clip);
        if (!catalog) {
          return textErr('招聘目录暂时不可用');
        }
        const matched = searchPublicCatalog(catalog, {
          mode: 'work',
          q: query || undefined,
          filters,
          page: 1,
          pageSize: 50,
          ...(origin ? { center: origin, sort: 'distance' } : {}),
        });
        const now = nowFn();
        const positionFilters: PositionFilters = {
          roles,
          families: family ? [family] : [],
          query,
        };
        const rows: WorkPositionSummary[] = [];
        for (const poi of matched.results) {
          if (!isRecruitmentPOI(poi)) continue;
          let listed = filterPositions(alivePositions(poi, now), positionFilters);
          if (listed.length === 0 && query) {
            listed = filterPositions(alivePositions(poi, now), {
              roles,
              families: family ? [family] : [],
              query: '',
            });
          }
          for (const position of listed) {
            rows.push(toSummary(poi, position, origin));
          }
        }
        if (origin) {
          rows.sort((a, b) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER));
        }
        const start = (page - 1) * pageSize;
        const pageRows = rows.slice(start, start + pageSize);
        if (pageRows.length === 0) {
          return textOk('未找到符合条件的在招岗位。');
        }
        const originNote = origin
          ? `起点 ${origin.lng.toFixed(6)},${origin.lat.toFixed(6)}(用户位置优先,无定位才用视野中心)`
          : '未提供用户位置或视野,未按距离排序';
        const header = `找到 ${rows.length} 个岗位摘要(第 ${page} 页,每页 ${pageSize},${originNote},不含全文 JD)。mapId 用于 select/openDetail;positionId 仅供 getPositionDetail,禁止写入对用户正文:`;
        const images = mergeAgentImages(
          pageRows.map((row) => (row.logoUrl ? { url: row.logoUrl, alt: row.companyName } : undefined)).filter(
            (img): img is { url: string; alt: string } => Boolean(img),
          ),
        );
        const mapHints = pageRows.map(toMapHint).filter((hint): hint is AgentMapHint => Boolean(hint));
        return textOk([header, ...pageRows.map((row, i) => formatSummary(row, start + i + 1))].join('\n'), images, mapHints);
      },
    },
    {
      name: 'work__getPositionDetail',
      description:
        '按岗位 ID 读取当前仍可见(open 且在招)的岗位事实、办公点坐标(含坐标系)与来源/新鲜度。找不到或已下线时失败,不猜测。select/openDetail 必须用返回的 mapId,禁止把 positionId 给用户。不含全文 JD。',
      inputSchema: {
        type: 'object',
        properties: {
          positionId: { type: 'string', description: '岗位稳定 ID(external_id)' },
        },
        required: ['positionId'],
      },
      provider: 'work',
      async call(input: Record<string, unknown>, _ctx: AgentContext): Promise<ToolResult> {
        const positionId = asString(input.positionId, MAX_ID_CHARS);
        if (!positionId) return textErr('岗位不存在或已下线');
        const record = await getPosition(positionId);
        if (record === null) return textErr('岗位服务暂不可用');
        if (!record) return textErr('岗位不存在或已下线');
        if (!isAlivePosition({ ...record, id: record.positionId, type: record.family }, nowFn())) {
          return textErr('岗位不存在或已下线');
        }
        const mapHints = record.location
          ? [{
              lng: record.location.lng,
              lat: record.location.lat,
              label: hintLabel(record.companyName, record.title),
              mapId: record.companyCatalogId,
              positionId: record.positionId,
            }]
          : undefined;
        return textOk(formatDetail(record), undefined, mapHints);
      },
    },
  ];
}

/** Resolve alive positions from an injected catalog (navigation tools / tests). */
export function resolvePositionsFromCatalog(
  catalog: POI[],
  positionIds: string[],
  now: Date = new Date(),
): WorkPositionDetailRecord[] {
  const out: WorkPositionDetailRecord[] = [];
  for (const id of positionIds) {
    const record = positionFromPoi(catalog, id, now);
    if (record) out.push(record);
  }
  return out;
}

export { AGENT_PAGE_SIZE_CAP };
