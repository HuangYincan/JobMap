// REPRO — 首访卡死在加载界面·实证复现(2026-08-22 第二轮)
// 三阶段:V1 全新 profile 首访(90s)→ V2 同 context reload(30s)→ V3 第二个全新 profile 首访(90s)
// 采集:console / pageerror / requestfailed / AMap CDN response / __dmLog create-destroy 计数
// 状态机:OK(#map-canvas 有 canvas)| ERROR_UI(地图加载失败+重试)| STUCK(map-shell Loading map... 90s 不消失)
//        | GATE_A(只剩 home-map fallback "Loading map…",无 #map-canvas)| BLANK(白屏)
import { chromium } from '/Users/acccan/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BATCH = '/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2';
const ART = path.join(BATCH, 'repro-artifacts');
fs.mkdirSync(ART, { recursive: true });

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function freshEvents(tag) {
  return { tag, console: [], pageerror: [], requestfailed: [], crash: [], cdnResponse: [], cdnRequest: [], timeline: [] };
}

async function instrument(page, ev) {
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('React DevTools')) ev.console.push({ ts: Date.now(), type: m.type(), text: t.slice(0, 140) });
  });
  page.on('pageerror', (e) => ev.pageerror.push({ ts: Date.now(), text: String(e.message).slice(0, 140) }));
  page.on('crash', () => ev.crash.push({ ts: Date.now() }));
  page.on('requestfailed', (r) =>
    ev.requestfailed.push({ ts: Date.now(), url: r.url().slice(0, 120), err: String(r.failure()?.errorText ?? '').slice(0, 80) }),
  );
  page.on('request', (r) => {
    const u = r.url();
    if (/amap\.com|map\.qq\.com|api\.map\.baidu/i.test(u)) ev.cdnRequest.push({ ts: Date.now(), url: u.slice(0, 120) });
  });
  page.on('response', (r) => {
    const u = r.url();
    if (/amap\.com|map\.qq\.com|api\.map\.baidu/i.test(u)) ev.cdnResponse.push({ ts: Date.now(), status: r.status(), url: u.slice(0, 120) });
  });
  await page.addInitScript(() => {
    window.__dmLog = [];
    const timer = setInterval(() => {
      const AMap = window.AMap;
      if (!AMap || !AMap.Map) return;
      clearInterval(timer);
      const MapProto = AMap.Map.prototype;
      if (MapProto.__dmPatched) return;
      Object.defineProperty(MapProto, '__dmPatched', { value: true });
      const origDestroy = MapProto.destroy;
      MapProto.destroy = function (...args) { window.__dmLog.push({ ev: 'destroy', t: Date.now() }); return origDestroy.apply(this, args); };
      const origCreate = AMap.Map;
      const Tracked = function (...args) { window.__dmLog.push({ ev: 'create', t: Date.now() }); return new origCreate(...args); };
      Tracked.prototype = origCreate.prototype;
      Tracked.prototype.constructor = origCreate;
      Object.getOwnPropertyNames(origCreate).forEach((k) => {
        if (k !== 'length' && k !== 'name' && k !== 'prototype') { try { Tracked[k] = origCreate[k]; } catch {} }
      });
      AMap.Map = Tracked;
    }, 100);
  });
}

async function classify(page) {
  try {
    const s = await page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const canvas = !!document.querySelector('#map-canvas canvas');
      const hasShell = !!document.querySelector('#map-canvas');
      const failed = body.includes('地图加载失败');
      const retryBtn = !!document.querySelector('#map-canvas button');
      return {
        bodyLen: body.length,
        bodyHead: body.slice(0, 80).replace(/\n/g, '|'),
        canvas, hasShell, failed, retryBtn,
        loadingShell: body.includes('Loading map...'),
        loadingGateA: body.includes('Loading map…'),
        amap: !!window.AMap, liveMap: !!window.__liveMap,
      };
    });
    let state;
    if (s.canvas) state = 'OK';
    else if (s.failed && s.retryBtn) state = 'ERROR_UI';
    else if (s.failed) state = 'ERROR_PARTIAL';
    else if (s.hasShell && s.loadingShell) state = 'STUCK_LOADING';
    else if (s.hasShell) state = 'SHELL_NO_LOADING';
    else if (s.loadingGateA) state = 'GATE_A';
    else if (s.bodyLen === 0) state = 'BLANK';
    else state = 'OTHER';
    return { state, ...s };
  } catch (e) {
    return { state: 'NAV_ERR', err: String(e.message).slice(0, 80) };
  }
}

