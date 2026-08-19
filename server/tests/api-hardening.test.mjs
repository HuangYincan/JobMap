// API 加固契约测试（quality-scan #7 / #10 / #11 / #12）。
// route.ts 使用 next/server + `@/` 别名（tsconfig paths 仅 bundler 解析），
// node:test 无法直接 import，沿用仓库既有契约测试模式：readFileSync + 正则断言
// 守卫路径与常量（行为逻辑：enqueue 幂等 / matchJobAlerts / 管线均有独立 lib 测试）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

test('#10 search: q 超长 → 400（不做静默截断）', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /const MAX_Q_LENGTH = 100/);
  assert.match(route, /body\.q\.length > MAX_Q_LENGTH/);
  assert.match(route, /code: 'Q_TOO_LONG'/);
  assert.match(route, /status: 400/);
  // 校验必须在缓存 key 构造之前 → 超长 q 永远不会进缓存
  const keyIdx = route.indexOf('const cacheKey =');
  const guardIdx = route.indexOf("code: 'Q_TOO_LONG'");
  assert.ok(guardIdx !== -1 && keyIdx !== -1 && guardIdx < keyIdx, 'q 校验先于缓存 key');
});

test('#10 search: body 大小超限（64KB）→ 400', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /const MAX_BODY_CHARS = 64 \* 1024/);
  assert.match(route, /raw\.length > MAX_BODY_CHARS/);
  assert.match(route, /code: 'BODY_TOO_LARGE'/);
  assert.match(route, /status: 400/);
});

test('#10 search: filters 序列化超限 → 400，且限长结果复用为缓存 key 组件', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /const MAX_FILTERS_JSON_LENGTH = 4000/);
  assert.match(route, /code: 'FILTERS_TOO_LARGE'/);
  assert.match(route, /status: 400/);
  // filters 非对象（数组/标量）也拒绝
  assert.match(route, /Array\.isArray\(body\.filters\)/);
  // 缓存 key 卫生：只序列化一次，复用限长后的 filtersJson
  assert.match(route, /const filtersJson = JSON\.stringify\(body\.filters \?\? \{\}\)/);
  const keyBlock = route.slice(route.indexOf('publicCacheKey(['), route.indexOf(']);'));
  assert.match(keyBlock, /filtersJson/);
  assert.doesNotMatch(keyBlock, /JSON\.stringify/);
});

test('#7 search: pageSize 超限（>100 / <1 / 非有限数）→ 400', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /const MAX_PAGE_SIZE = 100/);
  assert.match(route, /body\.pageSize > MAX_PAGE_SIZE/);
  assert.match(route, /code: 'INVALID_PAGE_SIZE'/);
  assert.match(route, /status: 400/);
  // 正常请求仍走原管线与缓存（契约不回退）
  assert.match(route, /loadServerCatalog/);
  assert.match(route, /searchPublicCatalog/);
  assert.match(route, /spatialClipFromSearch/);
  assert.match(route, /writePublicCache/);
  assert.match(route, /invalid JSON body/);
});

test('#10 suggest: q 超长 → 400（在缓存 key 之前拦截）', () => {
  const route = src('app/api/suggest/route.ts');
  assert.match(route, /const MAX_Q_LENGTH = 100/);
  assert.match(route, /q\.length > MAX_Q_LENGTH/);
  assert.match(route, /code: 'Q_TOO_LONG'/);
  assert.match(route, /status: 400/);
  const keyIdx = route.indexOf('const cacheKey =');
  const guardIdx = route.indexOf("code: 'Q_TOO_LONG'");
  assert.ok(guardIdx !== -1 && keyIdx !== -1 && guardIdx < keyIdx, 'suggest q 校验先于缓存 key');
  // 原契约保持：空 q 热门搜索 / 本地优先 / 空结果不缓存
  assert.match(route, /trendingForMode/);
  assert.match(route, /mode === 'domain'/);
  assert.match(route, /slice\(0, 10\)/);
  assert.match(route, /if \(suggestions\.length > 0\) \{\s*writePublicCache/);
});

test('#11 notifications: 同用户 60s 冷却 → 429 + Retry-After', () => {
  const route = src('app/api/me/notifications/route.ts');
  assert.match(route, /const NOTIFY_COOLDOWN_MS = 60_000/);
  assert.match(route, /const notifyCooldown = new Map<string, number>\(\)/);
  assert.match(route, /notifyCooldown\.get\(user\.id\)/);
  assert.match(route, /now - last < NOTIFY_COOLDOWN_MS/);
  assert.match(route, /code: "RATE_LIMITED"/);
  assert.match(route, /status: 429/);
  assert.match(route, /"Retry-After"/);
  // 冷却通过后才执行扫描 + 入队
  const scanIdx = route.indexOf('loadServerCatalog("work")');
  const setIdx = route.indexOf('notifyCooldown.set(user.id, now)');
  assert.ok(setIdx !== -1 && scanIdx !== -1 && setIdx < scanIdx, '冷却记录先于全量扫描');
  // 原有行为保持
  assert.match(route, /matchJobAlerts/);
  assert.match(route, /enqueueNotification/);
  assert.match(route, /status: "queued"/);
});

test('#12 saved: name/poiId 长度上限 + lng/lat 范围校验 → 400', () => {
  const route = src('app/api/me/saved/route.ts');
  assert.match(route, /const MAX_NAME_LENGTH = 100/);
  assert.match(route, /const MAX_POI_ID_LENGTH = 200/);
  assert.match(route, /const MIN_LNG = -180/);
  assert.match(route, /const MAX_LNG = 180/);
  assert.match(route, /const MIN_LAT = -90/);
  assert.match(route, /const MAX_LAT = 90/);
  assert.match(route, /code: "NAME_TOO_LONG"/);
  assert.match(route, /code: "POI_ID_TOO_LONG"/);
  assert.match(route, /code: "INVALID_LNG"/);
  assert.match(route, /code: "INVALID_LAT"/);
  assert.match(route, /status: 400/);
  // 坐标校验含非有限数（JSON 1e999 → Infinity）防御
  assert.match(route, /Number\.isFinite\(body\.lng\)/);
  assert.match(route, /Number\.isFinite\(body\.lat\)/);
  // 校验在落库之前
  const saveIdx = route.indexOf('savePlace(user.id,');
  const lngIdx = route.indexOf('code: "INVALID_LNG"');
  assert.ok(lngIdx !== -1 && saveIdx !== -1 && lngIdx < saveIdx, 'lng 校验先于落库');
  // 原有行为保持
  assert.match(route, /poiId and name required/);
  assert.match(route, /isPersistableSavedSnapshot/);
  assert.match(route, /canonicalMode/);
});
