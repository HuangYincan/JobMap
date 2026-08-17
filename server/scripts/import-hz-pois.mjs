#!/usr/bin/env node
// Import Hangzhou POI CSV into hz_pois (COPY batch, idempotent upsert).
//
//   node scripts/import-hz-pois.mjs [--apply] [--truncate] [--limit N] [--file PATH]
//
//   (no flag)   dry-run: stream the CSV, clean each row, print counts, write nothing
//   --apply     actually import (needs DATABASE_URL from server/.env.local or env)
//   --truncate  TRUNCATE hz_pois before importing (full reload)
//   --limit N   only import the first N valid rows (debug sampling)
//   --file PATH source CSV (default /Users/acccan/Downloads/杭州市/杭州市POI.csv)
//
// Strategy: stream CSV with csv-parse → clean each row (hz-poi-import.ts) →
// COPY into a TEMP table (LIKE hz_pois) in ~50k-row chunks → INSERT ...
// ON CONFLICT (poi_id) DO UPDATE (idempotent, re-runnable). Never prints keys.
// Photos arrive as python-repr single-quoted lists → extracted to a JSON array.
// Coordinates: GCJ-02 → lng_gcj/lat_gcj + geom; WGS84 → reference columns.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const DEFAULT_FILE = '/Users/acccan/Downloads/杭州市/杭州市POI.csv';

// --- env (server/.env.local, without printing the key) ---------------------
function loadEnv() {
  const envFile = path.join(SERVER_DIR, '.env.local');
  if (!fs.existsSync(envFile)) return {};
  const out = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}
