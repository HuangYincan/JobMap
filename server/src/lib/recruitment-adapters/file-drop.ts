// Shared file-drop reader for curated recruitment JSON.
// One file = one company (or an array). File reads are observable: callers get
// per-file diagnostics and a completeness bit instead of treating failures as
// a legitimate empty snapshot. An empty directory is incomplete unless a
// caller has an explicit, separately documented empty-snapshot contract.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  RecruitmentAdapter,
  RecruitmentAdapterResult,
  RecruitmentSourceKind,
  SourceCompany,
  SourceFileDiagnostic,
} from '../recruitment-source.ts';

function asCompany(raw: unknown): SourceCompany | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<SourceCompany>;
  if (typeof row.slug !== 'string' || typeof row.name !== 'string') return null;
  if (!Array.isArray(row.sites) || !Array.isArray(row.positions)) return null;
  return row as SourceCompany;
}

export interface ParsedSourceCompanyPayload {
  companies: SourceCompany[];
  invalidRecords: number;
}

export function parseSourceCompanyPayloadDetailed(raw: unknown): ParsedSourceCompanyPayload {
  const records = Array.isArray(raw) ? raw : [raw];
  const companies: SourceCompany[] = [];
  let invalidRecords = 0;
  for (const record of records) {
    const company = asCompany(record);
    if (company) companies.push(company);
    else invalidRecords += 1;
  }
  return { companies, invalidRecords };
}

/** Backwards-compatible pure parser for callers that only need valid rows. */
export function parseSourceCompanyPayload(raw: unknown): SourceCompany[] {
  return parseSourceCompanyPayloadDetailed(raw).companies;
}

type SourceCompanyParser = (raw: unknown) => ParsedSourceCompanyPayload;

export async function listSourceCompanyFilesDetailed(
  dir: string,
  parse: SourceCompanyParser = parseSourceCompanyPayloadDetailed,
): Promise<RecruitmentAdapterResult> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      companies: [],
      diagnostics: [{
        file: dir,
        kind: code === 'ENOENT' ? 'missing-directory' : 'read-directory-failed',
        message: code === 'ENOENT' ? 'directory does not exist' : `directory read failed: ${code ?? 'unknown error'}`,
      }],
      completeness: 'incomplete',
    };
  }

  const jsonNames = names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort();
  const diagnostics: SourceFileDiagnostic[] = [];
  let complete = true;
  if (names.length === 0) {
    diagnostics.push({ file: dir, kind: 'empty-directory', message: 'directory exists and contains no entries' });
    complete = false;
  } else if (jsonNames.length === 0) {
    diagnostics.push({ file: dir, kind: 'no-json-files', message: 'directory contains no readable JSON drop files' });
    complete = false;
  }

  const companies: SourceCompany[] = [];
  for (const name of jsonNames) {
    const file = join(dir, name);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      diagnostics.push({
        file,
        kind: 'unreadable-file',
        message: `file read failed: ${code ?? 'unknown error'}`,
      });
      complete = false;
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      diagnostics.push({ file, kind: 'invalid-json', message: 'file is not valid JSON' });
      complete = false;
      continue;
    }

    const parsed = parse(raw);
    companies.push(...parsed.companies);
    if (parsed.invalidRecords > 0) {
      diagnostics.push({
        file,
        kind: 'invalid-record',
        message: `${parsed.invalidRecords} record(s) failed the source-company shape`,
      });
      complete = false;
    }
  }

  return { companies, diagnostics, completeness: complete ? 'complete' : 'incomplete' };
}

export async function listSourceCompanyFiles(dir: string): Promise<SourceCompany[]> {
  return (await listSourceCompanyFilesDetailed(dir)).companies;
}

export function fileDropAdapter(kind: RecruitmentSourceKind, dir: string): RecruitmentAdapter {
  return {
    kind,
    list: () => listSourceCompanyFiles(dir),
    listDetailed: () => listSourceCompanyFilesDetailed(dir),
  };
}

export function defaultDropDir(folder: string): string {
  return join(process.cwd(), 'data', 'recruitment', folder);
}
