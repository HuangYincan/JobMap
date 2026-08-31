// Pure parsing / mapping helpers for the qqdoc-jobs extraction pipeline
// (scripts/extract-qqdoc-jobs.mjs). No I/O, no fetch — unit-testable in
// isolation. Faithful TS ports of the validated crawler contracts:
//   - feishu ATS job rows  → SourcePosition (ats_feishu.py)
//   - generic career-page HTML → SourcePosition (best-effort, conservative)
//   - robots.txt rules (RFC 9309 group-aware, same semantics as
//     scripts/extract-qqdoc-addresses.mjs)
//
// All returned positions carry `portal-*` externalIds so the import path
// treats them as authentic (freshness.ts isAuthenticPositionId) and the
// crawler-written `portal-feishu-*` ids dedupe against ours by construction.

import type { JobFamily } from '../types.ts';
import type { SourceCompany, SourcePosition } from '../recruitment-source.ts';
import { normalizeCityName } from './official-site-parse.ts';

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309)
// ---------------------------------------------------------------------------

/**
 * Parse robots.txt into the Disallow path rules that apply to our UA group
 * (`User-agent: *` or an explicit `domain-map-etl` group). Other groups'
 * rules never apply (RFC 9309). `Allow` lines are ignored: a Disallow list
 * that does not match the path means allowed; an empty Disallow list means
 * fully allowed.
 */
export function parseRobotsDisallows(text: string): string[] {
  const rules: string[] = [];
  let inOurGroup = false;
  for (const line of text.split('\n')) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) continue;
    const uaMatch = /^user-agent\s*:\s*(.+)$/i.exec(clean);
    if (uaMatch) {
      const ua = uaMatch[1].trim().toLowerCase();
      inOurGroup = ua === '*' || ua.includes('domain-map-etl');
      continue;
    }
    const disallow = /^disallow\s*:\s*(.*)$/i.exec(clean);
    if (disallow && inOurGroup) {
      const rule = disallow[1].trim();
      if (rule.length > 0) rules.push(rule);
    }
  }
  return rules;
}

