// REPRO-5 — GATE_A 层挂死模拟:map-shell chunk 请求永不响应
// 预期:home-map fallback "Loading map…" 永停留(无 ERROR_UI——动态层无错误态;
// 挂载链 watchdog 不覆盖此层)→ 证明「卡死在加载界面」唯一仍可能的所在层。
// 随后放行 → 动态 import 恢复 → 应自行渲染 OK(若用户首访挂死,需请求级错误才触发刷新恢复)。
import { chromium } from '/Users/acccan/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BATCH = '/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2';
const ART = path.join(BATCH, 'repro-artifacts');
fs.mkdirSync(ART, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const p = `/tmp/dm-repro-chunkstall-${Date.now()}`;
const ctx = await chromium.launchPersistentContext(p, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-breakpad'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => log(`[pageerror] ✗ ${String(e.message).slice(0, 130)}`));
page.on('request', (r) => { if (r.url().includes('_next/static/chunks')) log(`[chunk req] ${r.url().slice(0, 110)}`); });

let stall = true;
await page.route('**/_next/static/chunks/**', (route) => {
  if (stall) { log(`[chunk stall] ${route.request().url().slice(0, 110)}`); return; /* 永不响应 */ }
  return route.continue();
});

const snap = async () => {
  const s = await page.evaluate(() => {
    const body = document.body ? document.body.innerText : '';
    return {
      head: body.slice(0, 60).replace(/\n/g, '|'),
      gateA: body.includes('Loading map…'),
      loading: body.includes('Loading map...'),
      failed: body.includes('地图加载失败'),
      canvas: document.querySelectorAll('#map-canvas canvas').length,
    };
  }).catch((e) => ({ err: String(e.message).slice(0, 40) }));
  return s;
};

const t0 = Date.now();
await page.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch((e) => log(`goto err ${String(e.message).slice(0, 60)}`));
let lastKey = '';
while (Date.now() - t0 < 30000) {
  const s = await snap();
  const key = s.err ? 'ERR' : s.canvas > 0 ? 'OK' : s.failed ? 'ERROR_UI' : s.gateA ? 'GATE_A' : s.loading ? 'LOADING' : 'BLANK';
  if (key !== lastKey) {
    log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] STATE=${key} ${JSON.stringify(s)}`);
    if (key === 'GATE_A') {
      const f = path.join(ART, 'page-10-GATE_A-STUCK.png');
      await page.screenshot({ path: f }).catch(() => {});
      log(`截图: ${f}`);
    }
    lastKey = key;
  }
  if (key === 'OK') break;
  await new Promise((r) => setTimeout(r, 2000));
}
log('放行 chunk 请求');
stall = false;
while (Date.now() - t0 < 60000) {
  const s = await snap();
  const key = s.err ? 'ERR' : s.canvas > 0 ? 'OK' : s.failed ? 'ERROR_UI' : s.gateA ? 'GATE_A' : s.loading ? 'LOADING' : 'BLANK';
  log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] STATE=${key} ${JSON.stringify(s)}`);
  if (key === 'OK') break;
  await new Promise((r) => setTimeout(r, 2000));
}
const f = path.join(ART, 'page-10-final.png');
await page.screenshot({ path: f }).catch(() => {});
await ctx.close();
log('done');
process.exit(0);
