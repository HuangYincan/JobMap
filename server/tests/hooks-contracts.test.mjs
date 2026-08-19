import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ---- useWorkViewport(视口加载器 + 挂载对齐;2026-08-20 起仅 domain)----

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
  // work 分支:全量加载后无视口请求(2026-08-20 修复)——marker 池首载取尽,
  // 侧栏列表客户端裁剪(map-shell pois memo 按 mapBounds 过滤),不传视口参数
  assert.match(hook, /if \(mode === "work"\) \{/);
  assert.doesNotMatch(hook, /loadWorkViewport|maxTierForZoom|listCatalogRef|setListCatalog/);
  // domain 分支:分类门控 + 随视角刷新(fetchPOIsForMode)
  assert.match(hook, /if \(!v\.query && !v\.filters\?\.category\) \{/);
  assert.match(hook, /fetchPOIsForMode\(\{/);
  // 挂载对齐加载(ws1 Bug1):缓存视野与当前视野不符 → 主动调度
  assert.match(hook, /needsViewportAlign\(cached\.viewport, snap\.center, snap\.zoom\)/);
  assert.match(hook, /viewportLoaderRef\.current\.schedule\(\);/);
  // 抑制窗口事件监听(moveend/zoomend)在 hook 内
  assert.match(hook, /map\.on\("moveend", onViewChange\)/);
  assert.match(hook, /map\.on\("zoomend", onViewChange\)/);
  // 池分离接线(map-shell):listCatalog 状态已删;pois 派生 = 全量池按 mapBounds
  // 客户端裁剪(work 模式),marker 源 catalog 只增不减(全量加载后恒定)
  assert.doesNotMatch(shell, /listCatalog|setListCatalog|listCatalogRef/);
  assert.match(shell, /catalog\.filter\(\(p\) => inBounds\(p\.location, mapBounds\)\)/);
  // work 主加载:全量取尽(不传 bounds/maxTier,page 恒 1)
  assert.match(shell, /maxPages: WORK_FULL_LOAD_MAX_PAGES,/);
  assert.doesNotMatch(shell, /maxTier: maxTierForZoom\(view\.zoom\)/);
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
  assert.match(hook, /setPageOffset\(cached\.pageOffset\);/);
  assert.match(hook, /setSearchOrigin\(cached\.searchOrigin\);/);
  assert.match(hook, /setQuery\(cached\.query\);/);
  assert.match(hook, /setFilters\(cached\.filters\);/);
  assert.match(hook, /if \(cached\.sort\) setSort\(cached\.sort\);/);
  // 列表池已删(2026-08-20):还原只喂 catalog,work 列表由 pois memo 客户端裁剪
  assert.doesNotMatch(hook, /listCatalogRef|setListCatalog/);
  // noMore 复位(2026-08-20 修订):work 全量池恢复即取尽 → 置真(避免「加载
  // 更多」死按钮);domain 保持复位(视口对齐后由加载结果判定)
  assert.match(hook, /canonicalMode\(mode\) === "work"\) \{\s*noMoreRef\.current = true;/);
  assert.match(hook, /setNoMoreData\(true\);/);
  assert.match(hook, /noMoreRef\.current = false;/);
  assert.match(hook, /setNoMoreData\(false\);/);
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /useModeCacheRestore\(/);
  // map-shell 不再整体拥有 restore effect(deps 恒空只在首屏读一次)
  assert.doesNotMatch(shell, /const cached = readModeCache\(mode\);\s*[\s\S]{0,200}skipFetchRef\.current = true;/);
});
