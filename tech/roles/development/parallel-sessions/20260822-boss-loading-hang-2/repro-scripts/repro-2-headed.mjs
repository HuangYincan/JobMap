// REPRO-2 — 有头模式复现(最接近用户真实浏览器)+ __dmLog 补丁探查
// headless: false;全新 profile 首访 90s → reload 30s;每 500ms 记录 DOM 细节
import { chromium } from '/Users/acccan/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BATCH = '/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2';
const ART = path.join(BATCH, 'repro-artifacts');
fs.mkdirSync(ART, { recursive: true });

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function instrument(page, ev) {
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('React DevTools')) ev.console.push({ ts: Date.now(), type: m.type(), text: t.slice(0, 140) });
  });
  page.on('pageerror', (e) => ev.pageerror.push({ ts: Date.now(), text: String(e.message).slice(0, 140) }));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (u.includes('amap.com') || u.includes('localhost')) ev.requestfailed.push({ ts: Date.now(), url: u.slice(0, 120), err: String(r.failure()?.errorText ?? '').slice(0, 80) });
  });
  await page.addInitScript(() => {
    window.__dmLog = [];
    window.__dmPatchState = null;
    const timer = setInterval(() => {
      try {
        const AMap = window.AMap;
        if (!AMap || !AMap.Map) return;
        clearInterval(timer);
        const MapProto = AMap.Map.prototype;
        window.__dmPatchState = { ext: Object.isExtensible(MapProto), protoCtor: String(MapProto?.constructor?.name) };
        if (MapProto.__dmPatched) return;
        Object.defineProperty(MapProto, '__dmPatched', { value: true, configurable: true });
        const origDestroy = MapProto.destroy;
        MapProto.destroy = function (...args) { window.__dmLog.push({ ev: 'destroy', t: Date.now() }); return origDestroy.apply(this, args); };
        const origCreate = AMap.Map;
        const Tracked = function (...args) { window.__dmLog.push({ ev: 'create', t: Date.now() }); return new origCreate(...args); };
        Tracked.prototype = origCreate.prototype;
        Tracked.prototype.constructor = origCreate;
        Object.getOwnPropertyNames(origCreate).forEach((k) => { if (k !== 'length' && k !== 'name' && k !== 'prototype') { try { Tracked[k] = origCreate[k]; } catch {} } });
        try { AMap.Map = Tracked; window.__dmPatchState.assigned = AMap.Map === Tracked; }
        catch (e) { window.__dmPatchState.assignErr = String(e.message); }
        window.__dmPatchState.installedAt = Date.now();
      } catch (e) {
        window.__dmPatchState = { err: String(e.message), at: Date.now() };
        clearInterval(timer);
      }
    }, 20);
  });
}

async function snapshot(page) {
  try {
    return await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const canvases = [...document.querySelectorAll('#map-canvas canvas')];
      const overlays = [...document.querySelectorAll('#map-canvas > div')];
      return {
        bodyHead: body.slice(0, 60).replace(/\n/g, '|'),
        hasLoadingOverlay: body.includes('Loading map...'),
        hasLoadFailed: body.includes('地图加载失败'),
        canvasCount: canvases.length,
        canvasSize: canvases.map((c) => `${c.width}x${c.height}`),
        mapCanvasChildren: document.querySelector('#map-canvas')?.children.length ?? -1,
        amap: !!window.AMap,
        liveMap: !!window.__liveMap,
        patchState: window.__dmPatchState,
        dmLogLen: (window.__dmLog || []).length,
      };
    });
  } catch (e) {
    return { evalErr: String(e.message).slice(0, 80) };
  }
}

async function runVisit(page, tag, maxMs, runNo) {
  const t0 = Date.now();
  let prev = null;
  const states = [];
  while (Date.now() - t0 < maxMs) {
    const s = await snapshot(page);
    const el = Date.now() - t0;
    states.push({ t: Math.round(el), ...s });
    const key = `${s.canvasCount > 0 ? 'OK' : s.hasLoadFailed ? 'ERR' : s.hasLoadingOverlay ? 'LOADING' : 'BLANK'}`;
    if (key !== prev) {
      log(`${tag} [${(el / 1000).toFixed(1)}s] ${key} ${JSON.stringify(s)}`);
      const f = path.join(ART, `page-${runNo}-${key}-${el}ms.png`);
      await page.screenshot({ path: f }).catch(() => {});
      prev = key;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const fin = await snapshot(page);
  const f = path.join(ART, `page-${runNo}-final-${Math.round((Date.now() - t0) / 1000)}s.png`);
  await page.screenshot({ path: f }).catch(() => {});
  log(`${tag} 终态: ${JSON.stringify(fin)}`);
  const last = states[states.length - 1];
  log(`${tag} 最后状态: ${JSON.stringify(last)}`);
  const errs = [];
  for (const e of ev[tag]?.pageerror ?? []) errs.push(e.text);
  return { fin, states, errs };
}

const ev = { H1: { pageerror: [], requestfailed: [], console: [] }, H2: { pageerror: [], requestfailed: [], console: [] } };

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = `/tmp/dm-repro-headed-${Date.now()}`;
log(`profile: ${profile}`);
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: false,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1280,900'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
log(`browser: ${ctx.browser().version()}`);
await instrument(page, ev.H1);
const t0 = Date.now();
log('H1 goto http://localhost:3000');
await page.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch((e) => log(`H1 goto err: ${String(e.message).slice(0, 100)}`));
await runVisit(page, 'H1', 90000, 4);
log('H2 reload');
await page.reload({ waitUntil: 'commit', timeout: 60000 }).catch((e) => log(`H2 reload err: ${String(e.message).slice(0, 100)}`));
await runVisit(page, 'H2', 30000, 5);
await ctx.close();
log(`pageerror H1: ${JSON.stringify(ev.H1.pageerror.map((e) => e.text))}`);
log(`pageerror H2: ${JSON.stringify(ev.H2.pageerror.map((e) => e.text))}`);
log(`requestfailed H1: ${JSON.stringify(ev.H1.requestfailed.map((e) => `${e.url} → ${e.err}`))}`);
log(`requestfailed H2: ${JSON.stringify(ev.H2.requestfailed.map((e) => `${e.url} → ${e.err}`))}`);
log('done');
process.exit(0);