/** Match a path against one robots rule (pattern rules: `*` wildcards). */
export function robotsRuleMatches(rule: string, path: string): boolean {
  if (rule === '/') return true;
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}`).test(path);
}

/** A path is fetchable when no Disallow rule matches it (empty list → yes). */
export function robotsAllowsPath(disallows: string[], path: string): boolean {
  return !disallows.some((rule) => robotsRuleMatches(rule, path));
}

// ---------------------------------------------------------------------------
// City text helpers
// ---------------------------------------------------------------------------

/**
 * Split a drop city field like 「北京、杭州、上海\n、深圳等」 into bare city
 * names (「等/及/和」 suffixes dropped, punctuation/whitespace separators).
 * Used for site↔job city containment matching; never mutates the drop.
 */
export function splitCityText(text: string | undefined): string[] {
  if (!text) return [];
  const tokens = text
    .split(/[、，,;；/·\s]+/)
    .map((token) => token.replace(/[等及和区市]+$/, ''))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return [...new Set(tokens)];
}

/** Normalize one job/site city name to its canonical bare form (北京/杭州). */
export function bareCity(name: string | undefined): string {
  if (!name) return '';
  const normalized = normalizeCityName(name) ?? name;
  return normalized.replace(/[省市区县]$/, '').trim();
}

/** Does a (possibly multi-city) site city field contain the given city? */
export function cityTextContains(cityText: string | undefined, city: string): boolean {
  const target = bareCity(city);
  if (!target) return false;
  return splitCityText(cityText).some((token) => bareCity(token) === target);
}

// ---------------------------------------------------------------------------
// Feishu ATS job rows → SourcePosition (faithful port of ats_feishu.py)
// ---------------------------------------------------------------------------

const CITY_PINYIN: Record<string, string> = {
  北京: 'beijing', 上海: 'shanghai', 广州: 'guangzhou', 深圳: 'shenzhen',
  杭州: 'hangzhou', 成都: 'chengdu', 武汉: 'wuhan', 苏州: 'suzhou',
  宁波: 'ningbo', 南京: 'nanjing', 西安: 'xian', 重庆: 'chongqing',
  长沙: 'changsha', 合肥: 'hefei', 天津: 'tianjin', 青岛: 'qingdao',
  厦门: 'xiamen', 珠海: 'zhuhai', 佛山: 'foshan', 东莞: 'dongguan',
};

const CITY_ALIASES: Record<string, string> = { 北揽: '北京' };

/** ATS 城市名归一 (禾赛 "北揽" → "北京"; 去空值)。 */
export function normalizeAtsCity(name: unknown): string {
  const raw = name === null || name === undefined ? '' : String(name).trim();
  if (!raw) return '';
  return CITY_ALIASES[raw] ?? raw;
}

/** 主城市: city_list 第一项 (列表按相关性排序, 首个即主办公地)。 */
export function feishuJobCity(job: Record<string, unknown>): string {
  const cityList = Array.isArray(job.city_list) ? job.city_list : [];
  for (const row of cityList) {
    if (row && typeof row === 'object') {
      const name = normalizeAtsCity((row as Record<string, unknown>).name);
      if (name) return name;
    } else {
      const name = normalizeAtsCity(row);
      if (name) return name;
    }
  }
  return '';
}

/**
 * recruit_type 字段 → family。API 形状 {"id","name","parent":{"name"}}:
 * "正式"+parent 校招 → campus; "实习" → intern; "全职"/"外包" → social。
 */
export function familyForRecruitType(recruitType: unknown, title: string): JobFamily {
  if (recruitType && typeof recruitType === 'object') {
    const row = recruitType as Record<string, unknown>;
    const name = String(row.name ?? '').trim();
    const parent = row.parent as Record<string, unknown> | undefined;
    const parentName = parent ? String(parent.name ?? '').trim() : '';
    if (name.includes('实习')) return 'intern';
    if (parentName.includes('校招') || name.includes('校招')) return 'campus';
    if (name === '全职' || name === '外包' || name === '正式') return 'social';
  }
  const kind = String(recruitType ?? '').toLowerCase();
  if (kind.includes('intern') || kind.includes('实习')) return 'intern';
  if (kind === 'social' || kind === 'campus') return kind;
  return familyForText(title);
}

/** 标题关键词 → family (HTML 岗位与 feishu 兜底共用)。 */
export function familyForText(title: string): JobFamily {
  if (/实习|intern/i.test(title)) return 'intern';
  if (/社招|全职|外包|社会招聘/i.test(title)) return 'social';
  return 'campus';
}

/** 岗位城市 → site id: 城市匹配现有 site (含多城市文本) 复用其 id, 否则首站。 */
export function siteIdForJobCity(company: Pick<SourceCompany, 'slug' | 'sites'>, city: string): string {
  const sites = company.sites;
  if (!sites.length) return `${company.slug}-site`;
  if (city) {
    const target = bareCity(city);
    for (const site of sites) {
      if (cityTextContains(site.city, city)) return site.id;
      if (site.id.endsWith(`-site-${CITY_PINYIN[target] ?? target}`)) return site.id;
    }
  }
  return sites[0].id;
}

function cleanJd(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const text = String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 8000);
}

/**
 * One feishu API job row → SourcePosition. Null when the row is malformed
 * (skip, never crash the batch). externalId `portal-feishu-{job_id}` matches
 * the crawler's convention so both pipelines dedupe on the same id.
 */
export function feishuJobToPosition(
  job: Record<string, unknown>,
  company: Pick<SourceCompany, 'slug' | 'sites'>,
  opts: { host?: string; websitePath?: string; retrievedAt?: string } = {},
): SourcePosition | null {
  const jobId = String(job.id ?? '').trim();
  const title = String(job.title ?? '').trim();
  if (!jobId || !title) return null;
  const description = cleanJd(job.description);
  const requirement = cleanJd(job.requirement);
  const jd = [description, requirement ? `岗位要求:\n${requirement}` : ''].filter(Boolean).join('\n\n');
  const family = familyForRecruitType(job.recruit_type, title);
  const city = feishuJobCity(job);
  const base = opts.host ? `https://${opts.host}` : '';
  const sitePrefix = opts.websitePath ? `/${opts.websitePath}` : '';
  const position: SourcePosition = {
    externalId: `portal-feishu-${jobId}`,
    title: title.slice(0, 120),
    siteId: siteIdForJobCity(company, city),
    family,
    taxonomy: { family },
    status: 'open',
    applySource: 'official',
    applyUrl: `${base}${sitePrefix}/position/${jobId}/detail`,
    retrievedAt: opts.retrievedAt,
  };
  if (jd) position.description = jd;
  return position;
}

