import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  // ws1 saved-layer-nofly(2026-08-22):toggle 不再移动相机(用户反馈),
  // 「收藏相机同步」状态机(ws1 saved-overlay-wipe 结构性抑制,替代 500ms
  // 时间窗补丁)随其唯一输入源 setBounds 一起退役——hook 不再再导出,
  // 模块已由 boss 合并时物理删除(git rm;worker 沙箱内曾为零导出退役桩)。
  assert.doesNotMatch(hook, /VIEWPORT_SUPPRESS_MS|Date\.now\(\) \+ 500/);
  assert.doesNotMatch(hook, /saved-camera-sync|SavedCameraSync|cameraAtDestination|consumeSavedCameraSync|SAVED_CAMERA_MATCH_METERS/);
  assert.equal(existsSync(join(root, 'lib/saved-camera-sync.ts')), false, '退役模块已物理删除(boss 合并收尾)');
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
  // 抑制事件监听(moveend/zoomend)在 hook 内;toggle 不再移动相机(no-fly),
  // onViewChange 直接调度,无任何程序化相机抑制
  assert.match(hook, /map\.on\("moveend", onViewChange\)/);
  assert.match(hook, /map\.on\("zoomend", onViewChange\)/);
  assert.doesNotMatch(hook, /savedCameraSyncRef|consumeSavedCameraSync/);
  // 空批次 ≠ 无数据(ws1 结构性修复):视口空批次不再把 catalog 置空销毁 marker 池
  assert.match(hook, /空批次 ≠ 无数据/);
  assert.doesNotMatch(hook, /catalogRef\.current = \[\];\s*setCatalog\(\[\]\);/);
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
  // 但主加载 finally 的补跑路径保留在 map-shell(行为不变);toggle 收藏抑制
  // 随 useSavedLayer 抽取(2026-08-20 QA scan #6):写入标记在 hook 内
  assert.match(shell, /useWorkViewport\(\{/);
  assert.match(shell, /viewportLoaderRef\.current\?\.schedule\(\);/);
  const savedLayer = src('hooks/use-saved-layer.ts');
  // toggle 侧:无相机动作、无状态机置位(ws1 saved-layer-nofly)——只写 pref + 翻转
  assert.doesNotMatch(savedLayer, /savedCameraSyncRef|setBounds|overlayBounds|mapInstance/);
  assert.match(savedLayer, /writeSavedOverlayPref\(next\)/);
  assert.match(shell, /useSavedLayer\(\{/);
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

// ---- useSavedLayer(收藏图层;2026-08-20 QA scan #6)----

test('useSavedLayer hook exists with exported signature', () => {
  const hook = src('hooks/use-saved-layer.ts');
  assert.match(hook, /export function useSavedLayer\(\s*deps: UseSavedLayerDeps/);
  assert.match(hook, /export interface UseSavedLayerDeps/);
  assert.match(hook, /export interface UseSavedLayerResult/);
  // 派生 + 初始化 + toggle + hide 四件事都在 hook 内
  assert.match(hook, /savedPlacesToOverlay\(savedPlaces, compareCatalog, mode\)/);
  // 挂载初始化:读回持久化偏好,默认关(2026-08-23 用户决策)
  assert.match(hook, /readSavedOverlayPref\(false\)/);
  assert.match(hook, /writeSavedOverlayPref\(next\)/);
  assert.match(hook, /writeSavedOverlayPref\(false\)/);
  assert.match(hook, /return \{ savedOverlay, overlayPois, toggle, hide \};/);
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /useSavedLayer\(\{/);
  // map-shell 不再直接持有收藏图层状态/派生/toggle(纯接线)
  assert.doesNotMatch(shell, /const \[savedOverlay, setSavedOverlay\] = useState/);
  assert.doesNotMatch(shell, /const overlayPois = useMemo/);
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

// ---- useMapEngine(引擎切换生命周期;ws-3 安全切换重构)----

test('useMapEngine:最新意图优先 + 错误态清理(ws-3 生命周期契约)', () => {
  const hook = src('hooks/use-map-engine.ts');
  // 代际:每次 switchEngine 递增;在飞切换 resolve 后代际不匹配 → 丢弃并销毁
  assert.match(hook, /generationRef/);
  assert.match(hook, /const gen = \+\+generationRef\.current;/);
  assert.match(hook, /gen !== generationRef\.current/);
  assert.match(hook, /next\.destroy\(\);\s*\/\/ 更新意图已发起:丢弃本结果/);
  // 不再用 switchingRef 硬丢弃第二次点击
  assert.doesNotMatch(hook, /switchingRef\.current/);
  // 取消 token:新意图发起置旧 signal(load 阶段早期让路);卸载也让路在飞切换
  assert.match(hook, /activeSignalRef/);
  assert.match(hook, /activeSignalRef\.current\.aborted = true;/);
  // 失败路径:清空视图状态暴露可重试
  assert.match(hook, /console\.error\("\[use-map-engine\] switchEngine failed:", err\);/);
  assert.match(hook, /viewRef\.current = null;/);
  // 挂载/teardown 竞态:teardown 在 createView resolve 后发生 → 已建视图销毁
  // (ws-2 起取消语义 ref 化为挂载代际 seq !== mountSeqRef.current)
  assert.match(hook, /if \(seq !== mountSeqRef\.current\) \{[\s\S]{0,160}created\.destroy\(\);/);
  // 挂载与切换并发:切换落地时销毁期间落地的挂载视图(同容器双实例兜底)
  assert.match(hook, /viewRef\.current !== next && !viewRef\.current\.isDestroyed\?\.\(\)/);
});

test('map-shell:usePOIMap 的 view 参数来自 state(engineView),非 mapInstance ref', () => {
  const shell = src('components/map-shell.tsx');
  // POI 重建随引擎切换显式触发(创建 effect deps [view]),不依赖隐式 setState 链
  assert.match(shell, /usePOIMap\(engineView, \{/);
  assert.doesNotMatch(shell, /usePOIMap\(mapInstance\.current/);
  // mapInstance ref 仍保留给事件回调内同步读(locate/快照),不用于 POI 重建
  assert.match(shell, /mapInstance\.current = engineView;/);
});

// ---- useMapEngine(ws-2 增量:挂载失败错误态 + 重试;旧断言不放宽)----

test('useMapEngine:返回契约增量(4 旧字段 + mountError/retryMount 2 新字段)', () => {
  const hook = src('hooks/use-map-engine.ts');
  // 旧 4 字段 + 新 2 字段同处返回(ws-3 消费 mountError/retryMount 渲染错误出口)
  assert.match(hook, /return \{ engine, view, isSwitching, switchEngine, mountError, retryMount \};/);
  // 契约类型:MapMountError 三字段(engine/code?/message)+ 两个返回字段声明
  assert.match(hook, /export interface MapMountError \{[\s\S]*?engine: string;[\s\S]*?code\?: string;[\s\S]*?message: string;/);
  assert.match(hook, /mountError: MapMountError \| null;/);
  assert.match(hook, /retryMount: \(\) => void;/);
  // 引擎总线同步对齐:面板侧(useMapEnginePanel)无活跃实例时 null/noop 兜底
  assert.match(hook, /mountError: null, retryMount: noop \};/);
});
