// API 加固契约测试（quality-scan #7 / #10 / #11 / #12 / #18）。
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
  assert.match(route, /readJsonObjectBody<SearchBody>\(request, MAX_BODY_CHARS\)/);
  assert.match(route, /RequestBodyTooLargeError/);
  assert.match(route, /code: 'BODY_TOO_LARGE'/);
  assert.match(route, /status: 400/);
  assert.doesNotMatch(route, /await request\.text\(\)/, 'body must be stream-bounded before parsing');
});

test('#10 search: filters 序列化超限 → 400，且限长结果复用为缓存 key 组件', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /const MAX_FILTERS_JSON_LENGTH = 4000/);
  assert.match(route, /code: 'FILTERS_TOO_LARGE'/);
  assert.match(route, /status: 400/);
  // filters 非对象（数组/标量）也拒绝
  assert.match(route, /isPlainObject\(body\.filters\)/);
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

test('#19 search: page/pageSize 必须是有限正整数且与 GET 范围一致', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /const MAX_PAGE = 10_000/);
  assert.match(route, /body\.page != null/);
  assert.match(route, /body\.pageSize != null/);
  assert.match(route, /Number\.isInteger\(body\.page\)/);
  assert.match(route, /Number\.isInteger\(body\.pageSize\)/);
  assert.match(route, /body\.page > MAX_PAGE/);
  assert.match(route, /body\.pageSize > MAX_PAGE_SIZE/);
  const keyIdx = route.indexOf('const cacheKey =');
  const pageIdx = route.indexOf("code: 'INVALID_PAGE'");
  const sizeIdx = route.indexOf("code: 'INVALID_PAGE_SIZE'");
  assert.ok(pageIdx !== -1 && pageIdx < keyIdx, 'page 校验先于缓存 key');
  assert.ok(sizeIdx !== -1 && sizeIdx < keyIdx, 'pageSize 校验先于缓存 key');
});

test('#19 domain-local: 缺失/非法/杭州范围外 bounds → 400，不触发 store', () => {
  const route = src('app/api/pois/domain-local/route.ts');
  assert.match(route, /isAllowedHangzhouBounds/);
  assert.match(route, /code: 'INVALID_BOUNDS'/);
  assert.match(route, /code: 'BOUNDS_OUT_OF_RANGE'/);
  const boundsIdx = route.indexOf('const bounds = parseBoundsParam');
  const dbIdx = route.indexOf('await loadHangzhouPoisFromDb');
  assert.ok(boundsIdx !== -1 && dbIdx !== -1 && boundsIdx < dbIdx);
  assert.ok(route.indexOf("code: 'INVALID_BOUNDS'") < dbIdx);
  assert.ok(route.indexOf("code: 'BOUNDS_OUT_OF_RANGE'") < dbIdx);
});