async function poll(page, ev, maxMs, runNo, t0) {
  let prev = null;
  const tStart = Date.now();
  while (Date.now() - tStart < maxMs) {
    const s = await classify(page);
    const el = Date.now() - t0;
    ev.timeline.push({ t: el, state: s.state });
    if (s.state !== prev) {
      log(`${ev.tag} [${(el / 1000).toFixed(1)}s] STATE → ${s.state} ${JSON.stringify({ canvas: s.canvas, failed: s.failed, retryBtn: s.retryBtn, amap: s.amap, liveMap: s.liveMap, bodyHead: s.bodyHead })}`);
      const f = path.join(ART, `page-${runNo}-${s.state}-${el}ms.png`);
      await page.screenshot({ path: f }).catch(() => log(`${ev.tag} 截图失败 ${f}`));
      prev = s.state;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function finalSnapshot(page, ev, runNo, t0) {
  const el = Date.now() - t0;
  const f = path.join(ART, `page-${runNo}-final-${Math.round(el / 1000)}s.png`);
  await page.screenshot({ path: f }).catch(() => {});
  const meta = await page.evaluate(() => ({
    readyState: document.readyState,
    amap: !!window.AMap,
    liveMap: !!window.__liveMap,
    amapResources: performance.getEntriesByType('resource')
      .filter((e) => e.name.includes('amap.com'))
      .map((e) => ({ name: e.name.slice(0, 70), durMs: Math.round(e.duration), size: e.transferSize, decoded: e.decodedBodySize })),
    dmLog: window.__dmLog || [],
  })).catch((e) => ({ evalErr: String(e.message).slice(0, 80) }));
  const logArr = Array.isArray(meta.dmLog) ? meta.dmLog : [];
  const creates = logArr.filter((x) => x.ev === 'create').length;
  const destroys = logArr.filter((x) => x.ev === 'destroy').length;
  log(`${ev.tag} 终态元数据: ${JSON.stringify({ readyState: meta.readyState, amap: meta.amap, liveMap: meta.liveMap, amapResources: meta.amapResources })}`);
  log(`${ev.tag} __dmLog: create=${creates} destroy=${destroys} raw=${JSON.stringify(logArr)}`);
  const states = [...new Set(ev.timeline.map((x) => x.state))];
  const finalState = ev.timeline.length ? ev.timeline[ev.timeline.length - 1].state : 'UNKNOWN';
  log(`${ev.tag} 状态时间线(去重): ${JSON.stringify(ev.timeline.filter((x, i) => i === 0 || x.state !== ev.timeline[i - 1].state))}`);
  log(`${ev.tag} 最终状态: ${finalState} (截图 ${f})`);
  return { finalState, states, shot: f };
}

async function dumpEvents(ev, stage) {
  log(`=== ${stage} 事件摘要 ===`);
  const errs = ev.pageerror.map((e) => `${e.ts}: ${e.text}`);
  log(`${stage} pageerror(${ev.pageerror.length}): ${JSON.stringify(errs)}`);
  const fails = ev.requestfailed.map((e) => `${e.ts}: ${e.url} → ${e.err}`);
  log(`${stage} requestfailed(${ev.requestfailed.length}): ${JSON.stringify(fails)}`);
  const cdn = ev.cdnResponse.map((e) => `${e.ts}: ${e.status} ${e.url}`);
  log(`${stage} AMap/厂商 CDN response(${ev.cdnResponse.length}): ${JSON.stringify(cdn)}`);
  const reqs = ev.cdnRequest.map((e) => `${e.ts}: ${e.url}`);
  log(`${stage} AMap/厂商 CDN request(${ev.cdnRequest.length}): ${JSON.stringify(reqs)}`);
  const con = ev.console.map((e) => `${e.ts} [${e.type}] ${e.text}`);
  log(`${stage} console(${ev.console.length}):\n${con.join('\n')}`);
}

// ================= 启动 =================
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LAUNCH = { executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-breakpad'] };

log(`BATCH=${BATCH}`);
log(`ART=${ART}`);
log(`Chrome: ${CHROME}`);

// ---- Stage V1: 全新 profile 首访(90s) ----
const p1 = `/tmp/dm-repro-cold-1-${Date.now()}`;
log(`V1 profile: ${p1}`);
const ctx1 = await chromium.launchPersistentContext(p1, LAUNCH);
const page1 = ctx1.pages()[0] ?? (await ctx1.newPage());
const ev1 = freshEvents('V1');
await instrument(page1, ev1);
log(`V1 browser version: ${ctx1.browser().version()}`);
const t0 = Date.now();
log('V1 goto http://localhost:3000 (waitUntil=commit)');
await page1.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch((e) => log(`V1 goto 异常: ${String(e.message).slice(0, 120)}`));
await poll(page1, ev1, 90000, 1, t0);
const r1 = await finalSnapshot(page1, ev1, 1, t0);
await dumpEvents(ev1, 'V1');

// ---- Stage V2: 同 context reload(30s) ----
log('V2 reload (same context)');
await page1.reload({ waitUntil: 'commit', timeout: 60000 }).catch((e) => log(`V2 reload 异常: ${String(e.message).slice(0, 120)}`));
await poll(page1, ev1, 30000, 2, t0);
const r2 = await finalSnapshot(page1, ev1, 2, t0);
await dumpEvents(ev1, 'V2');
await ctx1.close();

// ---- Stage V3: 第二个全新 profile 首访(90s) ----
const p3 = `/tmp/dm-repro-cold-2-${Date.now()}`;
log(`V3 profile: ${p3}`);
const ctx3 = await chromium.launchPersistentContext(p3, LAUNCH);
const page3 = ctx3.pages()[0] ?? (await ctx3.newPage());
const ev3 = freshEvents('V3');
await instrument(page3, ev3);
const t3 = Date.now();
log('V3 goto http://localhost:3000 (waitUntil=commit)');
await page3.goto('http://localhost:3000/', { waitUntil: 'commit', timeout: 120000 }).catch((e) => log(`V3 goto 异常: ${String(e.message).slice(0, 120)}`));
await poll(page3, ev3, 90000, 3, t3);
const r3 = await finalSnapshot(page3, ev3, 3, t3);
await dumpEvents(ev3, 'V3');
await ctx3.close();

log(`SUMMARY V1=${r1.finalState} V2=${r2.finalState} V3=${r3.finalState}`);
log('done');
process.exit(0);
