// Shared file-drop reader for curated recruitment JSON.
// One file = one company (or an array). No crawl. Missing / empty dir → [].

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecruitmentAdapter, RecruitmentSourceKind, SourceCompany } from '../recruitment-source.ts';

function asCompany(raw: unknown): SourceCompany | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<SourceCompany>;
  if (typeof row.slug !== 'string' || typeof row.name !== 'string') return null;
  if (!Array.isArray(row.sites) || !Array.isArray(row.positions)) return null;
  return row as SourceCompany;
}

export function parseSourceCompanyPayload(raw: unknown): SourceCompany[] {
  if (Array.isArray(raw)) return raw.map(asCompany).filter((row): row is SourceCompany => !!row);
  const one = asCompany(raw);
  return one ? [one] : [];
}

export async function listSourceCompanyFiles(dir: string): Promise<SourceCompany[]> {
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
      companies.push(...parseSourceCompanyPayload(JSON.parse(text)));
    } catch {
      // Skip unreadable / invalid files; the import planner reports validate issues later.
    }
  }
  return companies;
}

export function fileDropAdapter(kind: RecruitmentSourceKind, dir: string): RecruitmentAdapter {
  return {
    kind,
    list: () => listSourceCompanyFiles(dir),
  };
}

export function defaultDropDir(folder: string): string {
  return join(process.cwd(), 'data', 'recruitment', folder);
}
