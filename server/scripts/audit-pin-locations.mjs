#!/usr/bin/env node
// Two-layer pin audit against AMap Web services.
// Layer 1: geocode the stored site address (street address only — appending the
//          company name pollutes the query) and measure the offset to the pin.
// Layer 2: regeocode the stored coordinate and print the district it lands in.
// Requires AMAP_WEB_KEY + DATABASE_URL in env (reads server/.env.local via Next
// normally; for direct runs export both). Never prints the key.

import { getPool } from '../src/lib/db.ts';

function amapUrl(path, params) {
  const url = new URL(`https://restapi.amap.com/v3/${path}`);
  url.searchParams.set('key', process.env.AMAP_WEB_KEY || '');
  url.searchParams.set('output', 'JSON');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url;
}

async function amap(path, params) {
  const res = await fetch(amapUrl(path, params));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function km(lng1, lat1, lng2, lat2) {
  const r = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

const pool = getPool();
if (!pool) {
  console.error('No DATABASE_URL — cannot read pins.');
  process.exit(1);
}
const { rows } = await pool.query(
  `SELECT c.slug, s.address, s.lng, s.lat
     FROM company_sites s JOIN companies c ON c.id = s.company_id
    WHERE s.lng IS NOT NULL AND s.lat IS NOT NULL AND s.lng <> 0 AND s.lat <> 0
      AND EXISTS (SELECT 1 FROM positions p WHERE p.site_id = s.id AND p.status = 'open')
    ORDER BY c.slug`,
);

const report = [];
let fails = 0;
for (const row of rows) {
  const entry = { slug: row.slug, stored: [row.lng, row.lat], address: row.address };
  try {
    const geo = await amap('geocode/geo', { address: `杭州市${row.address}`, city: '杭州' });
    const g = (geo.geocodes || [])[0];
    if (g?.location) {
      const [glng, glat] = g.location.split(',').map(Number);
      entry.offsetKm = Number(km(row.lng, row.lat, glng, glat).toFixed(3));
      entry.geocoded = [glng, glat];
    }
  } catch (err) {
    entry.geoError = String(err).slice(0, 60);
  }
  await new Promise((r) => setTimeout(r, 600));
  try {
    const re = await amap('geocode/regeo', { location: `${row.lng},${row.lat}` });
    const rc = re.regeocode || {};
    entry.regeoDistrict = (rc.addressComponent || {}).district || '?';
  } catch (err) {
    entry.regeoError = String(err).slice(0, 60);
  }
  await new Promise((r) => setTimeout(r, 600));
  const off = entry.offsetKm;
  const verdict = off == null ? 'ERROR' : off < 1.0 ? 'PASS' : off < 2.5 ? 'WARN' : 'FAIL';
  entry.verdict = verdict;
  if (verdict !== 'PASS') fails += 1;
  report.push(entry);
  console.log(
    `${verdict.padEnd(5)} ${row.slug.padEnd(18)} offset ${off == null ? 'n/a' : `${off} km`.padEnd(8)} district ${entry.regeoDistrict}`,
  );
}
await pool.end();
console.log(`RESULT: ${report.length - fails}/${report.length} PASS${fails ? ` — ${fails} need attention` : ''}`);
process.exitCode = fails ? 1 : 0;