test('#10 suggest: q/mode/center 超长 → 400（在缓存 key 之前拦截）', () => {
  const route = src('app/api/suggest/route.ts');
  assert.match(route, /const MAX_Q_LENGTH = 100/);
  assert.match(route, /const MAX_MODE_LENGTH = 32/);
  assert.match(route, /const MAX_CENTER_LENGTH = 128/);
  assert.match(route, /rawQ\.length > MAX_Q_LENGTH/);
  assert.match(route, /modeValue\.length > MAX_MODE_LENGTH/);
  assert.match(route, /centerRaw\.length > MAX_CENTER_LENGTH/);
  assert.match(route, /code: 'PARAM_TOO_LARGE'/);
  assert.match(route, /status: 400/);
  const keyIdx = route.indexOf('const cacheKey =');
  const guardIdx = route.indexOf("code: 'PARAM_TOO_LARGE'");
  assert.ok(guardIdx !== -1 && keyIdx !== -1 && guardIdx < keyIdx, 'suggest 参数校验先于缓存 key');
  // 原契约保持：空 q 热门搜索 / 本地优先 / 空结果不缓存
  assert.match(route, /trendingForMode/);
  assert.match(route, /mode === 'domain'/);
  assert.match(route, /slice\(0, 10\)/);
  assert.match(route, /if \(suggestions\.length > 0\) \{\s*writePublicCache/);
});

test('#7 pois/[id]: 不再二次解码（Next 动态段已解码），畸形 % 不 500', () => {
  const route = src('app/api/pois/[id]/route.ts');
  // 裸 %（如 /api/pois/100%25 → "100%"）二次解码会抛 URIError → 500；路由内不得再调用解码
  assert.doesNotMatch(route, /decodeURIComponent\(/);
  // 原契约保持：共享 catalog 查询 + 404 + 缓存
  assert.match(route, /loadServerCatalogByIdStrict/);
  assert.match(route, /status: 404/);
  assert.match(route, /writePublicCache/);
  assert.match(route, /publicCacheKey/);
});

test('#7 pois/[id]: id 超长（>256）→ 400，且在缓存 key 之前拦截', () => {
  const route = src('app/api/pois/[id]/route.ts');
  assert.match(route, /const MAX_ID_LENGTH = 256/);
  assert.match(route, /id\.length > MAX_ID_LENGTH/);
  assert.match(route, /code: 'ID_TOO_LONG'/);
  assert.match(route, /status: 400/);
  const keyIdx = route.indexOf('const cacheKey =');
  const guardIdx = route.indexOf("code: 'ID_TOO_LONG'");
  assert.ok(guardIdx !== -1 && keyIdx !== -1 && guardIdx < keyIdx, 'id 长度校验先于缓存 key');
});

test('#11 notifications: 同用户 60s 冷却 → 429 + Retry-After', () => {
  const route = src('app/api/me/notifications/route.ts');
  assert.match(route, /const NOTIFY_COOLDOWN_MS = 60_000/);
  assert.match(route, /import \{ BoundedRateStore \} from "@\/lib\/bounded-rate-store"/);
  assert.match(route, /const notifyCooldown = new BoundedRateStore<number>\(NOTIFY_COOLDOWN_CAPACITY\)/);
  assert.match(route, /notifyCooldown\.get\(user\.id, now\)/);
  assert.match(route, /now - last < NOTIFY_COOLDOWN_MS/);
  assert.match(route, /code: "RATE_LIMITED"/);
  assert.match(route, /status: 429/);
  assert.match(route, /"Retry-After"/);
  // 只有成功读到目录才消耗冷却；DB 故障可重试，随后才执行扫描 + 入队
  const scanIdx = route.indexOf('loadServerCatalog("work")');
  const nullIdx = route.indexOf('catalog === null');
  const setIdx = route.indexOf('notifyCooldown.set(user.id, now, NOTIFY_COOLDOWN_MS, now)');
  assert.ok(nullIdx !== -1 && scanIdx !== -1 && nullIdx > scanIdx, '目录故障分支必须在查库之后');
  assert.ok(setIdx !== -1 && scanIdx !== -1 && setIdx > scanIdx, '冷却记录必须在成功查库之后');
  // 原有行为保持
  assert.match(route, /matchJobAlerts/);
  assert.match(route, /enqueueNotification/);
  assert.match(route, /status: "queued"/);
});

test('#12 saved: name/poiId 长度上限 + lng/lat 范围校验 → 400', () => {
  const route = src('app/api/me/saved/route.ts');
  assert.match(route, /const MAX_NAME_LENGTH = 100/);
  assert.match(route, /const MAX_POI_ID_LENGTH = 200/);
  assert.match(route, /code: "ADDRESS_TOO_LONG"/);
  assert.match(route, /const MIN_LNG = -180/);
  assert.match(route, /const MAX_LNG = 180/);
  assert.match(route, /const MIN_LAT = -90/);
  assert.match(route, /const MAX_LAT = 90/);
  assert.match(route, /code: "NAME_TOO_LONG"/);
  assert.match(route, /code: "POI_ID_TOO_LONG"/);
  const deleteIdx = route.indexOf('export async function DELETE');
  const deleteLimitIdx = route.indexOf('poiId.length > MAX_POI_ID_LENGTH', deleteIdx);
  const removeIdx = route.indexOf('removeSavedStrict(user.id, poiId)', deleteIdx);
  assert.ok(deleteLimitIdx !== -1 && removeIdx !== -1 && deleteLimitIdx < removeIdx, 'DELETE poiId is bounded before storage');
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
  // 原有参数契约保持
  assert.match(route, /poiId and name required/);
  assert.match(route, /isPersistableSavedSnapshot/);
  // 目录权威写入:只用 poiId 查询 work catalog,不信任浏览器快照字段
  assert.match(route, /loadServerCatalogByIdStrict/);
  assert.match(route, /listSavedStrict/);
  assert.match(route, /removeSavedStrict/);
  const saveBlock = route.slice(saveIdx, route.indexOf('});', saveIdx) + 3);
  assert.doesNotMatch(saveBlock, /body\.(name|address|lng|lat)/, '保存不得使用浏览器快照字段');
  assert.match(saveBlock, /catalog\.name/);
  assert.match(saveBlock, /catalog\.location\.(address|lng|lat)/);
  assert.match(route, /code: "DB_UNAVAILABLE"/);
  assert.match(route, /status: 503/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /body\.kind === "recruitment"/);
  assert.match(route, /canonicalMode/);
});

test('#12 pois: 超长外部参数 / page / pageSize 非法 → 400,且先于缓存 key 与 JSON.parse', () => {
  const route = src('app/api/pois/route.ts');
  assert.match(route, /const MAX_Q_LENGTH = 100/);
  assert.match(route, /const MAX_FILTERS_JSON_LENGTH = 4000/);
  assert.match(route, /const MAX_BOUNDS_LENGTH = 128/);
  assert.match(route, /const MAX_PAGE_SIZE = 100/);
  assert.match(route, /const MAX_PAGE = 10_000/);
  assert.match(route, /const MAX_CENTER_LENGTH = 128/);
  assert.match(route, /function parseCenter/);
  assert.match(route, /code: 'PARAM_TOO_LARGE'/);
  assert.match(route, /code: 'INVALID_PAGE'/);
  assert.match(route, /code: 'INVALID_PAGE_SIZE'/);
  assert.match(route, /status: 400/);
  // 外部字符串长度、分页都必须先于缓存 key 构造与 filters JSON 解析。
  const keyIdx = route.indexOf('const cacheKey =');
  const paramIdx = route.indexOf("code: 'PARAM_TOO_LARGE'");
  const parseIdx = route.indexOf('parseFilters(filtersRaw)');
  const pageIdx = route.indexOf("code: 'INVALID_PAGE'");
  const sizeIdx = route.indexOf("code: 'INVALID_PAGE_SIZE'");
  assert.ok(paramIdx !== -1 && paramIdx < keyIdx, '参数限长先于缓存 key');
  assert.ok(parseIdx !== -1 && paramIdx < parseIdx, 'filters 先限长再 JSON.parse');
  assert.ok(pageIdx !== -1 && pageIdx < keyIdx, 'page 校验先于缓存 key');
  assert.ok(sizeIdx !== -1 && sizeIdx < keyIdx, 'pageSize 校验先于缓存 key');
  // 缺失/空串回退默认(1 / 20),不误伤正常请求
  assert.match(route, /pagedParam\(url\.searchParams\.get\('page'\), 1, MAX_PAGE\)/);
  assert.match(route, /pagedParam\(url\.searchParams\.get\('pageSize'\), 20, MAX_PAGE_SIZE\)/);
  // 原契约保持:共享 catalog + 管线 + 缓存
  assert.match(route, /loadServerCatalog/);
  assert.match(route, /searchPublicCatalog/);
  assert.match(route, /writePublicCache/);
});

test('#12 search: 工作目录 DB 故障(null)→ 502,不写缓存(不伪装成功空结果)', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /error: 'work_db_unavailable'/);
  assert.match(route, /status: 502/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /pois === null/);
  const dbIdx = route.indexOf('await loadServerCatalog');
  const failIdx = route.indexOf("error: 'work_db_unavailable'");
  const cacheIdx = route.indexOf('writePublicCache(cacheKey, payload)');
  assert.ok(dbIdx !== -1 && failIdx !== -1 && dbIdx < failIdx, '失败分支在查库之后返回');
  assert.ok(cacheIdx !== -1 && failIdx < cacheIdx, '502 分支先于写缓存(故障不缓存)');
  assert.match(route, /shouldWritePublicCatalogCache/);
});

