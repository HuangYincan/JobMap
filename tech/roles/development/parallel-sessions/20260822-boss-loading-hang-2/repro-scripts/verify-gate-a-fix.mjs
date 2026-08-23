// VERIFY-GATE-A-FIX — 复刻 repro R5 拦截法,证明 GATE_A 守卫生效:
// 1) 拦截 map-shell 相关 chunk(永挂,不 continue)→ "Loading map…" 在 15s 后必须切「地图加载失败」;
// 2) 点击「重试」→ window.location.reload() → chunk 放行 → 正常进 OK。
// 用法:node repro-scripts/verify-gate-a-fix.mjs(dev server 已在 :3000 运行,worktree 代码)
import { chromium } from '/Users/acccan/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BATCH = '/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2';
const ART = path.join(BATCH, 'repro-artifacts');
fs.mkdirSync(ART, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const p = `/tmp/dm-verify-gatea-${Date.now()}`;
const ctx = await chromium.launchPersistentContext(p, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-breakpad'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => log(`[pageerror] ✗ ${String(e.message).slice(0, 130)}`));

/** 拦截模式:
 *  'shell' — 只拦 URL 含 map-shell 的 chunk(精确复刻 R5 目标层)
 *  'all'   — 拦全部 _next/static/chunks/**(R5 原始模式,兜底:webpack 命名不含 shell 时)
 *  'off'   — 全部放行
 */
let stallMode = 'shell';
const pendingRoutes = []; // 已拦截且未放行的 route,供后续 release(单独清空)
const stalledUrls = [];
let t0Ref = Date.now();

await page.route('**/_next/static/chunks/**', (route) => {
  const url = route.request().url();
  const hitShell = /map-shell/i.test(url);
  if (stallMode === 'off') return route.continue();
  if (stallMode === 'all' || hitShell) {
    stalledUrls.push(url);
    pendingRoutes.push(route);
    log(`[stall ${hitShell ? 'shell' : 'all'}] ${url.slice(0, 120)}`);
    return; // 永不响应
  }
  return route.continue();
});

function releasePending() {
  const routes = pendingRoutes.splice(0);
  log(`releasePending: ${routes.length} 条挂起请求放行`);
  for (const r of routes) r.continue().catch(() => {});
}

const snap = async () => {
  const s = await page.evaluate(() => {
    const body = document.body ? document.body.innerText : '';
    return {
      head: body.slice(0, 60).replace(/\n/g, '|'),
      gateA: body.includes('Loading map…'),
      loading: body.includes('Loading map...'),
      failed: body.includes('地图加载失败'),
      retry: [...document.querySelectorAll('button')].some((b) => /重试|Retry/.test(b.textContent || '')),
      canvas: document.querySelectorAll('#map-canvas canvas').length,
    };
  }).catch((e) => ({ err: String(e.message).slice(0, 40) }));
  return s;
};
const keyOf = (s) => s.err ? 'ERR' : s.canvas > 0 ? 'OK' : s.failed ? 'FAILED' : s.gateA || s.loading ? 'GATE_A' : 'BLANK';

const wall = () => `[${((Date.now() - t0Ref) / 1000).toFixed(1)}s]`;

/** 观察循环:监视页面状态,直到出现 target 或超时;状态变化即打点。 */
async function watchUntil(target, maxMs) {
  const deadline = Date.now() + maxMs;
  let last = '';
  while (Date.now() < deadline) {
    const s = await snap();
    const key = keyOf(s);
    if (key !== last) {
      log(`${wall()} STATE=${key} retry=${s.retry} ${JSON.stringify({ head: s.head, canvas: s.canvas })}`);
      last = key;
    }
    if (key === target) return { key, s };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { key: last, s: await snap(), timeout: true };
}

// ---------- Phase 1:首访,挂死 map-shell chunk ----------
log('=== Phase 1:首访 + map-shell chunk 永挂 ===');
await page.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch((e) => log(`goto err ${String(e.message).slice(0, 60)}`));

// 探测:长时间未达 FAILED 且未拦到 shell chunk → 换 'all' 模式再走一轮(R5 原始拦截法)
const sawShell = () => stalledUrls.some((u) => /map-shell/i.test(u));
let phase1 = await watchUntil('FAILED', 45000);
if (phase1.key !== 'FAILED' && !sawShell()) {
  log('未拦到 shell 命名 chunk,切换 all 模式重载(R5 原始拦截法)');
  stallMode = 'all';
  await page.reload({ waitUntil: 'commit', timeout: 120000 }).catch(() => {});
  phase1 = await watchUntil('FAILED', 45000);
} else if (phase1.key !== 'FAILED' && sawShell()) {
  phase1 = await watchUntil('FAILED', 30000);
}
if (phase1.key !== 'FAILED') { log('phase1 未达 FAILED,继续流程'); }
const failShot1 = path.join(ART, 'gate-a-fix-error.png');
await page.screenshot({ path: failShot1 }).catch((e) => log(`截图失败 ${e.message}`));
log(`截图(失败态): ${failShot1}`);

// ---------- Phase 2:点击「重试」(window.location.reload,chunk 已放行)→ OK ----------
log('=== Phase 2:点击「重试」→ reload → 期待 OK ===');
stallMode = 'off'; // 先放行,保证 reload 后全部 chunk 可加载
releasePending(); // 顺手放行旧挂起请求(独立验证 import 是否自愈)
const stateNow = await snap();
if (stateNow.failed) {
  const btn = page.locator('button', { hasText: /重试|Retry/ }).first();
  await btn.click({ timeout: 5000 }).catch((e) => log(`点击重试失败 ${e.message}`));
  log('已点击「重试」按钮(触发 window.location.reload)');
} else {
  log('页面已不在失败态(挂起请求放行后自愈),跳过点击;直接 watch OK');
}
const okRes = await watchUntil('OK', 45000);
const okShot = path.join(ART, 'gate-a-fix-ok.png');
await page.screenshot({ path: okShot }).catch((e) => log(`截图失败 ${e.message}`));
log(`截图(恢复态): ${okShot}`);

// ---------- 汇总 ----------
log('=== 汇总 ===');
log(`stalled chunk 计数: ${stalledUrls.length}`);
log(`stalled chunk 样例: ${stalledUrls.slice(0, 5).map((u) => u.split('/').slice(-2).join('/')).join(' ; ')}`);
log(`Phase1 结果: ${phase1.key === 'FAILED' ? `FAILED ✓(${phase1.s.head.replace(/\|/g, ' / ')})` : `FAILED ✗(${phase1.key})`}`);
log(`Phase2 结果: ${okRes.key === 'OK' ? 'OK ✓' : `未达 OK(${okRes.key}) ✗`}`);
await ctx.close();
log('done');
process.exit(0);
