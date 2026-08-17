// LLM-powered authenticity validation for recruitment positions.
//
// One OpenAI-compatible chat-completions call per company+position pair, with
// a deterministic JSON verdict schema. Only single-position text leaves this
// module — never whole drops, never the API key. Network is an injectable
// fetchLike so tests can mock it; all parsing/judgement logic stays here.
//
// The LLM is the authority for semantic judgements; the deterministic helpers
// (aggregateTitleHints / domainHint) only provide prompt hints and a fallback
// signal when a call fails.

import type { CompanySite } from './types.ts';
import type { SourceCompany, SourcePosition } from './recruitment-source.ts';

export type DimensionVerdict = 'pass' | 'warn' | 'fail';
export type ItemLevel = 'pass' | 'warn' | 'fail' | 'error';

/** Structured verdict the LLM must return (JSON object, keys in English). */
export interface LlmVerdict {
  titleReal: boolean;
  isAggregateRow: boolean;
  /** When aggregate: the concrete job titles this row should be split into. */
  suggestedSplit: string[];
  companyPositionMatch: DimensionVerdict;
  companyCityMatch: DimensionVerdict;
  applyDomainMatch: DimensionVerdict;
  reason: string;
}

export interface PromptMessages {
  system: string;
  user: string;
}

export interface DomainHint {
  domain: string;
  knownAts: boolean;
}

export interface ChatCallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: PromptMessages;
  timeoutMs?: number;
  fetchLike?: typeof fetch;
}

/** HTTP error carrying the status code so the caller can decide on retries. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `chat completions HTTP ${status}`);
    this.status = status;
    this.name = 'HttpError';
  }
}

/** The OpenAI-compatible env vars this tool reads (never printed). */
export const LLM_VALIDATE_ENV = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const;

/** Known ATS hosts (投递链接是招聘系统而非官网). Hint only — LLM judges. */
export const KNOWN_ATS_HOSTS = ['mokahr.com', 'zhiye.com'] as const;

interface AggregatePattern {
  re: RegExp;
  hint: string;
  /** Extra gate: only report this hint when the title passes the predicate. */
  need?: (title: string) => boolean;
}

const AGGREGATE_PATTERNS: AggregatePattern[] = [
  {
    re: /招聘方向|岗位方向|方向[:：]|人才计划/,
    hint: '标题含「招聘方向 / 人才计划」类表述,多为聚合行',
  },
  {
    re: /[、,，/／|｜]/,
    hint: '标题含枚举分隔符(、/ 等),若列了多个类别则可能是聚合行',
    need: (title: string) => {
      const separators = title.match(/[、,，/／|｜]/g)?.length ?? 0;
      return separators >= 2 || (separators >= 1 && /(等|若干|多|类|方向)/.test(title));
    },
  },
  {
    re: /(等|若干|多类|大类|各主要)(七|六|五|八|九|若干|多个|各|主要)?(类|方向|岗位)?/,
    hint: '标题含「等 / 若干 / 七大类」类收尾,明显是聚合行',
  },
];

const DIMENSION_KEYS: Array<keyof Pick<LlmVerdict, 'companyPositionMatch' | 'companyCityMatch' | 'applyDomainMatch'>> = [
  'companyPositionMatch',
  'companyCityMatch',
  'applyDomainMatch',
];

/**
 * Deterministic heuristic hints for aggregate rows ("技术、设计、数据、运营、产品等七大类").
 * Heuristic only — the LLM verdict is authoritative; these feed the prompt and
 * give a signal when the LLM call fails.
 */
export function aggregateTitleHints(title: string): string[] {
  if (!title) return [];
  const hits: string[] = [];
  for (const { re, hint, need } of AGGREGATE_PATTERNS) {
    if (re.test(title) && (!need || need(title)) && !hits.includes(hint)) hits.push(hint);
  }
  return hits;
}

