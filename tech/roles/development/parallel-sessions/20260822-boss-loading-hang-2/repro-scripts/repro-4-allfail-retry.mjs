// REPRO-4 — 全引擎 CDN 失败:mountError → ERROR_UI 必须 ≤25s(ws-2 watchdog)
// + 放行后点重试 → 应恢复 OK。若全失败仍不出错误态 = 修复链有洞(新根因)。
import { chromium } from '/Users/acccan/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BATCH = '/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2';
const ART = path.join(BATCH, 'repro-artifacts');
fs.mkdirSync(ART, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const p = `/tmp/dm-repro-allfail-${Date.now()}`;
const ctx = await chromium.launchPersistentContext(p, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-breakpad'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => log(`[pageerror] ✗ ${String(e.message).slice(0, 130)}`));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('map-engine') || t.includes('AMap') || t.includes('失败')) log(`[console.${m.type()}] ${t.slice(0, 140)}`);
});

let blocked = true;
await page.route('**/*amap.com/**', (r) => (blocked ? r.abort() : r.continue()));
await page.route('**/*map.qq.com/**', (r) => (blocked ? r.abort() : r.continue()));
await page.route('**/*map.baidu.com/**', (r) => (blocked ? r.abort() : r.continue()));
await page.route('**/*api.map.baidu.com/**', (r) => (blocked ? r.abort() : r.continue()));

const snap = async (tag) => {
  const s = await page.evaluate(() => {
    const body = document.body ? document.body.innerText : '';
    return {
      head: body.slice(0, 120).replace(/\n/g, '|'),
      loading: body.includes('Loading map...'),
      failed: body.includes('地图加载失败'),
      btn: !!document.querySelector('#map-canvas button'),
      btnText: document.querySelector('#map-canvas button')?.textContent?.trim() ?? '',
      canvas: document.querySelectorAll('#map-canvas canvas').length,
      amap: !!window.AMap,
    };
  }).catch((e) => ({ err: String(e.message).slice(0, 60) }));
  log(`${tag} ${JSON.stringify(s)}`);
  return s;
};

const t0 = Date.now();
await page.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch((e) => log(`goto err ${String(e.message).slice(0, 60)}`));
let lastKey = '';
while (Date.now() - t0 < 40000) {
  const s = await snap(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  if (!s.err) {
    const key = s.canvas > 0 ? 'OK' : s.failed ? (s.btn ? 'ERROR_UI' : 'ERR_NOBTN') : s.loading ? 'LOADING' : 'BLANK';
    if (key !== lastKey) {
      const f = path.join(ART, `page-9-${key}-${Math.round((Date.now() - t0) / 1000)}s.png`);
      await page.screenshot({ path: f }).catch(() => {});
      log(`STATE=${key} 截图 ${f}`);
      lastKey = key;
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
}
// 放行 + 点重试
log('放行全部 CDN,点击重试');
blocked = false;
const clicked = await page.locator('#map-canvas button').first().click({ timeout: 5000 }).then(() => true).catch(() => false);
log(`点击重试结果: ${clicked}`);
let seen = '';
while (Date.now() - t0 < 85000) {
  const s = await snap(`[RETRY ${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  if (!s.err) {
    const key = s.canvas > 0 ? 'OK' : s.failed ? 'ERROR' : s.loading ? 'LOADING' : 'BLANK';
    if (key !== seen) { log(`RETRY STATE=${key}`); seen = key; }
    if (key === 'OK') break;
  }
  await new Promise((r) => setTimeout(r, 1500));
}
const f = path.join(ART, 'page-9-retry-final.png');
await page.screenshot({ path: f }).catch(() => {});
await ctx.close();
log('done');
process.exit(0);
