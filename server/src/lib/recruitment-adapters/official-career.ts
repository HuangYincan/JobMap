// Official-career adapter: drop curated JSON next to the seed.
// One file = one company (or an array). No crawl. Empty dir → [].

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecruitmentAdapter, SourceCompany } from '../recruitment-source.ts';

export const OFFICIAL_CAREER_DIR =
  process.env.OFFICIAL_CAREER_DIR || join(process.cwd(), 'data', 'recruitment', 'official-career');

function asCompany(raw: unknown): SourceCompany | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<SourceCompany>;
  if (typeof row.slug !== 'string' || typeof row.name !== 'string') return null;
  if (!Array.isArray(row.sites) || !Array.isArray(row.positions)) return null;
  return row as SourceCompany;
}

export function parseOfficialCareerPayload(raw: unknown): SourceCompany[] {
  if (Array.isArray(raw)) return raw.map(asCompany).filter((row): row is SourceCompany => !!row);
  const one = asCompany(raw);
  return one ? [one] : [];
}

export async function listOfficialCareerFiles(dir = OFFICIAL_CAREER_DIR): Promise<SourceCompany[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const companies: SourceCompany[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    try {
      const text = await readFile(join(dir, name), 'utf8');
      companies.push(...parseOfficialCareerPayload(JSON.parse(text)));
    } catch {
      // Skip unreadable / invalid files; the import planner reports validate issues later.
    }
  }
  return companies;
}

export function officialCareerAdapter(dir = OFFICIAL_CAREER_DIR): RecruitmentAdapter {
  return {
    kind: 'official-career',
    list: () => listOfficialCareerFiles(dir),
  };
}

export const fileOfficialCareerAdapter = officialCareerAdapter();
