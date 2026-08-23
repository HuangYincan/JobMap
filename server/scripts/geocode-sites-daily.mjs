#!/usr/bin/env node
// 每日 geocode 薄封装 (2026-08-23, ws-c): 跑 geocode-sites-apply.mjs, 配额耗尽
// (exit 2) 时打印明日续跑指引与剩余统计 (读 server/.geocode-progress.json)。
// 检索逻辑全部在 apply 脚本 — 本脚本只 spawn + 读进度文件 + 打印指引。
//
//   node scripts/geocode-sites-daily.mjs [--dry-run] [--cities 上海,北京] [--only a,b]
//   npm run geocode:sites:daily -- --cities 上海
//
// 退出码与 apply 一致: 0 = 正常完成 (配额内), 2 = QUOTA_EXHAUSTED (今日未跑完,
// 明日续跑), 其他 = 运行错误。
//
// 配额事实 (2026-08-23 查证, 个人开发者配额): AMap place-text ~100 次/日
//   (https://lbs.amap.com) + 百度 Web 服务地点检索 ~100 次/日
//   (https://lbsyun.baidu.com) + 腾讯 WebService 地点搜索 ~100 次/日
//   (https://lbs.qq.com) ≈ 300 站/日 — 2026-08-23 实测 backlog 1076 站
//   (上海 269 / 北京 246 / 深圳 182 …), 全量约 4 天。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const PROGRESS_FILE = path.join(SERVER_DIR, '.geocode-progress.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function topCities(byCity, top = 8) {
  if (!byCity?.length) return '无';
  const head = byCity.slice(0, top).map((c) => `${c.city} ${c.count}`).join(' | ');
  return byCity.length > top ? `${head} | …共 ${byCity.length} 城` : head;
}

const args = process.argv.slice(2);
const child = spawnSync(process.execPath, [path.join(__dirname, 'geocode-sites-apply.mjs'), ...args], {
  stdio: 'inherit',
});
const code = typeof child.status === 'number' ? child.status : 1;

const progress = readJson(PROGRESS_FILE);
const remainingTotal = progress?.remaining?.total ?? 0;
const byCity = progress?.remaining?.byCity ?? [];

if (code === 2) {
  console.log('\n=== 今日配额耗尽 — 明日续跑指引 ===');
  if (progress) {
    const r = progress.run ?? {};
    console.log(`上次运行 [${progress.mode}] @ ${progress.updatedAt} | 计划 ${r.planTotal ?? 0} 站 | 解析 ${r.resolved ?? 0} / 失败 ${r.unresolved ?? 0} / 写回 ${r.applied ?? 0}`);
    console.log(`剩余 ${remainingTotal} 站 (按城市): ${topCities(byCity)}`);
  }
  console.log('配额事实 (2026-08-23 查证, 个人开发者配额): AMap place-text ~100 次/日 (https://lbs.amap.com) + 百度 Web 服务地点检索 ~100 次/日 (https://lbsyun.baidu.com) + 腾讯 WebService 地点搜索 ~100 次/日 (https://lbs.qq.com) ≈ 300 站/日 — 1076 站全量约 4 天。');
  if (byCity[0]) {
    console.log(`明日续跑: npm run geocode:sites:daily -- --cities ${byCity[0].city}   (单城 ~${byCity[0].count} 站)`);
  } else {
    console.log('明日续跑: npm run geocode:sites:daily');
  }
  process.exit(2);
}

if (code === 0) {
  if (progress?.mode === 'DRY-RUN') {
    if (remainingTotal > 0) {
      console.log(`\n[dry-run] 模拟完成, 未写坐标 — 真实待跑 ${remainingTotal} 站 (按城市): ${topCities(byCity)}`);
      if (byCity[0]) console.log(`正式跑: npm run geocode:sites:daily -- --cities ${byCity[0].city}`);
    } else {
      console.log('[dry-run] 模拟完成 (无待跑站点)。');
    }
  } else if (remainingTotal > 0) {
    console.log(`\n今日配额内完成, 仍有 ${remainingTotal} 站未覆盖 (被 --cities/--only 过滤或未命中)。`);
    if (byCity[0]) console.log(`续跑: npm run geocode:sites:daily -- --cities ${byCity[0].city}`);
  } else {
    console.log('\n今日 geocode 全部完成, 无剩余站点。');
  }
} else {
  console.log(`\ngeocode 运行异常 (exit ${code}) — 见上方 apply 输出。`);
}
process.exit(code);
