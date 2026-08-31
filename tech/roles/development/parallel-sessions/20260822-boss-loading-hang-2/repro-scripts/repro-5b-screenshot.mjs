// REPRO-5b — 补拍 GATE_A 卡死截图(在页面稳定后截,避免导航期截图失败)
import { chromium } from '/Users/acccan/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BATCH = '/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2';
const ART = path.join(BATCH, 'repro-artifacts');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const p = `/tmp/dm-repro-chunkstall2-${Date.now()}`;
const ctx = await chromium.launchPersistentContext(p, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-breakpad'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.route('**/_next/static/chunks/**', () => { /* stall */ });
await page.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 12000));
const s = await page.evaluate(() => document.body.innerText.slice(0, 60)).catch((e) => `evalErr ${e.message.slice(0, 40)}`);
log(`12s 后页面文本: ${JSON.stringify(s)}`);
const f = path.join(ART, 'page-10-GATE_A-STUCK.png');
await page.screenshot({ path: f, timeout: 20000 })
  .then(() => log(`截图成功: ${f}`))
  .catch((e) => log(`截图失败: ${String(e.message).slice(0, 80)}`));
await ctx.close();
log('done');
process.exit(0);