test('#12 pois: 工作目录 DB 故障(null)→ 502,不写缓存(不伪装成功空结果)', () => {
  const route = src('app/api/pois/route.ts');
  assert.match(route, /error: 'work_db_unavailable'/);
  assert.match(route, /status: 502/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /pois === null/);
  const dbIdx = route.indexOf('await loadServerCatalog');
  const failIdx = route.indexOf("error: 'work_db_unavailable'");
  const cacheIdx = route.indexOf('writePublicCache(cacheKey, payload)');
  assert.ok(dbIdx !== -1 && failIdx !== -1 && dbIdx < failIdx, '失败分支在查库之后返回');
  assert.ok(cacheIdx !== -1 && failIdx < cacheIdx, '502 分支先于写缓存(故障不缓存)');
  assert.match(route, /shouldWritePublicCatalogCache/);
});

test('#12 domain-local: bounds/q/categories/分页参数超长 → 400,且先于缓存 key', () => {
  const route = src('app/api/pois/domain-local/route.ts');
  assert.match(route, /const MAX_Q_LENGTH = 100/);
  assert.match(route, /const MAX_PARAM_LENGTH = 128/);
  assert.match(route, /const MAX_CATEGORIES_LENGTH = 300/);
  assert.match(route, /code: 'PARAM_TOO_LARGE'/);
  const keyIdx = route.indexOf('const cacheKey =');
  const paramIdx = route.indexOf("code: 'PARAM_TOO_LARGE'");
  const dbIdx = route.indexOf('await loadHangzhouPoisFromDb');
  assert.ok(paramIdx !== -1 && keyIdx !== -1 && paramIdx < keyIdx, '参数限长先于缓存 key');
  assert.ok(dbIdx !== -1 && paramIdx < dbIdx, '参数限长先于 SQL 查询');
});