/**
 * Parse one feishu API page payload → { jobs, total }. Throws on the same
 * contract violations the crawler treats as page failures (code != 0, missing
 * data / job_post_list).
 */
export function parseFeishuJobPage(payload: unknown): { jobs: Record<string, unknown>[]; total: number } {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`feishu API returned non-object payload: ${typeof payload}`);
  }
  const body = payload as Record<string, unknown>;
  const code = body.code;
  if (code !== 0 && code !== null && code !== undefined) {
    throw new Error(`feishu API code=${code} ${body.message ?? body.msg ?? ''}`.trim());
  }
  const data = body.data;
  if (!data || typeof data !== 'object') {
    throw new Error(`feishu API payload has no data object: keys=${Object.keys(body).slice(0, 6)}`);
  }
  const list = (data as Record<string, unknown>).job_post_list;
  if (!Array.isArray(list)) {
    throw new Error(`feishu API data has no job_post_list array`);
  }
  const count = (data as Record<string, unknown>).count;
  const total = typeof count === 'number' ? count : list.length;
  return { jobs: list as Record<string, unknown>[], total };
}

// ---------------------------------------------------------------------------
// Generic career-page HTML → SourcePosition (conservative, best-effort)
// ---------------------------------------------------------------------------

/** 截止日期文本 → ISO (YYYY-MM-DD) 或 null。与 recruitment-import.ts 同规则
 *  (额外容忍「2026年10月31日」分隔)。 */
export function parseDeadline(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /(\d{4})\s*[-/.年]?\s*(\d{1,2})\s*[-/.月]?\s*(\d{1,2})\s*日?/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return null;
  }
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** 岗位标题外观: 4..40 字且含招聘词, 排除导航/按钮噪音。 */
const JOB_TITLE_RE =
  /^(?!.*(首页|登录|注册|关于我们|联系我们|职位搜索|搜索职位|更多|查看全部|投递|简历|退出|返回|下一页|上一页|共\d+个))(.{4,40})$/;

const JOB_KEYWORD_RE =
  /(工程师|开发|算法|运营|产品|设计|测试|管培生|实习生|专员|经理|顾问|分析师|校招|招聘|研发|技术|策划|市场|销售|财务|人力|法务|数据|架构|前端|后端|客户端|服务端|AI|科研|研究|教师|讲师|医生|护士)/;

export function parseHtmlJobRows(
  html: string,
  company: Pick<SourceCompany, 'name' | 'slug' | 'sites'>,
  baseUrl = '',
): SourcePosition[] {
  const withoutScripts = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const positions: SourcePosition[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{2,60}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(withoutScripts)) !== null && positions.length < 60) {
    const url = match[1];
    const title = match[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!JOB_TITLE_RE.test(title) || !JOB_KEYWORD_RE.test(title)) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    const block = withoutScripts.slice(Math.max(0, match.index - 200), match.index + 300);
    const deadlineMatch = /(?:截止|至|截至)\s*[:：]?\s*(\d{4}[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2})/.exec(block);
    const deadline = deadlineMatch ? parseDeadline(deadlineMatch[1]) : null;
    const cityToken = /(?:城市|地点)\s*[:：]?\s*([一-龥]{2,6}市?)/.exec(block);
    const city = cityToken ? bareCity(cityToken[1]) : '';
    positions.push({
      externalId: `portal-qqdoc-${hashId(title + url)}`,
      title: title.slice(0, 120),
      siteId: siteIdForJobCity(company, city || company.sites[0]?.city || ''),
      family: familyForText(title),
      taxonomy: { family: familyForText(title) },
      status: 'open',
      applySource: 'official',
      applyUrl: resolveRelativeUrl(url, baseUrl),
      deadline: deadline ?? undefined,
      retrievedAt: new Date().toISOString().slice(0, 10),
    });
  }
  return positions;
}

function hashId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36).padStart(8, '0');
}

function resolveRelativeUrl(url: string, base: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (/^\//.test(url)) return `${base.replace(/\/+$/, '')}${url}`;
  return `${base.replace(/\/+$/, '')}/${url}`;
}

/** Position rows written by this pipeline (idempotency + --force scope). */
export function isQqdocJobsPositionId(id: string | undefined): boolean {
  return Boolean(id && (id.startsWith('portal-qqdoc-') || id.startsWith('portal-feishu-') || id.startsWith('portal-zhiye-')));
}
