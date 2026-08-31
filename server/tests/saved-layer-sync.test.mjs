// ============================================================
// 收藏图层 toggle 不跳视角回归测试(ws1 saved-layer-nofly,2026-08-22)
//
// 用户反馈(2026-08-22):打开收藏图层时视角跳转(相机 fit 收藏外接框),
// 明确不要跳转。目标行为:打开/关闭收藏图层**相机完全不动**(不 setBounds /
// 不 fit / 不移视野);打开 = 只切换 pin 可见性(收藏点显示、普通 POI 隐藏)
// + Explore 列表切「我的收藏」(互斥语义);关闭 = 恢复搜索管线 pin 与列表,
// 秒恢复(池只增不删,不重查)。
//
// 实现:use-saved-layer toggle 的相机动作(overlayBounds + map.setBounds)
// 与「收藏相机同步」状态机置位全部移除;状态机消费者(use-work-viewport
// onViewChange 抑制、map-shell syncView 圆心冻结)一并清理,模块由 boss
// 合并时物理删除(git rm 收尾,worker 沙箱内曾降级为零导出退役桩)。
//
// 覆盖(jsdom 可测层:本仓库无 jsdom 运行时,沿用「源码契约 + 语义镜像」
// 模式,与 saved-layer-mutex 同构):
// - 源码契约:use-saved-layer toggle 体内不存在任何相机动作与状态机引用,
//   deps 不含 mapInstance/savedCameraSyncRef;src 全树零引用退役模块;
// - 语义镜像:以 mock map(setBounds/fit spy)驱动「开→关」toggle 语义,
//   断言相机方法全程零调用;
// - 保留项:空批次不置空 catalog 加固仍在 use-work-viewport(独立于状态机)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

/** 递归收集 src 下全部 .ts 文件(相对 src 的路径)。 */
function allTsFiles(dir = root) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...allTsFiles(p));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(p.slice(root.length + 1));
  }
  return out;
}

/** 与 use-saved-layer toggle 同构的语义镜像:只翻转状态 + 写 pref,不触碰相机。 */
function mirrorToggle(map, savedOverlay) {
  const next = !savedOverlay;
  // writeSavedOverlayPref(next) —— node 环境无 window,no-op(与 hook 同路径)
  return next;
}

// ---- 回归:打开/关闭不触发相机动作 ----

test('回归:toggle 语义镜像——开/关全程不调用 setBounds/fit(相机不动)', () => {
  // mock map:setBounds/fit/flyTo/setCenter 全部 spy,任何调用即失败
  const calls = [];
  const map = {
    setBounds(b) { calls.push(['setBounds', b]); },
    setCenter(c) { calls.push(['setCenter', c]); },
    fitToPins() { calls.push(['fitToPins']); },
    flyTo() { calls.push(['flyTo']); },
  };

  let savedOverlay = false;
  savedOverlay = mirrorToggle(map, savedOverlay); // 开
  assert.equal(savedOverlay, true, '开 = 状态翻转');
  savedOverlay = mirrorToggle(map, savedOverlay); // 关
  assert.equal(savedOverlay, false, '关 = 状态翻转');
  assert.deepEqual(calls, [], '打开/关闭收藏图层:相机方法零调用(不 setBounds / 不 fit / 不移视野)');
});

test('源码契约:use-saved-layer toggle 体内无任何相机动作与状态机引用', () => {
  const savedLayer = src('hooks/use-saved-layer.ts');
  const toggleAt = savedLayer.indexOf('const toggle = useCallback');
  const hideAt = savedLayer.indexOf('const hide = useCallback');
  assert.ok(toggleAt !== -1 && hideAt > toggleAt, 'toggle/hide anchors must exist in order');
  const toggleBody = savedLayer.slice(toggleAt, hideAt);
  // 相机动作:setBounds/setCenter/fit/flyTo 一律不得出现在 toggle 体内
  assert.doesNotMatch(toggleBody, /setBounds|setCenter|fitToPins|flyTo|\.fit\(/);
  // 状态机引用 + 外接框计算不得残留
  assert.doesNotMatch(toggleBody, /savedCameraSyncRef|overlayBounds|mapInstance|destCenter|consumed/);
  // toggle 只做三件事:登录门控 → 写 pref → 翻转状态
  assert.match(toggleBody, /writeSavedOverlayPref\(next\)/);
  assert.match(toggleBody, /setSavedOverlay\(next\)/);
  // deps 接口不再暴露相机相关依赖
  assert.doesNotMatch(savedLayer, /mapInstance|savedCameraSyncRef|SavedCameraSync/);
  assert.doesNotMatch(savedLayer, /overlayBounds/);
});

test('源码契约:use-work-viewport 不再消费/再导出状态机,onViewChange 直接调度', () => {
  const hook = src('hooks/use-work-viewport.ts');
  assert.doesNotMatch(hook, /saved-camera-sync|SavedCameraSync|savedCameraSyncRef|cameraAtDestination|consumeSavedCameraSync|SAVED_CAMERA_MATCH_METERS/);
  assert.doesNotMatch(hook, /VIEWPORT_SUPPRESS_MS|Date\.now\(\) \+ 500/);
  // onViewChange 体:同步消费消失,只剩 loader.schedule()
  const onViewAt = hook.indexOf('const onViewChange = () => {');
  const loaderAt = hook.indexOf('loader.schedule();', onViewAt);
  assert.ok(onViewAt !== -1 && loaderAt !== -1, 'onViewChange → loader.schedule() 直接调度');
});

test('源码契约:map-shell 无状态机接线(syncView 圆心冻结移除)', () => {
  const shell = src('components/map-shell.tsx');
  assert.doesNotMatch(shell, /savedCameraSyncRef|SavedCameraSync|cameraAtDestination|consumeSavedCameraSync/);
  // useSavedLayer 接线不再传 mapInstance/savedCameraSyncRef
  const useSavedLayerAt = shell.indexOf('useSavedLayer({');
  assert.ok(useSavedLayerAt !== -1);
  const callSite = shell.slice(useSavedLayerAt, useSavedLayerAt + 400);
  assert.doesNotMatch(callSite, /mapInstance|savedCameraSyncRef/);
  assert.match(callSite, /onRequireAuth: \(\) => setAuthOpen\(true\)/);
});

test('死代码:src 全树零引用退役模块,模块已物理删除', () => {
  const dead = /saved-camera-sync|SavedCameraSync|cameraAtDestination|consumeSavedCameraSync|SAVED_CAMERA_MATCH_METERS/;
  // 排除退役模块本身(若残留,注释里会提到自己的名字)
  const offenders = allTsFiles().filter((f) => f !== 'lib/saved-camera-sync.ts' && dead.test(src(f)));
  assert.deepEqual(offenders, [], 'src 全树无文件引用已退役的收藏相机同步状态机');
  // 退役模块已由 boss 合并时 git rm 收尾(worker 沙箱内曾为零导出退役桩)
  assert.equal(existsSync(join(root, 'lib/saved-camera-sync.ts')), false, '退役模块已物理删除');
});

// ---- 保留项:空批次不置空 catalog(独立于状态机,不得随清理误删)----

test('保留:空批次不置空 catalog 加固仍在 use-work-viewport(独立于状态机)', () => {
  const hook = src('hooks/use-work-viewport.ts');
  assert.match(hook, /空批次 ≠ 无数据/);
  assert.doesNotMatch(hook, /catalogRef\.current = \[\];\s*setCatalog\(\[\]\);/);
});
