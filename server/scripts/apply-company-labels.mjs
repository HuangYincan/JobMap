// ============================================================
// apply-company-labels.mjs — 把打标结果(tier/category)写回 drops
//
// 输入:打标映射 JSON 文件列表(如 /tmp/labeled_28.json /tmp/label_batch_0..4.json)
//   格式:{slug: {tier: 0..21, category: '64'}}
// 用法:
//   node --experimental-strip-types --no-warnings scripts/apply-company-labels.mjs \
//     /tmp/labeled_28.json /tmp/label_batch_0.json /tmp/label_batch_1.json \
//     /tmp/label_batch_2.json /tmp/label_batch_3.json /tmp/label_batch_4.json
//   --dry-run:只报告不改写
//
// 行为:遍历 server/data/recruitment/{radar,official-career}/*.json,
//   slug 命中 → 更新 tier、设置 category(保持原字段不变);
//   未命中 → 记录警告。幂等,可重复运行。
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataRoot = join(root, 'server', 'data', 'recruitment');
const DRY_RUN = process.argv.includes('--dry-run');
const labelFiles = process.argv.slice(2).filter((a) => !a.startsWith('-'));

if (!labelFiles.length) {
  console.error('用法: apply-company-labels.mjs <labels.json...> [--dry-run]');
  process.exit(2);
}

const labels = {};
for (const f of labelFiles) {
  Object.assign(labels, JSON.parse(readFileSync(f, 'utf8')));
}
const slugs = Object.keys(labels);
console.log(`打标映射: ${slugs.length} 家`);

const { LABEL_CATEGORIES, TIER_MIN, TIER_MAX } = await import('./label-categories.mjs');
const errors = [];
for (const [slug, label] of Object.entries(labels)) {
  if (!Number.isInteger(label.tier) || label.tier < TIER_MIN || label.tier > TIER_MAX) errors.push(`${slug}: tier ${label.tier}`);
  if (typeof label.category !== 'string' || !LABEL_CATEGORIES.has(label.category)) errors.push(`${slug}: category ${label.category}`);
}
if (errors.length) {
  console.error(`映射非法(${errors.length}):\n  ${errors.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}

let updated = 0, untouched = 0, missing = 0;
const dirs = ['radar', 'official-career'];
for (const dir of dirs) {
  for (const file of readdirSync(join(dataRoot, dir)).filter((f) => f.endsWith('.json'))) {
    const path = join(dataRoot, dir, file);
    const drop = JSON.parse(readFileSync(path, 'utf8'));
    const label = labels[drop.slug];
    if (!label) { missing += 1; console.warn(`[未命中] ${drop.slug} (${dir}/${file})`); continue; }
    const tierChanged = drop.tier !== label.tier;
    const catChanged = drop.category !== label.category;
    if (tierChanged || catChanged) {
      if (!DRY_RUN) {
        drop.tier = label.tier;
        drop.category = label.category;
        writeFileSync(path, JSON.stringify(drop, null, 2) + '\n', 'utf8');
      }
      updated += 1;
    } else {
      untouched += 1;
    }
  }
}
console.log(
  `${DRY_RUN ? '[dry-run] ' : ''}更新 ${updated} 个文件,已一致 ${untouched},未命中 ${missing}`,
);
