// Batch hydration for navigation candidates. Keep this read narrow so a
// compare/filter request never materializes the full Work catalog.

import { getPool, queryPublicRead } from '../db.ts';
import { isCityCenterPin } from '../city-centers.ts';
import type { ApplySource, JobFamily } from '../types.ts';
import type { WorkPositionDetailRecord } from '../recruitment-store.ts';

type DbPoolLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

interface PositionDetailRow {
  external_id: string;
  title: string;
  department: string | null;
  family: JobFamily;
  salary_min: string | number | null;
  salary_max: string | number | null;
  education: string | null;
  deadline: Date | string | null;
  apply_source: ApplySource | null;
  status: 'open' | 'closed' | 'paused';
  site_id: string | null;
  slug: string;
  company_name: string;
  site_name: string | null;
  city: string | null;
  lng: number | null;
  lat: number | null;
}

function numberValue(value: string | number | null): number | undefined {
  if (value == null) return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isoDate(value: Date | string | null): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function plausibleCoordinate(lng: number | null, lat: number | null): boolean {
  return Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);
}

function rowToRecord(row: PositionDetailRow): WorkPositionDetailRecord {
  const siteId = row.site_id ?? undefined;
  const record: WorkPositionDetailRecord = {
    positionId: row.external_id,
    title: row.title,
    family: row.family,
    companyCatalogId: siteId ? `${row.slug}:${siteId}` : row.slug,
    companyName: row.company_name,
    status: row.status,
  };
  if (row.department) record.department = row.department;
  if (row.city) record.city = row.city;
  if (siteId) record.siteId = siteId;
  if (row.site_name) record.siteLabel = row.site_name;
  if (row.salary_min != null || row.salary_max != null) {
    record.salary = {
      min: numberValue(row.salary_min) ?? 0,
      max: numberValue(row.salary_max) ?? 0,
    };
  }
  if (row.education) record.education = row.education;
  const deadline = isoDate(row.deadline);
  if (deadline) record.deadline = deadline;
  if (row.apply_source) record.applySource = row.apply_source;
  if (plausibleCoordinate(row.lng, row.lat) && !isCityCenterPin(row.lng as number, row.lat as number)) {
    record.location = {
      lng: row.lng as number,
      lat: row.lat as number,
      coordinateSystem: 'gcj02',
    };
  }
  return record;
}

/**
 * Resolve visible navigation positions with one bound ANY query.
 * Returned records follow the caller's first-seen ID order; duplicate and
 * invisible IDs are omitted. The function deliberately returns [] when the
 * optional DB is unavailable, matching the old resolver's no-candidate result.
 */
export async function loadWorkPositionsByExternalIdsFromDb(
  externalIds: readonly string[],
  pool: DbPoolLike | null = getPool(),
): Promise<WorkPositionDetailRecord[]> {
  const ids = [...new Set(externalIds.map((id) => id.trim()).filter(Boolean))];
  if (!pool || ids.length === 0) return [];
  try {
    const result = await queryPublicRead<PositionDetailRow>(
      pool,
      `SELECT p.external_id, p.title, p.department, p.family,
              p.salary_min, p.salary_max, p.education, p.deadline,
              p.apply_source, p.status, p.site_id::text,
              c.slug, c.name AS company_name,
              s.name AS site_name, s.city, s.lng, s.lat
       FROM positions p
       INNER JOIN companies c ON c.id = p.company_id
       LEFT JOIN company_sites s ON s.id = p.site_id
       WHERE p.external_id = ANY($1::text[])
         AND p.status = 'open'
         AND (p.deadline IS NULL OR p.deadline >= CURRENT_DATE)
       ORDER BY array_position($1::text[], p.external_id)`,
      [ids],
    );
    const records = new Map<string, WorkPositionDetailRecord>();
    for (const row of result.rows) {
      if (!records.has(row.external_id)) records.set(row.external_id, rowToRecord(row));
    }
    return ids.map((id) => records.get(id)).filter((record): record is WorkPositionDetailRecord => record != null);
  } catch {
    return [];
  }
}