/** Hostname minus www; '' for unparseable / missing URLs. */
export function extractDomain(applyUrl: string | undefined): string {
  if (!applyUrl) return '';
  try {
    return new URL(applyUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function domainHint(applyUrl: string | undefined): DomainHint {
  const domain = extractDomain(applyUrl);
  return {
    domain,
    knownAts: KNOWN_ATS_HOSTS.some((host) => domain === host || domain.endsWith(`.${host}`)),
  };
}

/** Is the text a refusal / off-topic reply rather than a verdict JSON? */
export function looksLikeRefusal(content: string): boolean {
  if (!content) return true;
  return /(cannot|can't|unable|refus|无法|不能|拒绝|抱歉|无法判断信息)|(作为一个?AI|语言模型)/i.test(content);
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true' || value === 'yes' || value === 1) return true;
  if (value === false || value === 'false' || value === 'no' || value === 0) return false;
  return fallback;
}

function toDimension(value: unknown): DimensionVerdict {
  return value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'warn';
}

/**
 * Robustly parse the LLM reply into a verdict. Tolerates ```json fences,
 * surrounding prose, and wrong-typed fields (coerced to safe defaults).
 * A JSON verdict wins even if the surrounding prose sounds like a refusal;
 * refusal / off-topic detection only applies when no JSON object is present.
 * Returns null when the reply contains no parseable JSON object.
 */
export function parseLlmVerdict(content: string): LlmVerdict | null {
  if (!content || typeof content !== 'string') return null;
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const split = Array.isArray(r.suggestedSplit)
    ? r.suggestedSplit.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 12)
    : [];
  return {
    titleReal: toBool(r.titleReal, true),
    isAggregateRow: toBool(r.isAggregateRow, false),
    suggestedSplit: split,
    companyPositionMatch: toDimension(r.companyPositionMatch),
    companyCityMatch: toDimension(r.companyCityMatch),
    applyDomainMatch: toDimension(r.applyDomainMatch),
    reason: typeof r.reason === 'string' ? r.reason.slice(0, 500) : '',
  };
}

/**
 * Collapse a verdict to a single report level. Aggregate rows win as warn
 * (real data that needs splitting — their titles are catalogs, so titleReal
 * is expected to be false); other dims: any fail wins; warn dims are warn;
 * else pass.
 */
export function verdictLevel(v: LlmVerdict): ItemLevel {
  if (v.isAggregateRow) return 'warn';
  if (v.titleReal === false) return 'fail';
  for (const key of DIMENSION_KEYS) {
    if (v[key] === 'fail') return 'fail';
  }
  for (const key of DIMENSION_KEYS) {
    if (v[key] === 'warn') return 'warn';
  }
  return 'pass';
}

/**
 * Build the per-item prompt. Only this one position's text is included —
 * never sibling positions or the whole drop. The reply is constrained to a
 * fixed JSON schema by instruction; providers that reject response_format
 * still work, so we don't rely on it.
 */
export function buildValidationPrompt(
  company: Pick<SourceCompany, 'name' | 'industries'>,
  site: Pick<CompanySite, 'name' | 'location'>,
  position: Pick<SourcePosition, 'title' | 'department' | 'skills' | 'applyUrl'>,
): PromptMessages {
  const system = [
    '你是「地图找工作」平台的数据质量核查员。你会收到一家公司的一条岗位信息,请判断真实性。',
    '判定口径:',
    '- titleReal:标题是否为真实岗位标题(如「前端开发工程师」);虚构、口语化占位、或「欢迎加入」类门户入口算 false。**若标题是聚合行(isAggregateRow 判定为 true),titleReal 一律返回 true**——聚合行是真实招聘信息,只是需要拆解,用 isAggregateRow 标注即可。',
    '- isAggregateRow:是否把多个岗位合到一条(如「技术、设计、数据、运营、产品等七大类」、招聘方向罗列多个方向);是则给出拆解建议。',
    '- companyPositionMatch:岗位标题/部门/技能与该公司行业是否相符(pass/warn/fail)。',
    '- companyCityMatch:公司是否真的可能在该城市/地址有办公点(pass/warn/fail);不确定给 warn 不要乱 fail。',
    '- applyDomainMatch:投递链接域名是否该公司官网或可信 ATS(如 mokahr.com、zhiye.com)域名(pass/warn/fail)。',
    '规则:只依据给定文本和常识判断;不确定时给 warn;必须返回且只返回一个 JSON 对象,不要任何其他文字,格式:',
    '{"titleReal": true, "isAggregateRow": false, "suggestedSplit": [], "companyPositionMatch": "pass|warn|fail", "companyCityMatch": "pass|warn|fail", "applyDomainMatch": "pass|warn|fail", "reason": "一句话理由"}',
  ].join('\n');

  const siteName = site.name ?? '';
  const address = site.location?.address ?? '';
  const user: Record<string, unknown> = {
    company: { name: company.name, industries: company.industries ?? [] },
    site: { name: siteName, address },
    position: {
      title: position.title,
      department: position.department,
      skills: position.skills,
      applyUrl: position.applyUrl,
    },
  };
  return { system, user: JSON.stringify(user, null, 2) };
}

/**
 * One OpenAI-compatible chat-completions call; returns the raw content string
 * of the first choice. Non-2xx → HttpError (carrying status for retries).
 * Network failures and timeouts propagate as plain Errors.
 */
export async function callChatCompletionsJson(opts: ChatCallOptions): Promise<string> {
  const { baseUrl, apiKey, model, messages, timeoutMs = 30000, fetchLike = fetch } = opts;
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchLike(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
        temperature: 0,
        max_tokens: 800,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new HttpError(res.status);
    const data: unknown = await res.json();
    const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('empty chat completions content');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Statuses worth retrying with backoff. 400/422 are permanent. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true; // network error / timeout / abort
  return status === 408 || status === 429 || status >= 500;
}
