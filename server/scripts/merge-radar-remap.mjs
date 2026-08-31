#!/usr/bin/env node
// ============================================================
// merge-radar-remap.mjs — radar 重映射增量合并进现有 drops
//
// 背景: `make refresh-radar` / cli radar 是整文件覆写 —— 全量重刷会把已
// geocode 的 1478 个真实坐标与历史打标(tier/category)一并冲掉(事故记录:
// fix-sweep-accident-coords.mjs, fbc4448)。本脚本只做「加法」:
//
//   输入:重映射产物目录(每公司一文件,radar_jobs.py 全量输出)
//   对每个 slug:
//     - drops 无此文件 → 整文件落盘(新公司)
//     - 已有 → 合并 sites(按 site.id 去重,新增站保留;已有站的
//       city/province/address 缺字段回填) + positions(按 externalId 去重);
//       已有坐标 / tier / category / logo 等策展字段一律不动。
//
// 用法:
//   node scripts/merge-radar-remap.mjs <remapped-dir> [--dry-run]
//   (缺 --dry-run 时直接写 server/data/recruitment/radar/)
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADAR_DIR = join(__dirname, '..', 'data', 'recruitment', 'radar');
const DRY_RUN = process.argv.includes('--dry-run');
const srcDir = process.argv[2];

if (!srcDir) {
  console.error('用法: node scripts/merge-radar-remap.mjs <remapped-dir> [--dry-run]');
  process.exit(2);
}

function listCompanies(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.startsWith('_') || name.startsWith('.')) continue;
    out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
  }
  return out;
}

let newCompanies = 0;
let mergedCompanies = 0;
let addedSites = 0;
let backfilledSiteFields = 0;
let addedPositions = 0;
/** {slug: {newSites: string[], newPositions: number}} */
const detail = {};

for (const mapped of listCompanies(srcDir)) {
  const path = join(RADAR_DIR, `${mapped.slug}.json`);
  let existing = null;
  try {
    existing = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    /* 新公司或读失败 → 落整文件 */
  }
  const entry = { newSites: [], newPositions: 0 };
  if (!existing || !Array.isArray(existing.sites)) {
    entry.newSites = mapped.sites.map((s) => s.id);
    entry.newPositions = mapped.positions.length;
    detail[mapped.slug] = entry;
    newCompanies += 1;
    if (!DRY_RUN) writeFileSync(path, JSON.stringify(mapped, null, 2) + '\n');
    continue;
  }

  // --- sites:按 id 增量;已有站只回填缺失的 city/province/address ---
  const knownSites = new Set(existing.sites.map((s) => s.id));
  for (const site of mapped.sites ?? []) {
    if (!knownSites.has(site.id)) {
      existing.sites.push(site);
      knownSites.add(site.id);
      addedSites += 1;
      entry.newSites.push(site.id);
      continue;
    }
    const cur = existing.sites.find((s) => s.id === site.id);
    for (const field of ['city', 'province']) {
      if (!cur[field] && site[field]) {
        cur[field] = site[field];
        backfilledSiteFields += 1;
      }
    }
  }

  // --- positions:按 externalId 增量 ---
  const knownPos = new Set(existing.positions.map((p) => p.externalId));
  for (const pos of mapped.positions ?? []) {
    if (knownPos.has(pos.externalId)) continue;
    existing.positions.push(pos);
    knownPos.add(pos.externalId);
    addedPositions += 1;
    entry.newPositions += 1;
  }

  if (entry.newSites.length || entry.newPositions) {
    mergedCompanies += 1;
    detail[mapped.slug] = entry;
    if (!DRY_RUN) writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
  }
}

const summary = {
  dryRun: DRY_RUN,
  newCompanies,
  mergedCompanies,
  addedSites,
  backfilledSiteFields,
  addedPositions,
};
console.log(JSON.stringify(summary, null, 2));
if (process.env.MERGE_DETAIL) {
  console.log(JSON.stringify(detail, null, 2));
}
if (DRY_RUN) {
  console.log('(--dry-run: 未写入任何文件)');
}
