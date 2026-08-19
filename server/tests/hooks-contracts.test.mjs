import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ---- useWorkViewport(视口按需加载 + 挂载对齐)----

test('useWorkViewport hook exists with exported signature', () => {
  const hook = src('hooks/use-work-viewport.ts');
  assert.match(hook, /export function useWorkViewport\(\s*deps: WorkViewportDeps/);
  assert.match(hook, /export interface WorkViewportDeps/);
  assert.match(hook, /export interface WorkViewportState/);
  assert.match(hook, /export const VIEWPORT_SUPPRESS_MS = 500/);
  assert.match(hook, /export function readMapViewSnapshot/);
  assert.match(hook, /createViewportLoader\(/);
  // 返回 loader 实例供主加载 finally 补跑 pending 视口刷新
  assert.match(hook, /return \{ viewportLoaderRef \};/);
});

test('work viewport scheduling conditions live in the hook, not map-shell', () => {
  const hook = src('hooks/use-work-viewport.ts');
  const shell = src('components/map-shell.tsx');
  // geoSettled 门控 + 主加载在飞 → 置 pending 由主加载 finally 补跑(Bug 7)
  assert.match(hook, /if \(!v\.geoSettled\) return;/);
  assert.match(hook, /if \(loadingRef\.current\) \{/);
  assert.match(hook, /viewportRefreshPendingRef\.current = true;/);
  // work 分支:列表 vs 地图池分离(wsv)——existing:[] 列表池按视口换,
  // marker 池(catalog)只增不减;视口取尽(maxPages 大值)+ 去上限(cap: Infinity)
  assert.match(hook, /mode === "work"/);
  assert.match(hook, /loadWorkViewport\(\{/);
  assert.match(hook, /maxTier: maxTierForZoom\(zoom\)/);
  assert.match(hook, /existing: \[\],/);
  assert.match(hook, /listCatalogRef\.current = batch;/);
  assert.match(hook, /setListCatalog\(batch\);/);
  assert.match(hook, /mergePoisById\(catalogRef\.current, batch, Infinity\)/);
  assert.match(hook, /cap: Infinity,/);
  assert.match(hook, /maxPages: 10_000,/);
  assert.match(hook, /noMoreRef\.current = result\.noMore;/);
  // 空批次不清空任何池(增量语义:marker 全量保留,列表保留上一视角卡片)
  assert.match(hook, /if \(batch\.length === 0\) return;/);
  // domain 分支:分类门控 + 随视角刷新(fetchPOIsForMode)
  assert.match(hook, /if \(!v\.query && !v\.filters\?\.category\) \{/);
  assert.match(hook, /fetchPOIsForMode\(\{/);
  // 挂载对齐加载(ws1 Bug1):缓存视野与当前视野不符 → 主动调度
  assert.match(hook, /needsViewportAlign\(cached\.viewport, snap\.center, snap\.zoom\)/);
  assert.match(hook, /viewportLoaderRef\.current\.schedule\(\);/);
  // 抑制窗口事件监听(moveend/zoomend)在 hook 内
  assert.match(hook, /map\.on\("moveend", onViewChange\)/);
  assert.match(hook, /map\.on\("zoomend", onViewChange\)/);
  // 池分离接线(map-shell):listCatalog 状态存在;pois 派生用列表池
  // (work 模式),marker 源 catalog 只增不减;刷新/还原/主加载都同步列表池
  assert.match(shell, /const \[listCatalog, setListCatalog\] = useState<POI\[\]>\(\[\]\);/);
  assert.match(shell, /listCatalog\.length > 0 \? listCatalog : catalog/);
  assert.match(shell, /listCatalogRef\.current = \[\];/); // 刷新清空两池
  assert.match(shell, /setListCatalog\(cached\.catalog\);/); // 缓存还原喂列表池
  assert.match(shell, /setListCatalog\(batch\);/); // 主加载批次喂列表池(work)
  assert.match(shell, /listCatalogRef/);
  // map-shell 只做接线:不再创建 loader / 不再判定对齐 / 不再定义抑制常量
  assert.doesNotMatch(shell, /createViewportLoader/);
  assert.doesNotMatch(shell, /needsViewportAlign/);
  assert.doesNotMatch(shell, /const VIEWPORT_SUPPRESS_MS/);
  assert.doesNotMatch(shell, /map\.on\("moveend", onViewChange\)/);
  // 但主加载 finally 的补跑路径与 toggle 收藏抑制保留在 map-shell(行为不变)
  assert.match(shell, /useWorkViewport\(\{/);
  assert.match(shell, /viewportLoaderRef\.current\?\.schedule\(\);/);
  assert.match(shell, /suppressViewportRefreshUntilRef\.current = Date\.now\(\) \+ VIEWPORT_SUPPRESS_MS;/);
});

// ---- useSearchState(搜索/建议状态)----

test('useSearchState hook exists and owns suggest/cleanup logic', () => {
  const hook = src('hooks/use-search-state.ts');
  assert.match(hook, /export function useSearchState\(options: SearchStateOptions\)/);
  assert.match(hook, /export interface SearchStateOptions/);
  // 空查询清空建议
  assert.match(hook, /if \(!query\.trim\(\)\) \{\s*setSuggestions\(\[\]\);/);
  // 防抖依赖只留 [query, mode](zoom/catalog 高频变化不再重置定时器)
  assert.match(hook, /\}, \[query, mode\]\);/);
  assert.doesNotMatch(hook, /\}, \[query, mode, zoom, catalog\]\);/);
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /useSearchState\(/);
});

// ---- useModeCacheRestore(会话缓存还原)----

test('useModeCacheRestore hook owns session cache restore branch', () => {
  const hook = src('hooks/use-mode-cache-restore.ts');
  assert.match(hook, /export function useModeCacheRestore\(deps: ModeCacheRestoreDeps\)/);
  assert.match(hook, /export interface ModeCacheRestoreDeps/);
  // restore 分支:读缓存 → 还原 catalog/pageOffset/searchOrigin/query/filters/sort
  assert.match(hook, /const cached = readModeCache\(mode\);/);
  assert.match(hook, /skipFetchRef\.current = true;/);
  assert.match(hook, /setCatalog\(cached\.catalog\);/);
  // 池分离(wsv):还原即列表池 = 全量 marker 池(挂载对齐的视口加载随后只换列表)
  assert.match(hook, /listCatalogRef\.current = cached\.catalog;/);
  assert.match(hook, /setListCatalog\(cached\.catalog\);/);
  assert.match(hook, /setPageOffset\(cached\.pageOffset\);/);
  assert.match(hook, /setSearchOrigin\(cached\.searchOrigin\);/);
  assert.match(hook, /setQuery\(cached\.query\);/);
  assert.match(hook, /setFilters\(cached\.filters\);/);
  assert.match(hook, /if \(cached\.sort\) setSort\(cached\.sort\);/);
  // 恢复缓存不经主 load,noMore 复位避免「没有更多结果」粘住
  assert.match(hook, /noMoreRef\.current = false;/);
  assert.match(hook, /setNoMoreData\(false\);/);
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /useModeCacheRestore\(/);
  // map-shell 不再整体拥有 restore effect(deps 恒空只在首屏读一次)
  assert.doesNotMatch(shell, /const cached = readModeCache\(mode\);\s*[\s\S]{0,200}skipFetchRef\.current = true;/);
});
