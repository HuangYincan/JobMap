// REPRO-3 — 故障注入:AMap CDN 停滞/失败时错误态是否真的出现(上一轮修复链实证)
// R1: webapi.amap.com 脚本请求永不响应(stall)→ 应 8s(loadAMap 超时)或 25s(watchdog)出 ERROR_UI
// R2: route.abort 全部 amap.com → 应立即 onerror → 快速 ERROR_UI;随后放行 + 点重试 → 应恢复 OK
import { chromium } from '/Users/acccan/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BATCH = '/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2';
const ART = path.join(BATCH, 'repro-artifacts');
fs.mkdirSync(ART, { recursive: true });

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function snapshot(page, tag) {
  try {
    const s = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      return {
        bodyHead: body.slice(0, 70).replace(/\n/g, '|'),
        loading: body.includes('Loading map...'),
        failed: body.includes('地图加载失败'),
        retryBtn: !!document.querySelector('#map-canvas button'),
        canvas: document.querySelectorAll('#map-canvas canvas').length,
        amap: !!window.AMap,
      };
    });
    log(`${tag} ${JSON.stringify(s)}`);
    return s;
  } catch (e) {
    log(`${tag} evalErr: ${String(e.message).slice(0, 80)}`);
    return null;
  }
}

async function rifle(page, tag, ms, runNo) {
  const t0 = Date.now();
  let prev = '';
  while (Date.now() - t0 < ms) {
    const s = await snapshot(page, tag);
    if (s) {
      const key = s.canvas > 0 ? 'OK' : s.failed ? (s.retryBtn ? 'ERROR_UI' : 'ERROR_NOBTN') : s.loading ? 'LOADING' : 'BLANK';
      if (key !== prev) {
        const f = path.join(ART, `page-${runNo}-${key}-${Math.round((Date.now() - t0) / 1000)}s.png`);
        await page.screenshot({ path: f }).catch(() => {});
        log(`${tag} [${((Date.now() - t0) / 1000).toFixed(1)}s] STATE=${key}`);
        prev = key;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const launch = (profile) => chromium.launchPersistentContext(profile, {
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-breakpad'],
});

// ---------- R1: stall AMap CDN ----------
const p1 = `/tmp/dm-repro-stall-${Date.now()}`;
const ctx1 = await launch(p1);
const page1 = ctx1.pages()[0] ?? (await ctx1.newPage());
page1.on('pageerror', (e) => log(`[R1 pageerror] ${String(e.message).slice(0, 120)}`));
await page1.route('**/*amap.com/**', (route) => { log(`[R1] AMap 请求被拦截(永不响应): ${route.request().url().slice(0, 70)}`); /* stall: 不 fulfill/不 abort */ });
log('R1 goto (AMap CDN stall)');
await page1.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch((e) => log(`R1 goto err ${String(e.message).slice(0, 80)}`));
await rifle(page1, 'R1', 35000, 6);
log('R1 终态:');
await snapshot(page1, 'R1-final');
await ctx1.close();

// ---------- R2: abort AMap CDN → 放行 → 点重试 ----------
const p2 = `/tmp/dm-repro-abort-${Date.now()}`;
const ctx2 = await launch(p2);
const page2 = ctx2.pages()[0] ?? (await ctx2.newPage());
page2.on('pageerror', (e) => log(`[R2 pageerror] ${String(e.message).slice(0, 120)}`));
let aborting = true;
await page2.route('**/*amap.com/**', (route) => {
  if (aborting) { log(`[R2] AMap 请求 abort: ${route.request().url().slice(0, 70)}`); return route.abort(); }
  return route.continue();
});
log('R2 goto (AMap CDN abort)');
await page2.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch((e) => log(`R2 goto err ${String(e.message).slice(0, 80)}`));
await rifle(page2, 'R2', 15000, 7);
log('R2 放行 CDN + 点击重试按钮');
aborting = false;
const btn = await page2.locator('#map-canvas button').first().click({ timeout: 3000 }).then(() => true).catch(() => false);
log(`R2 点击重试: ${btn}`);
await rifle(page2, 'R2-retry', 30000, 8);
await ctx2.close();
log('done');
process.exit(0);
