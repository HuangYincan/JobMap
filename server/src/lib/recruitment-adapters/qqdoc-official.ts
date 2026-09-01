// qqdoc-official adapter: drops extracted from a public Tencent Docs share
// (「27届秋招信息汇总」— 央企/银行/国企官方招聘链接, 2026-08 由 boss 提取)。
// One file = one company:
//   { slug, name, official_url, sources: ['qqdoc-official'],
//     sites: [{ id, name, city, province, location }] }
//
// The drops are curated text, not a crawl. official_url is surfaced as
// company.careerUrl (UI 的「官网/投递」入口). sites[].city may hold the
// company name until the polite official-site extractor
// (scripts/extract-qqdoc-addresses.mjs) fills the real 城市/街道地址;
// empty location objects are preserved (pending geocode) — never dropped.
// A missing/empty directory remains [] through legacy list(), while
// listDetailed() marks it incomplete so import callers cannot reconcile it.
//
// industries: drops carry no industry data; a conservative name-based tag
// keeps the detail card readable (bank → finance, 航空/海运/铁路 →
// transport, …). Unknown sectors fall back to 'other' (未标, mirrors the
// category 'other' convention) — per-company curation can refine later.

import {
  defaultDropDir,
  listSourceCompanyFilesDetailed,
  type ParsedSourceCompanyPayload,
} from './file-drop.ts';
import type { RecruitmentAdapter, SourceCompany } from '../recruitment-source.ts';
import type { CompanySite, POILocation } from '../types.ts';

export const QQDOC_OFFICIAL_DIR = process.env.QQDOC_OFFICIAL_DIR || defaultDropDir('qqdoc-official');

export interface QqdocOfficialSite {
  id: string;
  name?: string;
  city?: string;
  province?: string;
  location?: Partial<POILocation>;
}

export interface QqdocOfficialDrop {
  slug: string;
  name: string;
  official_url?: string;
  sources?: string[];
  /** 地址提取失败标记（extract-qqdoc-addresses.mjs 写入，adapter 忽略）。 */
  city_pending?: boolean;
  sites?: QqdocOfficialSite[];
  /** 投递链接岗位（extract-qqdoc-jobs.mjs 按 name 匹配追加；缺省空数组）。 */
  positions?: Array<Record<string, unknown>>;
}

const INDUSTRY_BY_NAME: ReadonlyArray<[RegExp, string]> = [
  [/银行|农商行|邮储|农信|证券|保险|信托/, 'finance'],
  [/航空|海运|航运|铁路|中远|中船|港口/, 'transport'],
  [/一汽|东风|汽车/, 'automotive'],
  [/医药|制药|生物/, 'biotech'],
  [/电信|移动|联通/, 'internet'],
];

/** 公司名 → 行业标签(银行→finance, 航空/海运/铁路→transport, …;未知 → other)。
 *  qqdoc-jobs adapter 复用同一启发式。 */
export function industriesOf(name: string): string[] {
  for (const [pattern, industry] of INDUSTRY_BY_NAME) {
    if (pattern.test(name)) return [industry];
  }
  return ['other'];
}

/**
 * Drop location 形态: 空对象 {} / 仅 address / 完整 lng+lat 都合法 —— 站点
 * 处于「待 geocode」或「已 geocode」任一状态都不丢。CompanySite.location 的
 * POILocation 类型要求 lng/lat 存在, 这里按可空字段承载 (import 落库按
 * `site.location?.lng ?? null` 读取, 不校验坐标存在)。
 */
function dropLocation(location: QqdocOfficialSite['location']): POILocation | undefined {
  if (!location || typeof location !== 'object') return undefined;
  return { ...location } as POILocation;
}

export function qqdocOfficialToSourceCompany(raw: unknown): SourceCompany | null {
  if (!raw || typeof raw !== 'object') return null;
  const drop = raw as QqdocOfficialDrop;
  if (typeof drop.slug !== 'string' || typeof drop.name !== 'string') return null;
  if (!Array.isArray(drop.sites) || drop.sites.length === 0) return null;
  const sites: CompanySite[] = drop.sites
    .filter((site): site is QqdocOfficialSite => !!site && typeof site.id === 'string')
    .map((site) => ({
      id: site.id,
      name: site.name || drop.name,
      city: site.city || undefined,
      province: site.province || undefined,
      location: dropLocation(site.location),
    }));
  const positions: SourceCompany['positions'] = Array.isArray(drop.positions)
    ? (drop.positions as unknown as SourceCompany['positions']).filter(
        (pos) => pos && typeof pos.externalId === 'string' && pos.externalId.length > 0,
      )
    : [];
  return {
    slug: drop.slug,
    name: drop.name,
    source: 'qqdoc-official',
    industries: industriesOf(drop.name),
    scale: 'enterprise',
    careerUrl: drop.official_url,
    sites,
    positions,
  };
}

export function parseQqdocOfficialPayload(raw: unknown): SourceCompany[] {
  if (!raw || typeof raw !== 'object') return [];
  const drops = Array.isArray(raw) ? raw : [raw];
  return drops
    .map(qqdocOfficialToSourceCompany)
    .filter((company): company is SourceCompany => company !== null);
}

function parseQqdocOfficialPayloadDetailed(raw: unknown): ParsedSourceCompanyPayload {
  const records = Array.isArray(raw) ? raw : [raw];
  const companies = records
    .map(qqdocOfficialToSourceCompany)
    .filter((company): company is SourceCompany => company !== null);
  return { companies, invalidRecords: records.length - companies.length };
}

export async function listQqdocOfficialFiles(dir = QQDOC_OFFICIAL_DIR): Promise<SourceCompany[]> {
  return (await listQqdocOfficialFilesDetailed(dir)).companies;
}

export async function listQqdocOfficialFilesDetailed(dir = QQDOC_OFFICIAL_DIR) {
  return listSourceCompanyFilesDetailed(dir, parseQqdocOfficialPayloadDetailed);
}

export function qqdocOfficialAdapter(dir = QQDOC_OFFICIAL_DIR): RecruitmentAdapter {
  return {
    kind: 'qqdoc-official',
    list: () => listQqdocOfficialFiles(dir),
    listDetailed: () => listQqdocOfficialFilesDetailed(dir),
  };
}

export const fileQqdocOfficialAdapter = qqdocOfficialAdapter();
