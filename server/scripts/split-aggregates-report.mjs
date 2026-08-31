// ============================================================
// split-aggregates-report.mjs — 聚合行拆解计划生成器
//
// 读 validation-report-<date>.json,把 isAggregateRow 的岗位按公司分组,
// 输出拆解清单 markdown:聚合标题 → suggestedSplit 拆解建议。
// 供「聚合行拆解」数据修正任务使用(tech/20 B2)。
//
// 用法: node --experimental-strip-types --no-warnings \
//   scripts/split-aggregates-report.mjs [report.json] [out.md]
// ============================================================

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reportDir = join(root, 'tech', 'roles', 'data');
const reportFile = process.argv[2] ?? readdirSync(reportDir).filter((f) => f.startsWith('validation-report-') && f.endsWith('.json')).sort().at(-1);
const outFile = process.argv[3] ?? join(reportDir, `split-plan-${reportFile.replace(/^validation-report-/, '').replace(/\.json$/, '')}.md`);

const report = JSON.parse(readFileSync(join(reportDir, reportFile), 'utf8'));
const items = report.items ?? [];
const agg = items.filter((i) => i.isAggregateRow);
const byCompany = new Map();
for (const i of agg) {
  const list = byCompany.get(i.slug) ?? [];
  list.push(i);
  byCompany.set(i.slug, list);
}
const lines = [
  `# 聚合行拆解计划(${reportFile})`,
  '',
  `共 ${agg.length} 条聚合行 / ${byCompany.size} 家公司。聚合行是真实招聘目录(标题为多岗位罗列),`,
  '拆解时按 `suggestedSplit` 把标题拆成具体岗位;无法拆解的保留为聚合标记。',
  '',
  '| 公司 | 聚合标题 | 拆解建议 |',
  '|---|---|---|',
];
for (const [slug, list] of [...byCompany.entries()].sort()) {
  for (const i of list) {
    const split = (i.suggestedSplit ?? []).join('、');
    lines.push(`| ${slug} | ${String(i.title ?? '').replace(/\n/g, ' ').slice(0, 60)} | ${split.slice(0, 120)} |`);
  }
}
writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
console.log(`拆解计划: ${agg.length} 条 / ${byCompany.size} 家 → ${outFile}`);