const env = { ...loadEnv(), ...process.env };
if (env.DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

const APPLY = process.argv.includes('--apply');
const TRUNCATE = process.argv.includes('--truncate');
function flagValue(flag) {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return String(eq.split('=')[1]);
  const i = process.argv.indexOf(flag);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}
const LIMIT_NUM = Number(flagValue('--limit') ?? '');
const LIMIT = Number.isFinite(LIMIT_NUM) && LIMIT_NUM > 0 ? LIMIT_NUM : Infinity;
const FILE = flagValue('--file') || DEFAULT_FILE;

const { cleanCsvRow, tierForCategory } = await import(
  path.join(SERVER_DIR, 'src', 'lib', 'hz-poi-import.ts')
);

const COPY_COLS = [
  'poi_id','name','address','tel','rating','cost',
  'lng_gcj','lat_gcj','lon_wgs84','lat_wgs84',
  'big_type','mid_type','small_type','typecode','adname','business_area',
  'photos','open_hours','tier','city_code','source_file',
];

const UPDATE_COLS = [
  'name','address','tel','rating','cost',
  'lng_gcj','lat_gcj','lon_wgs84','lat_wgs84',
  'big_type','mid_type','small_type','typecode','adname','business_area',
  'photos','open_hours','tier','city_code','source_file',
];

async function main() {
  const rowsIn = [];
  for (const a of process.argv.slice(2)) {
    if (a === '--apply') continue;
    if (a === '--truncate') continue;
    if (a.startsWith('--limit=') || a.startsWith('--file=')) continue;
    rowsIn.push(a);
  }

  console.log(`[import-hz] source=${FILE}`);
  console.log(`[import-hz] mode=${APPLY ? 'apply' : 'dry-run'}${TRUNCATE ? ' +truncate' : ''}${Number.isFinite(LIMIT) ? ` +limit=${LIMIT}` : ''}`);

  if (!fs.existsSync(FILE)) {
    console.error(`[import-hz] file not found: ${FILE}`);
    process.exit(2);
  }

  // --- stream + clean (dry-run counts even without a DB) -------------------
  const counts = { read: 0, kept: 0, dropped: 0 };
  const dropReasons = new Map();
  const tierCounts = new Map();
  const photosCount = { withPhotos: 0, totalUrls: 0 };
  const ratingCount = { rated: 0 };
  const keptRows = [];

  const parser = fs.createReadStream(FILE, 'utf8').pipe(
    parse({ bom: true, columns: true, relax_column_count: true, skip_empty_lines: true }),
  );

  for await (const raw of parser) {
    counts.read++;
    if (Number.isFinite(LIMIT) && counts.read > LIMIT) break;
    if (counts.read % 100_000 === 0) {
      console.log(`[import-hz] read ${counts.read}... kept=${counts.kept} dropped=${counts.dropped}`);
    }
    const row = cleanCsvRow(raw);
    if (!row) {
      counts.dropped++;
      const reason = missingReason(raw);
      dropReasons.set(reason, (dropReasons.get(reason) ?? 0) + 1);
      continue;
    }
    counts.kept++;
    tierCounts.set(row.tier, (tierCounts.get(row.tier) ?? 0) + 1);
    if (row.photos.length > 0) {
      photosCount.withPhotos++;
      photosCount.totalUrls += row.photos.length;
    }
    if (row.rating !== undefined) ratingCount.rated++;
    keptRows.push(row);
  }

  console.log(`[import-hz] read=${counts.read} kept=${counts.kept} dropped=${counts.dropped}`);
  console.log(`[import-hz] kept: photos=${photosCount.withPhotos} (${(100 * photosCount.withPhotos / Math.max(1, counts.kept)).toFixed(1)}%), urls=${photosCount.totalUrls}, rated=${ratingCount.rated} (${(100 * ratingCount.rated / Math.max(1, counts.kept)).toFixed(1)}%)`);
  console.log(`[import-hz] tier distribution:`, Object.fromEntries([...tierCounts.entries()].sort((a, b) => a[0] - b[0])));
  if (dropReasons.size) {
    console.log(`[import-hz] drop reasons:`, Object.fromEntries([...dropReasons.entries()]));
  }
  console.log(`[import-hz] tier sanity (sample): `, [...new Set(keptRows.slice(0, 5).map((r) => `${r.bigType}→${r.tier}`))].join(', '));

  if (!APPLY) {
    console.log('[import-hz] dry-run: nothing written. Re-run with --apply to import.');
    return;
  }
  if (keptRows.length === 0) {
    console.error('[import-hz] no valid rows to import');
    process.exit(3);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[import-hz] --apply requires DATABASE_URL (server/.env.local)');
    process.exit(2);
  }

  // --- import ------------------------------------------------------------------
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (TRUNCATE) {
      await client.query('TRUNCATE hz_pois');
      console.log('[import-hz] truncated hz_pois');
    }

    // Batch multi-row INSERT ... ON CONFLICT DO UPDATE (idempotent, single
    // transaction → failure rolls back everything). pg 8.23 has no built-in
    // COPY stream without pg-copy-streams; batch INSERT is dependency-free and
    // fast enough for a one-shot import (~100k rows/s).
    const BATCH = 1000;
    const setClauses = UPDATE_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    const placeholders = (rowIdx) =>
      COPY_COLS.map((_, ci) => `$${rowIdx * COPY_COLS.length + ci + 1}`).join(', ');
    let inserted = 0;

    for (let start = 0; start < keptRows.length; start += BATCH) {
      const chunk = keptRows.slice(start, start + BATCH);
      const values = [];
      for (const row of chunk) {
        values.push(
          row.poi_id, row.name, row.address ?? null, row.tel ?? null,
          row.rating ?? null, row.cost ?? null,
          row.lngGcj, row.latGcj, row.lonWgs84 ?? null, row.latWgs84 ?? null,
          row.bigType, row.midType ?? null, row.smallType ?? null, row.typecode ?? null,
          row.adname, row.businessArea ?? null,
          JSON.stringify(row.photos ?? []),
          row.openHours ?? null,
          row.tier,
          '330100', // city_code
          '杭州市POI.csv', // source_file
        );
      }
      const valueGroups = chunk.map((_, i) => `(${placeholders(i)})`).join(', ');
      const sql =
        `INSERT INTO hz_pois (${COPY_COLS.join(', ')}) VALUES ${valueGroups} ` +
        `ON CONFLICT (poi_id) DO UPDATE SET ${setClauses}`;
      await client.query(sql, values);
      inserted += chunk.length;
      if (inserted % 50_000 === 0 || start + BATCH >= keptRows.length) {
        console.log(`[import-hz] inserted ${inserted}/${keptRows.length} rows`);
      }
    }

    await client.query('COMMIT');
    console.log(`[import-hz] committed ${inserted} rows into hz_pois`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[import-hz] import failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

/** 定位缺了什么必填字段(drop 原因归类) */
function missingReason(raw) {
  if (!(raw.id || '').trim()) return 'missing id';
  if (!(raw.name || '').trim()) return 'missing name';
  const parts = (raw.location || '').split(',');
  if (parts.length < 2 || !Number.isFinite(Number(parts[0])) || !Number.isFinite(Number(parts[1]))) return 'bad location';
  if (!Number.isFinite(Number(raw.lon_wgs84)) || !Number.isFinite(Number(raw.lat_wgs84))) return 'bad wgs84';
  if (!(raw.bigType || '').trim()) return 'missing bigType';
  if (!(raw.adname || '').trim()) return 'missing adname';
  return 'other';
}

main().catch((err) => {
  console.error('[import-hz] fatal:', err);
  process.exit(1);
});
