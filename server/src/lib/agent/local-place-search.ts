// Agent 地点检索:本地招聘目录 / 杭州 POI 优先,未命中再由调用方打地图 API。
// 纯编排 + 可注入查询,无 secret。

import { CITY_CENTERS, bareCityName } from '../city-centers.ts';
import { loadHzPoiSuggestions } from '../hz-poi-store.ts';
import { searchWorkSitesForPlace } from '../recruitment-store.ts';
import { toolKind } from './run-agent.ts';
import type { AgentTool, ToolResult } from './types.ts';
import { sanitizeToolText } from './run-agent.ts';

const PLACE_SUFFIX_RE = /(?:大厦|大楼|总部|园区|职场|写字楼|科技园|软件园)+$/u;
const LOCAL_PLACE_LIMIT = 8;

const COMPANY_ALIAS_GROUPS: string[][] = [
  ['阿里巴巴', '阿里', 'alibaba'],
  ['字节跳动', '字节', 'bytedance'],
  ['腾讯', 'tencent'],
  ['网易', 'netease'],
  ['华为', 'huawei'],
  ['蚂蚁集团', '蚂蚁', 'antgroup'],
  ['哔哩哔哩', 'b站', 'bilibili'],
  ['深信服', 'sangfor'],
  ['之江实验室', '之江', 'zhejiang lab'],
];

const CITY_NAMES = [
  ...new Set(
    Object.keys(CITY_CENTERS)
      .map((key) => bareCityName(key))
      .filter((name) => name.length >= 2),
  ),
].sort((a, b) => b.length - a.length);

export interface LocalPlaceHit {
  source: 'work' | 'domain';
  name: string;
  address: string;
  city?: string;
  lng: number;
  lat: number;
  id?: string;
}

export interface ParsedPlaceQuery {
  keyword: string;
  city?: string;
}