test('#12 domain-local: 本地库故障(null)→ 502 错误信号,不写缓存(不伪装成功空结果)', () => {
  const route = src('app/api/pois/domain-local/route.ts');
  // null 分支返回 502 { error: 'local_db_unavailable' },no-store
  assert.match(route, /error: 'local_db_unavailable'/);
  assert.match(route, /status: 502/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /if \(!result\)/);
  // 顺序契约:null 判定在查库结果之后、且先于缓存写入(故障响应不得入缓存)
  const dbIdx = route.indexOf('await loadHangzhouPoisFromDb');
  const failIdx = route.indexOf("error: 'local_db_unavailable'");
  const cacheIdx = route.indexOf('writePublicCache(cacheKey');
  assert.ok(dbIdx !== -1 && failIdx !== -1 && dbIdx < failIdx, '失败分支在查库之后返回');
  assert.ok(cacheIdx !== -1 && failIdx < cacheIdx, '502 分支先于写缓存(故障不缓存)');
  // 真实查库成功(真空 results:[] 也是 200)仍走缓存 + PUBLIC_CACHE_CONTROL
  assert.match(route, /writePublicCache\(cacheKey, payload\)/);
  assert.match(route, /PUBLIC_CACHE_CONTROL/);
});

test('#18 me/PATCH: displayName 长度上限 + avatarUrl 协议白名单(>2048/非 http(s))→ 400', () => {
  const route = src('app/api/auth/me/route.ts');
  assert.match(route, /const MAX_DISPLAY_NAME_LENGTH = 50/);
  assert.match(route, /const MAX_AVATAR_URL_LENGTH = 2048/);
  assert.match(route, /code: 'INVALID_DISPLAY_NAME'/);
  assert.match(route, /code: 'DISPLAY_NAME_TOO_LONG'/);
  assert.match(route, /code: 'INVALID_AVATAR_URL'/);
  assert.match(route, /url\.protocol === 'http:' \|\| url\.protocol === 'https:'/);
  assert.match(route, /status: 400/);
  // 校验先于 updateUser(不入库不回显)
  const saveIdx = route.indexOf('updateUser(user.id,');
  const nameIdx = route.indexOf("code: 'DISPLAY_NAME_TOO_LONG'");
  const urlIdx = route.indexOf("code: 'INVALID_AVATAR_URL'");
  assert.ok(nameIdx !== -1 && saveIdx !== -1 && nameIdx < saveIdx, 'displayName 校验先于 updateUser');
  assert.ok(urlIdx !== -1 && saveIdx !== -1 && urlIdx < saveIdx, 'avatarUrl 校验先于 updateUser');
  // avatarUrl='' 保留清头像语义(removeAvatar 流程);401 未登录契约保持
  assert.match(route, /body\.avatarUrl !== ''/);
  assert.match(route, /code: 'UNAUTHORIZED'/);
});

