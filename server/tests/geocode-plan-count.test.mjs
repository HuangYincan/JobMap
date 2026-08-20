import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { shouldShortCircuitQuota, sitesNeedingGeocode } from '../src/lib/site-geocode.ts';

// 2026-08-21 (fix/geocode-plan-count): 配额短路时 planCount 停在短路点
// ("Sites needing a point: 5" 误导, 实际缺坐标站点 1783 个: radar 1363 +
// official-career 420)。修复: 主循环前预扫统计真实全量 planTotal, 输出
// "Sites needing a point: ${planTotal} (attempted: ${planCount})", QUOTA_EXHAUSTED
// 的剩余数 = planTotal - resolutions - unresolved - skipped (真实剩余)。

const NEEDING = (slug, id) => ({
  company: { slug, name: `公司${slug}`, sites: [{ id, name: 'site', location: { address: '某地址' } }] },
  site: { id, name: 'site', location: { address: '某地址' } },
});

/**
 * 模拟 geocode-sites-apply.mjs 主循环的计数逻辑 (无网络):
 * 逐站 planCount+1; ONLY 过滤记 skipped; 配额类失败记 unresolved 并喂
 * shouldShortCircuitQuota (连续 5 个 → 停); 成功记 resolutions 冲窗口。
 * remaining 用修复后的真实全量公式 (planTotal - res - un - skip)。
 */
function simulateRun(needing, { only = null, outcomes = {} } = {}) {
  const history = [];
  let shortCircuited = false;
  let planCount = 0;
  const resolutions = [];
  const unresolved = [];
  const skipped = [];
  mainLoop: for (const n of needing) {
    planCount += 1;
    if (only && !only.includes(n.company.slug)) {
      skipped.push({ reason: 'not-in-only-list' });
      continue;
    }
    const outcome = outcomes[n.site.id] ?? 'ok';
    if (outcome === 'ok') {
      resolutions.push(n);
      history.push(null);
      continue;
    }
    unresolved.push({ reason: outcome });
    history.push(outcome);
    if (shouldShortCircuitQuota(history, 5)) {
      shortCircuited = true;
      break mainLoop;
    }
  }
  const remaining = needing.length - resolutions.length - unresolved.length - skipped.length;
  return { planTotal: needing.length, planCount, resolutions: resolutions.length, unresolved: unresolved.length, skipped: skipped.length, remaining, shortCircuited };
}

// --- sitesNeedingGeocode: 预扫纯函数 -----------------------------------------

test('sitesNeedingGeocode: 只收集缺坐标站点 (无 location / 0,0 / 非有限坐标)', () => {
  const companies = [
    {
      slug: 'a',
      name: 'A',
      sites: [
        { id: 'a1', name: '有坐标', location: { lng: 120.1, lat: 30.2 } },
        { id: 'a2', name: '无坐标' },
      ],
    },
    {
      slug: 'b',
      name: 'B',
      sites: [
        { id: 'b1', name: '零坐标', location: { lng: 0, lat: 0 } },
        { id: 'b2', name: '非有限', location: { lng: NaN, lat: 30.2 } },
        { id: 'b3', name: '有坐标', location: { lng: 121.5, lat: 31.2 } },
      ],
    },
  ];
  const out = sitesNeedingGeocode(companies);
  assert.deepEqual(out.map((n) => n.site.id).sort(), ['a2', 'b1', 'b2']);
  // 引用原对象 (主循环复用, 不拷贝)
  assert.equal(out[0].company, companies[0]);
  assert.equal(out[0].site, companies[0].sites[1]);
});

test('sitesNeedingGeocode: 跳过非法 company (无 slug), 空输入返回 []', () => {
  const companies = [
    { name: '无slug', sites: [{ id: 'x', name: 'x' }] },
    null,
    { slug: 'ok', name: 'OK', sites: [{ id: 'ok1', name: '缺坐标' }] },
  ];
  assert.deepEqual(sitesNeedingGeocode(companies).map((n) => n.site.id), ['ok1']);
  assert.deepEqual(sitesNeedingGeocode([]), []);
  assert.deepEqual(sitesNeedingGeocode([null, undefined]), []);
});

// --- 短路计数: attempted / 真实剩余推演 ---------------------------------------

test('短路场景 (bug 复现): 1783 站全配额失败 → attempted=5, 真实剩余=1778', () => {
  // radar 1363 + official-career 420 = 1783, 全配额失败
  const needing = Array.from({ length: 1783 }, (_, i) => NEEDING(`c${i}`, `s${i}`));
  const outcomes = Object.fromEntries(needing.map((n) => [n.site.id, 'quota']));
  const r = simulateRun(needing, { outcomes });
  assert.equal(r.planTotal, 1783);
  assert.equal(r.planCount, 5); // attempted 停在短路点
  assert.equal(r.shortCircuited, true);
  assert.equal(r.resolutions, 0);
  assert.equal(r.unresolved, 5);
  assert.equal(r.remaining, 1778); // 真实剩余, 不再是旧口径的 0
  // 旧口径 (planCount - res - un - skip) 会算出 0 — 修复后的公式必须与它不同
  assert.notEqual(r.remaining, r.planCount - r.resolutions - r.unresolved - r.skipped);
});