export interface LocalPlaceSearchDeps {
  searchWork?: (
    terms: string[],
    city: string | undefined,
    limit: number,
  ) => Promise<LocalPlaceHit[] | null>;
  searchDomain?: (keyword: string, limit: number) => Promise<LocalPlaceHit[] | null>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stripPlaceSuffixes(text: string): string {
  let out = text.trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(PLACE_SUFFIX_RE, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/** 从「深圳腾讯」「腾讯大厦」拆出城市与关键词。 */
export function parsePlaceQuery(raw: string, cityHint?: string): ParsedPlaceQuery {
  const text = raw.trim();
  let city = cityHint ? bareCityName(cityHint) : undefined;
  let rest = text;
  if (!city) {
    for (const name of CITY_NAMES) {
      if (rest.includes(name)) {
        city = name;
        rest = rest.split(`${name}市`).join('').split(name).join('');
        break;
      }
    }
  } else {
    rest = rest.split(`${city}市`).join('').split(city).join('');
  }
  rest = stripPlaceSuffixes(rest.replace(/[\s,，]+/g, ' ').trim());
  const keyword = rest || stripPlaceSuffixes(text);
  return city ? { keyword, city } : { keyword };
}

export function expandPlaceSearchTerms(keyword: string): string[] {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const terms = new Set<string>([trimmed]);
  const stripped = stripPlaceSuffixes(trimmed);
  if (stripped) terms.add(stripped);
  const hay = stripped || trimmed;
  for (const group of COMPANY_ALIAS_GROUPS) {
    if (group.some((alias) => hay === alias || hay.toLowerCase() === alias || hay.includes(alias))) {
      for (const alias of group) terms.add(alias);
    }
  }
  return [...terms].filter((term) => term.length >= 2).slice(0, 8);
}

function extractPlaceQuery(input: Record<string, unknown>): ParsedPlaceQuery | null {
  const raw =
    str(input.query) ??
    str(input.keywords) ??
    str(input.keyword) ??
    str(input.q) ??
    str(input.address) ??
    str(input.name);
  if (!raw) return null;
  return parsePlaceQuery(raw, str(input.city) ?? str(input.region) ?? str(input.cityname));
}

async function defaultSearchWork(
  terms: string[],
  city: string | undefined,
  limit: number,
): Promise<LocalPlaceHit[] | null> {
  const rows = await searchWorkSitesForPlace(terms, city, limit);
  if (!rows) return null;
  return rows.map((row) => ({
    source: 'work' as const,
    name: row.company_name,
    address: [row.site_name, row.address].filter(Boolean).join(' · '),
    city: row.city ?? undefined,
    lng: row.lng,
    lat: row.lat,
    id: row.slug,
  }));
}

async function defaultSearchDomain(keyword: string, limit: number): Promise<LocalPlaceHit[] | null> {
  const rows = await loadHzPoiSuggestions(keyword, limit);
  if (!rows) return null;
  return rows.map((row) => ({
    source: 'domain' as const,
    name: row.name,
    address: row.adname,
    city: '杭州',
    lng: row.lng_gcj,
    lat: row.lat_gcj,
    id: row.poi_id,
  }));
}

export async function searchLocalPlaces(
  query: string,
  city?: string,
  deps: LocalPlaceSearchDeps = {},
): Promise<LocalPlaceHit[]> {
  const parsed = parsePlaceQuery(query, city);
  const terms = expandPlaceSearchTerms(parsed.keyword);
  if (terms.length === 0) return [];
  const searchWork = deps.searchWork ?? defaultSearchWork;
  const searchDomain = deps.searchDomain ?? defaultSearchDomain;
  const hits: LocalPlaceHit[] = [];
  const work = await searchWork(terms, parsed.city, LOCAL_PLACE_LIMIT);
  if (work) hits.push(...work);
  const hangzhou = !parsed.city || parsed.city === '杭州';
  if (hangzhou && hits.length < LOCAL_PLACE_LIMIT) {
    const domain = await searchDomain(parsed.keyword, LOCAL_PLACE_LIMIT - hits.length);
    if (domain) hits.push(...domain);
  }
  const seen = new Set<string>();
  const unique: LocalPlaceHit[] = [];
  for (const hit of hits) {
    const key = `${hit.lng.toFixed(6)},${hit.lat.toFixed(6)},${hit.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
    if (unique.length >= LOCAL_PLACE_LIMIT) break;
  }
  return unique;
}

export function formatLocalPlaceHits(hits: LocalPlaceHit[]): string {
  const lines = hits.map((hit, i) => {
    const where = [hit.address, hit.city].filter(Boolean).join(' · ') || '地址未提供';
    return `${i + 1}. ${hit.name} — ${where} — ${hit.lng},${hit.lat}`;
  });
  return `本地目录命中 ${hits.length} 个地点(未请求地图 API):\n${lines.join('\n')}`;
}

function textOk(text: string): ToolResult {
  return { ok: true, text: sanitizeToolText(text) };
}

/**
 * 地点/地理编码类 MCP 工具先查本地;命中则不打外部 API。
 * 非 search/geocode 工具原样返回。
 */
export function preferLocalPlaceSearch(
  tool: AgentTool,
  searchLocal: (query: string, city?: string) => Promise<LocalPlaceHit[]> = searchLocalPlaces,
): AgentTool {
  const kind = toolKind(tool.name);
  if (kind !== 'search' && kind !== 'geocode') return tool;
  if (tool.name.startsWith('rest__')) return tool;
  return {
    ...tool,
    async call(input: Record<string, unknown>, ctx) {
      const parsed = extractPlaceQuery(input);
      if (parsed?.keyword) {
        try {
          const hits = await searchLocal(parsed.keyword, parsed.city);
          if (hits.length > 0) return textOk(formatLocalPlaceHits(hits));
        } catch {
          /* 本地失败不阻断外部工具 */
        }
      }
      return tool.call(input, ctx);
    },
  };
}
