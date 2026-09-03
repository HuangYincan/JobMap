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
import { canonicalSourceForAdapter } from '../recruitment-source.ts';

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

export interface FileDropOptions {
  /** Canonical source code to stamp onto source-less nested records. */
  sourceCode?: string;
  /** README-only/missing directories are an explicit no-op, not a snapshot. */
  optionalNoop?: boolean;
}

function stampSource(company: SourceCompany, sourceCode: string): SourceCompany {
  return {
    ...company,
    source: company.source?.trim() || sourceCode,
    sites: company.sites.map((site) => ({
      ...site,
      source: site.source?.trim() || sourceCode,
    })),
    positions: company.positions.map((position) => ({
      ...position,
      source: position.source?.trim() || sourceCode,
    })),
  };
}

export async function listSourceCompanyFilesDetailed(
  dir: string,
  parse: SourceCompanyParser = parseSourceCompanyPayloadDetailed,
  options: FileDropOptions = {},
): Promise<RecruitmentAdapterResult> {
  const sourceCode = options.sourceCode?.trim() || 'seed';
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const noOp = options.optionalNoop && code === 'ENOENT';
    return {
      sourceCode,
      companies: [],
      diagnostics: [{
        file: dir,
        kind: code === 'ENOENT' ? 'missing-directory' : 'read-directory-failed',
        message: code === 'ENOENT' ? 'directory does not exist' : `directory read failed: ${code ?? 'unknown error'}`,
        ...(noOp ? { blocking: false } : {}),
      }],
      completeness: noOp ? 'complete' : 'incomplete',
      snapshot: noOp ? 'noop' : 'authoritative',
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

  if (!complete && options.optionalNoop && (names.length === 0 || jsonNames.length === 0)) {
    return {
      sourceCode,
      companies: [],
      diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic, blocking: false })),
      completeness: 'complete',
      snapshot: 'noop',
    };
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

  return {
    sourceCode,
    companies: companies.map((company) => stampSource(company, sourceCode)),
    diagnostics,
    completeness: complete ? 'complete' : 'incomplete',
    snapshot: 'authoritative',
  };
}

export async function listSourceCompanyFiles(
  dir: string,
  parse: SourceCompanyParser = parseSourceCompanyPayloadDetailed,
  options: FileDropOptions = {},
): Promise<SourceCompany[]> {
  return (await listSourceCompanyFilesDetailed(dir, parse, options)).companies;
}

export function fileDropAdapter(
  kind: RecruitmentSourceKind,
  dir: string,
  options: Omit<FileDropOptions, 'sourceCode'> = {},
): RecruitmentAdapter {
  const sourceCode = canonicalSourceForAdapter(kind);
  return {
    kind,
    list: () => listSourceCompanyFiles(dir, parseSourceCompanyPayloadDetailed, { ...options, sourceCode }),
    listDetailed: () => listSourceCompanyFilesDetailed(dir, parseSourceCompanyPayloadDetailed, { ...options, sourceCode }),
  };
}

export function defaultDropDir(folder: string): string {
  return join(process.cwd(), 'data', 'recruitment', folder);
}
