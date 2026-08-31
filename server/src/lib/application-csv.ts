// ============================================================
// 投递监视 CSV（浏览器 + 服务端同构）
//
// 五列: 公司/company, 岗位/title, 阶段/status, 投递链接/apply_url, 投递时间/applied_at
// UTF-8 BOM，逗号分隔。阶段认 id 或词表标签；非法链接/日期当空。
// ============================================================

import type { ApplicationRecord } from './account.ts';
import {
  fallbackStatusId,
  lookupStatusDef,
  resolveStatusLabel,
  resolveWatchStatus,
  type ApplicationStatusDef,
} from './application-pipeline.ts';
import type { Language } from './i18n.ts';

export const APPLICATION_CSV_IMPORT_MAX = 200;
export const APPLICATION_CSV_LINE_MAX = 2000;
export const APPLICATION_TITLE_MAX = 200;
export const APPLICATION_COMPANY_NAME_MAX = 200;
export const APPLICATION_ID_MAX = 200;
export const APPLICATION_APPLY_URL_MAX = 2048;
export const MANUAL_APPLICATION_PREFIX = 'manual:';

export const APPLICATION_CSV_HEADERS = {
  zh: ['公司', '岗位', '阶段', '投递链接', '投递时间'],
  en: ['company', 'title', 'status', 'apply_url', 'applied_at'],
} as const;

export type ApplicationCsvSkipReason = 'missing_fields' | 'too_long' | 'too_many';

export interface ApplicationCsvRow {
  companyName: string;
  title: string;
  status?: string;
  applyUrl?: string;
  appliedAt?: string;
}

export interface ApplicationCsvSkip {
  line: number;
  reason: ApplicationCsvSkipReason;
}

export interface ApplicationCsvParseResult {
  rows: ApplicationCsvRow[];
  skipped: ApplicationCsvSkip[];
}

type CsvColumn = 'company' | 'title' | 'status' | 'applyUrl' | 'appliedAt';

const HEADER_ALIASES: Record<string, CsvColumn> = {
  公司: 'company',
  company: 'company',
  岗位: 'title',
  title: 'title',
  阶段: 'status',
  status: 'status',
  投递链接: 'applyUrl',
  applyurl: 'applyUrl',
  apply_url: 'applyUrl',
  投递时间: 'appliedAt',
  appliedat: 'appliedAt',
  applied_at: 'appliedAt',
};

export function isManualApplicationId(id: string): boolean {
  return id.startsWith(MANUAL_APPLICATION_PREFIX);
}

export function normalizeApplicationKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isHttpApplyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** YYYY-MM-DD 或 ISO；非法 / 明显未来 → undefined。 */
export function parseAppliedAt(raw: string, now = Date.now()): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  if (ms > now + 86_400_000) return undefined;
  return new Date(ms).toISOString();
}

export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s]/g, '');
}

function mapHeaderRow(cells: string[]): Partial<Record<CsvColumn, number>> {
  const map: Partial<Record<CsvColumn, number>> = {};
  cells.forEach((cell, index) => {
    const trimmed = cell.trim();
    const aliased = HEADER_ALIASES[trimmed] ?? HEADER_ALIASES[normalizeHeader(trimmed)];
    if (aliased && map[aliased] === undefined) map[aliased] = index;
  });
  return map;
}

function cellAt(row: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return (row[index] ?? '').trim();
}

export function parseApplicationCsv(text: string): ApplicationCsvParseResult {
  const table = parseCsvText(text).slice(0, APPLICATION_CSV_LINE_MAX);
  if (table.length === 0) return { rows: [], skipped: [] };
  const header = mapHeaderRow(table[0]);
  const rows: ApplicationCsvRow[] = [];
  const skipped: ApplicationCsvSkip[] = [];
  const seen = new Map<string, number>();
  for (let i = 1; i < table.length; i += 1) {
    const line = i + 1;
    const companyName = cellAt(table[i], header.company);
    const title = cellAt(table[i], header.title);
    if (!companyName || !title) {
      skipped.push({ line, reason: 'missing_fields' });
      continue;
    }
    if (companyName.length > APPLICATION_COMPANY_NAME_MAX || title.length > APPLICATION_TITLE_MAX) {
      skipped.push({ line, reason: 'too_long' });
      continue;
    }
    const rawUrl = cellAt(table[i], header.applyUrl);
    const applyUrl = rawUrl && isHttpApplyUrl(rawUrl) && rawUrl.length <= APPLICATION_APPLY_URL_MAX
      ? rawUrl
      : undefined;
    const status = cellAt(table[i], header.status) || undefined;
    const appliedAt = parseAppliedAt(cellAt(table[i], header.appliedAt));
    const row: ApplicationCsvRow = {
      companyName,
      title,
      ...(status ? { status } : {}),
      ...(applyUrl ? { applyUrl } : {}),
      ...(appliedAt ? { appliedAt } : {}),
    };
    const key = `${normalizeApplicationKey(companyName)}\0${normalizeApplicationKey(title)}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      rows[existing] = row;
      continue;
    }
    if (rows.length >= APPLICATION_CSV_IMPORT_MAX) {
      skipped.push({ line, reason: 'too_many' });
      continue;
    }
    seen.set(key, rows.length);
    rows.push(row);
  }
  return { rows, skipped };
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function dateStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

export function serializeApplicationCsv(
  items: ApplicationRecord[],
  options: { statuses: ApplicationStatusDef[]; lang: Language },
): string {
  const headers = APPLICATION_CSV_HEADERS[options.lang];
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const item of items) {
    const status = resolveStatusLabel(lookupStatusDef(options.statuses, item.status), options.lang);
    lines.push(
      [
        item.companyName,
        item.title,
        status,
        item.applyUrl ?? '',
        dateStamp(item.createdAt),
      ].map(escapeCsvField).join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function serializeApplicationCsvTemplate(lang: Language): string {
  const headers = APPLICATION_CSV_HEADERS[lang];
  const examples = lang === 'zh'
    ? [
      ['字节跳动', '前端开发工程师', '已投递', 'https://jobs.bytedance.com/example', '2026-08-31'],
      ['阿里巴巴', 'Java', '面试中', '', '2026-08-20'],
    ]
    : [
      ['ByteDance', 'Frontend Engineer', 'Applied', 'https://jobs.bytedance.com/example', '2026-08-31'],
      ['Alibaba', 'Java', 'Interview', '', '2026-08-20'],
    ];
  const lines = [
    headers.map(escapeCsvField).join(','),
    ...examples.map((row) => row.map(escapeCsvField).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function statusForCsvRow(
  row: ApplicationCsvRow,
  catalog: ApplicationStatusDef[],
  lang: Language,
): string {
  return resolveWatchStatus(row.status, catalog, lang) || fallbackStatusId(catalog);
}
