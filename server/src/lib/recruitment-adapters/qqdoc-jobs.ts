// qqdoc-jobs adapter: drops extracted from the same public Tencent Docs share
// as qqdoc-official, but for companies whose entry carries a 投递链接
// (apply_url) — the boss staged 163 new companies here (2026-08-21); the
// extractor (scripts/extract-qqdoc-jobs.mjs) appends positions fetched from
// the apply links (feishu ATS / official pages / …).
//
// One file = one company:
//   { slug, name, sources: ['qqdoc-jobs'], apply_url, direction, deadline,
//     sites: [{ id, name, city, province, location }] }
//
// A missing/empty directory remains [] through legacy list(), while
// listDetailed() marks it incomplete so import callers cannot reconcile it.
// sites[].city may hold a multi-city text like 「北京、杭州、上海」 (kept
// verbatim, same as radar drops treat city text); location is empty (pending
// geocode) — never dropped. careerUrl is surfaced only when apply_url is a
// real URL (placeholders like 「投递连接看官方公告」 are not URLs and must not
// reach the UI as broken links).

import {
  defaultDropDir,
  listSourceCompanyFilesDetailed,
  type ParsedSourceCompanyPayload,
} from './file-drop.ts';
import { industriesOf } from './qqdoc-official.ts';
import type { RecruitmentAdapter, SourceCompany } from '../recruitment-source.ts';
import type { CompanySite, POILocation } from '../types.ts';

export const QQDOC_JOBS_DIR = process.env.QQDOC_JOBS_DIR || defaultDropDir('qqdoc-jobs');

export interface QqdocJobsSite {
  id: string;
  name?: string;
  city?: string;
  province?: string;
  location?: Partial<POILocation>;
}

export interface QqdocJobsDrop {
  slug: string;
  name: string;
  /** 投递链接;可能为占位文本(「投递连接看官方公告」)而非 URL。 */
  apply_url?: string;
  direction?: string;
  deadline?: string;
  sources?: string[];
  sites?: QqdocJobsSite[];
  positions?: Array<Record<string, unknown>>;
}

function dropLocation(location: QqdocJobsSite['location']): POILocation | undefined {
  if (!location || typeof location !== 'object') return undefined;
  return { ...location } as POILocation;
}

/** apply_url 是否为可点击的真实 URL(拒绝中文占位文本)。 */
export function isPlausibleApplyUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  if (!/^https?:\/\//.test(raw)) return false;
  if (/[一-鿿]/.test(raw)) return false;
  const host = raw.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  return host.includes('.') && !host.includes('：');
}

export function qqdocJobsToSourceCompany(raw: unknown): SourceCompany | null {
  if (!raw || typeof raw !== 'object') return null;
  const drop = raw as QqdocJobsDrop;
  if (typeof drop.slug !== 'string' || typeof drop.name !== 'string') return null;
  if (!Array.isArray(drop.sites) || drop.sites.length === 0) return null;
  const sites: CompanySite[] = drop.sites
    .filter((site): site is QqdocJobsSite => !!site && typeof site.id === 'string')
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
    source: 'qqdoc-jobs',
    industries: industriesOf(drop.name),
    scale: 'enterprise',
    careerUrl: isPlausibleApplyUrl(drop.apply_url) ? drop.apply_url : undefined,
    sites,
    positions,
  };
}

export function parseQqdocJobsPayload(raw: unknown): SourceCompany[] {
  if (!raw || typeof raw !== 'object') return [];
  const drops = Array.isArray(raw) ? raw : [raw];
  return drops
    .map(qqdocJobsToSourceCompany)
    .filter((company): company is SourceCompany => company !== null);
}

function parseQqdocJobsPayloadDetailed(raw: unknown): ParsedSourceCompanyPayload {
  const records = Array.isArray(raw) ? raw : [raw];
  const companies = records
    .map(qqdocJobsToSourceCompany)
    .filter((company): company is SourceCompany => company !== null);
  return { companies, invalidRecords: records.length - companies.length };
}

export async function listQqdocJobsFiles(dir = QQDOC_JOBS_DIR): Promise<SourceCompany[]> {
  return (await listQqdocJobsFilesDetailed(dir)).companies;
}

export async function listQqdocJobsFilesDetailed(dir = QQDOC_JOBS_DIR) {
  return listSourceCompanyFilesDetailed(dir, parseQqdocJobsPayloadDetailed);
}

export function qqdocJobsAdapter(dir = QQDOC_JOBS_DIR): RecruitmentAdapter {
  return {
    kind: 'qqdoc-jobs',
    list: () => listQqdocJobsFiles(dir),
    listDetailed: () => listQqdocJobsFilesDetailed(dir),
  };
}

export const fileQqdocJobsAdapter = qqdocJobsAdapter();