test('非配额类失败不短路: 全程跑完, attempted === planTotal, 剩余 0', () => {
  const needing = Array.from({ length: 50 }, (_, i) => NEEDING(`c${i}`, `s${i}`));
  const outcomes = Object.fromEntries(needing.map((n) => [n.site.id, 'http']));
  const r = simulateRun(needing, { outcomes });
  assert.equal(r.shortCircuited, false);
  assert.equal(r.planCount, r.planTotal);
  assert.equal(r.unresolved, 50);
  assert.equal(r.remaining, 0);
});

test('配额失败中夹成功解析: 窗口被冲掉, 不误停; 恢复后再次耗尽仍停', () => {
  // s0-s3 配额失败, s4 成功 (冲窗口), s5-s9 配额失败 → 第 10 站尝试后停
  // (4 失败 + 1 成功 + 5 失败; 成功把 null 挤进窗口, 前 9 次都不满足连续 5)
  const needing = Array.from({ length: 20 }, (_, i) => NEEDING(`c${i}`, `s${i}`));
  const outcomes = {};
  for (const n of needing) outcomes[n.site.id] = 'quota';
  outcomes.s4 = 'ok';
  const r = simulateRun(needing, { outcomes });
  assert.equal(r.shortCircuited, true);
  assert.equal(r.planCount, 10);
  assert.equal(r.resolutions, 1);
  assert.equal(r.unresolved, 9);
  assert.equal(r.remaining, 20 - 10);
});

test('--only 过滤: 过滤外站点记 skipped 单列, 真实剩余只算未尝试站', () => {
  // 10 站 (b 站 5 个在前, a 站 5 个在后), only=[a]: b 站记 skipped (5),
  // a 站全配额失败 → 第 10 次尝试后停; remaining = 10 - 0 - 5 - 5 = 0
  // (过滤范围内已全部尝试)。planTotal 保持过滤前全量 10。
  const needing = [];
  for (let i = 0; i < 5; i++) needing.push(NEEDING('b', `b${i}`));
  for (let i = 0; i < 5; i++) needing.push(NEEDING('a', `a${i}`));
  const outcomes = Object.fromEntries(needing.map((n) => [n.site.id, 'quota']));
  const r = simulateRun(needing, { only: ['a'], outcomes });
  assert.equal(r.shortCircuited, true);
  assert.equal(r.planCount, 10); // 5 个 skip + 5 个尝试都计入 attempted
  assert.equal(r.skipped, 5); // not-in-only-list
  assert.equal(r.unresolved, 5);
  assert.equal(r.remaining, 10 - 0 - 5 - 5);
  assert.equal(r.planTotal, 10); // 真实全量口径: 过滤前
  // 若过滤外站点排在短路点之后 (从未访问), 剩余 = 未访问站数, skipped 为 0 —
  // 两种顺序下 planTotal 都不变, remaining 恒等于未尝试站数
  const r2 = simulateRun(needing.reverse(), { only: ['a'], outcomes });
  assert.equal(r2.planTotal, 10);
  assert.equal(r2.remaining, 10 - r2.planCount);
});

test('正常跑完: attempted === planTotal, remaining === 0, 不打印 QUOTA_EXHAUSTED', () => {
  const needing = Array.from({ length: 100 }, (_, i) => NEEDING(`c${i}`, `s${i}`));
  const r = simulateRun(needing, { outcomes: {} });
  assert.equal(r.shortCircuited, false);
  assert.equal(r.planCount, 100);
  assert.equal(r.resolutions, 100);
  assert.equal(r.remaining, 0);
});

// --- 脚本接线 (contract) -------------------------------------------------------

test('geocode-sites-apply.mjs 接线: 预扫 planTotal + 全量输出 + 真实剩余公式', () => {
  const script = readFileSync(
    new URL('../scripts/geocode-sites-apply.mjs', import.meta.url),
    'utf8',
  );
  // 预扫在主循环前, 统计真实全量
  assert.match(script, /sitesNeedingGeocode\(companies\)/);
  assert.match(script, /const planTotal = needing\.length/);
  assert.ok(script.indexOf('const planTotal = needing.length') < script.indexOf('let planCount = 0;'));
  // 输出: 真实全量 + attempted
  assert.match(script, /Sites needing a point: \$\{planTotal\} \(attempted: \$\{planCount\}\)/);
  // 短路剩余: 真实全量公式 (不再用 planCount)
  assert.match(script, /const remaining = planTotal - resolutions\.length - unresolved\.length - skipped\.length/);
  // 主循环复用预扫结果 (不重复 JSON.parse)
  assert.match(script, /mainLoop: for \(const \{ file, company, site \} of needing\)/);
});
