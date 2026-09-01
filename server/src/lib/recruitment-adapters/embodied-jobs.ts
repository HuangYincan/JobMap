// Embodied-AI jobs file-drop adapter: published GitHub snapshot
// (Octoday-Hub/Embodied-AI topics/02-jobs.md — 社区维护的具身智能岗位聚合列表,
// 2026-08-21 快照 538 机会) mapped to SourceCompany.
// Lower trust than official-career: sites carry city text, not coordinates.
//
// Drops are lean BY DESIGN (WS-1): slug/name/source/careerUrl/sites/positions
// only — they carry NO industries / scale (mirrors qqdoc-* drops). The import
// pipeline requires both (cloneCompany spreads industries; SourceCompany
// declares scale), so this adapter normalizes every drop on the way out:
//   - industries: industriesOf(name) — 与 qqdoc 同款启发式,未知 → 'other'
//     (永不空,validateSourceCompany「need at least one」不触发);
//   - scale: 'enterprise' — qqdoc 先例缺省(per-company 规模无法从 drop 推导,
//     固定缺省保证 type 契约与 UI 规模徽章不空)。
// Empty / missing dir → [] for the legacy list() contract; listDetailed() marks
// those inputs incomplete. Override with EMBODIED_JOBS_DIR.

import {
  defaultDropDir,
  listSourceCompanyFilesDetailed,
  type ParsedSourceCompanyPayload,
} from './file-drop.ts';
import { industriesOf } from './qqdoc-official.ts';
import type { RecruitmentAdapter, SourceCompany } from '../recruitment-source.ts';
import type { CompanySite } from '../types.ts';

export const EMBODIED_JOBS_DIR = process.env.EMBODIED_JOBS_DIR || defaultDropDir('embodied-jobs');

/** 上游 drop 形状(slug embj-* / source 'embodied-jobs' / 单或多 site / positions embj-*)。 */
export interface EmbodiedJobsDrop {
  slug: string;
  name: string;
  source?: string;
  careerUrl?: string;
  /** 有意精简:真实 drops 不带 industries/scale;若未来 drop 自带则原样透传。 */
  industries?: string[];
  scale?: SourceCompany['scale'];
  sites?: CompanySite[];
  positions?: SourceCompany['positions'];
}

export function embodiedJobsToSourceCompany(raw: unknown): SourceCompany | null {
  if (!raw || typeof raw !== 'object') return null;
  const drop = raw as EmbodiedJobsDrop;
  if (typeof drop.slug !== 'string' || typeof drop.name !== 'string') return null;
  if (!Array.isArray(drop.sites) || drop.sites.length === 0) return null;
  const positions: SourceCompany['positions'] = Array.isArray(drop.positions)
    ? drop.positions.filter(
        (pos) => pos && typeof pos.externalId === 'string' && pos.externalId.length > 0,
      )
    : [];
  return {
    slug: drop.slug,
    name: drop.name,
    source: 'embodied-jobs',
    // 归一化(2026-08-21 FOLLOWUP):真实 embj-* drops 无 industries/scale,
    // 缺 industries 会让 planSeedImport → dedupeSourceCompanies → cloneCompany
    // 对 [...undefined] spread 抛 TypeError(recruitment-import.ts:222)。
    industries:
      Array.isArray(drop.industries) && drop.industries.length > 0
        ? drop.industries
        : industriesOf(drop.name),
    scale: drop.scale ?? 'enterprise',
    careerUrl: drop.careerUrl,
    sites: drop.sites,
    positions,
  };
}

export function parseEmbodiedJobsPayload(raw: unknown): SourceCompany[] {
  if (!raw || typeof raw !== 'object') return [];
  const drops = Array.isArray(raw) ? raw : [raw];
  return drops
    .map(embodiedJobsToSourceCompany)
    .filter((company): company is SourceCompany => company !== null);
}

function parseEmbodiedJobsPayloadDetailed(raw: unknown): ParsedSourceCompanyPayload {
  const records = Array.isArray(raw) ? raw : [raw];
  const companies = records
    .map(embodiedJobsToSourceCompany)
    .filter((company): company is SourceCompany => company !== null);
  return { companies, invalidRecords: records.length - companies.length };
}

export async function listEmbodiedJobsFiles(dir = EMBODIED_JOBS_DIR): Promise<SourceCompany[]> {
  return (await listEmbodiedJobsFilesDetailed(dir)).companies;
}

export async function listEmbodiedJobsFilesDetailed(dir = EMBODIED_JOBS_DIR) {
  return listSourceCompanyFilesDetailed(dir, parseEmbodiedJobsPayloadDetailed);
}

export function embodiedJobsAdapter(dir = EMBODIED_JOBS_DIR): RecruitmentAdapter {
  return {
    kind: 'embodied-jobs',
    list: () => listEmbodiedJobsFiles(dir),
    listDetailed: () => listEmbodiedJobsFilesDetailed(dir),
  };
}

export const fileEmbodiedJobsAdapter = embodiedJobsAdapter();