test('avatar upload rejects File.size before materializing the ArrayBuffer', () => {
  const route = src('app/api/me/avatar/route.ts');
  const sizeIdx = route.indexOf('file.size > MAX_AVATAR_BYTES');
  const bufferIdx = route.indexOf('await file.arrayBuffer()');
  assert.ok(sizeIdx !== -1, 'must check File.size');
  assert.ok(bufferIdx !== -1 && sizeIdx < bufferIdx, 'size guard must precede ArrayBuffer');
});

test('search history persists only bounded queries and entity refs', () => {
  const historyRoute = src('app/api/me/search-history/route.ts');
  assert.match(historyRoute, /const MAX_QUERY_LENGTH = 100/);
  assert.match(historyRoute, /code: 'QUERY_TOO_LONG'/);
  const queryIdx = historyRoute.indexOf("code: 'QUERY_TOO_LONG'");
  const addIdx = historyRoute.indexOf('addHistory(user.id, query, mode, entity)');
  assert.ok(queryIdx !== -1 && addIdx !== -1 && queryIdx < addIdx);
});

test('applications persist bounded fields and only http(s) apply links', () => {
  const route = src('app/api/me/applications/route.ts');
  const write = src('lib/application-write.ts');
  const csv = src('lib/application-csv.ts');
  const imported = src('app/api/me/applications/import/route.ts');
  assert.match(route, /MAX_ID_LENGTH = 200/);
  assert.match(write, /code: 'APPLICATION_FIELD_TOO_LONG'/);
  assert.match(write, /code: 'INVALID_APPLY_URL'/);
  assert.match(csv, /url\.protocol === 'http:' \|\| url\.protocol === 'https:'/);
  const parseIdx = route.indexOf('parseApplicationWrite(body, catalog');
  const recordIdx = route.indexOf('recordApplication(user.id, parsed.value)');
  assert.ok(parseIdx !== -1 && recordIdx !== -1 && parseIdx < recordIdx);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /code: "UNKNOWN_STATUS"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /DB_UNAVAILABLE/);
  const patchDbGuard = route.slice(route.indexOf('export async function PATCH'));
  assert.match(patchDbGuard, /try \{/);
  assert.match(patchDbGuard, /err instanceof DbUnavailableError/);
  assert.match(patchDbGuard, /status: 503/);
  assert.match(imported, /APPLICATION_CSV_IMPORT_MAX/);
  assert.match(imported, /recordApplications/);
  const pipeline = src('app/api/me/applications/pipeline/route.ts');
  assert.match(pipeline, /reassignApplicationStatuses/);
  assert.match(pipeline, /sanitizeApplicationPipeline/);
});

test('account GET routes map configured DB failures to 503 DB_UNAVAILABLE', () => {
  const me = src('app/api/auth/me/route.ts');
  const applications = src('app/api/me/applications/route.ts');
  const history = src('app/api/me/search-history/route.ts');
  const memories = src('app/api/me/memories/route.ts');
  const notifications = src('app/api/me/notifications/route.ts');
  const avatar = src('app/api/me/avatar/route.ts');
  const saved = src('app/api/me/saved/route.ts');
  for (const route of [me, applications, history, memories, notifications, avatar, saved]) {
    assert.match(route, /export async function GET/);
    const get = route.slice(route.indexOf('export async function GET'));
    assert.match(get, /try \{/);
    assert.match(get, /err instanceof DbUnavailableError/);
    assert.match(get, /code: ['"]DB_UNAVAILABLE['"]/);
    assert.match(get, /status: 503/);
  }
});
