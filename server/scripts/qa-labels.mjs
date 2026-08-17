// ============================================================
// qa-labels.mjs — 打标结果 QA(完整性 + 已知锚点 + 变体一致性)
//
// 用法:
//   node --experimental-strip-types --no-warnings scripts/qa-labels.mjs \
//     /tmp/labeled_28.json /tmp/label_batch_{0..4}.json
//
// 检查:
//   1. 覆盖率:全部 drops slug 都被打标(668 家)
//   2. tier ∈ 0..21 整数、category ∈ 允许集合
//   3. 已知锚点抽查:期望 tier 区间表,超出标记
//   4. 同名变体一致性:变体 slug(后缀 -ai实习生/-顶尖/-青岛/-寻星 等)
//      与主体的 tier/category 必须一致
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataRoot = join(root, 'server', 'data', 'recruitment');
const labelFiles = process.argv.slice(2);

const labels = {};
for (const f of labelFiles) Object.assign(labels, JSON.parse(readFileSync(f, 'utf8')));

// 1. 覆盖率
const allSlugs = new Set();
for (const dir of ['radar', 'official-career']) {
  for (const file of readdirSync(join(dataRoot, dir)).filter((f) => f.endsWith('.json'))) {
    allSlugs.add(JSON.parse(readFileSync(join(dataRoot, dir, file), 'utf8')).slug);
  }
}
const missing = [...allSlugs].filter((s) => !labels[s]);
const extra = Object.keys(labels).filter((s) => !allSlugs.has(s));
console.log(`drops ${allSlugs.size} 家,打标 ${Object.keys(labels).length} 家,未覆盖 ${missing.length} ${missing.join(',') || ''}${extra.length ? `,多余 ${extra.join(',')}` : ''}`);
if (missing.length) process.exitCode = 1;

// 2. 值域
const CATS = new Set(['63','64','65','66','67','68','69','27','36','38','39','34','35','44','26','52','54','59','73','74','85','86','87','89','82','70','72','14','15','18','25','37','48','56','01','03','other']);
const bad = Object.entries(labels).filter(
  ([, l]) => !Number.isInteger(l.tier) || l.tier < 0 || l.tier > 21 || typeof l.category !== 'string' || !CATS.has(l.category),
);
console.log(`值域非法: ${bad.length} ${bad.slice(0, 10).map(([s]) => s).join(',') || ''}`);

// 3. 已知锚点(期望 tier 区间;超出即警告)。slug 前缀精确匹配,注意「京东」≠「京东方」。
const ANCHORS = [
  ['字节', 0, 1], ['tencent', 0, 1], ['alibaba', 0, 1], ['huawei', 0, 2], ['nvidia', 0, 2], ['英伟达', 0, 2],
  ['deepseek', 0, 2], ['京东-tgt', 4, 5], ['京东tgt', 4, 5], ['京东', 4, 5], ['美团', 4, 5],
  ['拼多多', 4, 5], ['xiaomi', 4, 6], ['小米', 4, 6], ['netease', 4, 6], ['网易', 4, 6],
  ['antgroup', 4, 6], ['蚂蚁', 4, 6], ['didi', 4, 6], ['滴滴', 4, 6], ['比亚迪', 4, 6],
  ['bilibili', 5, 7], ['哔哩', 5, 7], ['快手', 4, 6], ['zhihu', 5, 7], ['megvii', 5, 7],
  ['unitree', 5, 8], ['leapmotor', 5, 8], ['dji', 1, 6], ['大疆', 1, 6], ['hikvision', 4, 7],
  ['海康', 4, 7], ['中芯', 5, 8], ['寒武纪', 6, 9], ['摩尔线程', 6, 9], ['米哈游', 4, 7],
  ['oppo', 4, 6], ['vivo', 4, 6], ['联想', 4, 7], ['京东方', 5, 8],
];
const warn = [];
for (const [name, lo, hi] of ANCHORS) {
  const hit = Object.entries(labels).filter(([slug]) => slug.startsWith(name));
  if (!hit.length) { warn.push(`${name}: 未找到`); continue; }
  for (const [slug, l] of hit) {
    if (l.tier < lo || l.tier > hi) warn.push(`${name}(${slug}): tier ${l.tier} 超出期望 [${lo},${hi}]`);
  }
}
console.log(`锚点警告 ${warn.length}:\n  ${warn.slice(0, 25).join('\n  ')}`);

// 4. 变体一致性:后缀变体与主体必须同 tier/category
const VARIANTS = ['ai实习生', '顶尖', '青岛', '寻星', '领跑者', '热招', '南华', '上海办公室', '华北区', '-taig'];
let vWarn = 0;
for (const [slug, l] of Object.entries(labels)) {
  for (const suf of VARIANTS) {
    if (slug.endsWith(suf)) {
      const base = slug.slice(0, -suf.length);
      const b = labels[base];
      if (b && (b.tier !== l.tier || b.category !== l.category)) {
        console.log(`  变体不一致: ${base}=${b.tier}/${b.category} vs ${slug}=${l.tier}/${l.category}`);
        vWarn += 1;
      }
    }
  }
}
console.log(`变体不一致: ${vWarn}`);
