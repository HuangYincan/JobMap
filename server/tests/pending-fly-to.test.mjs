import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ---- 首点不再被 geolocation 门控(2026-08-20 修复)----
// 根因(w2 残留):geoSettled 门控命中时 handleSelect/onOpenDetail 只暂存
// pendingFlyToRef 并 return,setSelectedId/setDetailPoi 被挡——首点无选中
// 反馈、数据与相机都要等 geolocation settle,表现为「首点刷新地图 + 视角
// 回杭州」。修复:初始加载以 mapReady 为门(全量加载,数据在定位前就绪),
// 首点点击链不再有任何门控,与后续点击行为完全一致;pendingFlyToRef 删除。
// 契约:首点三条点击链(卡片选中/详情打开/移动列表)均无 geoSettled 判断。

test('handleSelect 无门控:始终 setSelectedId(首点 = 后续点击)', () => {
  const shell = src('components/map-shell.tsx');
  const seg =
    shell.match(/const handleSelect = useCallback\(\(poi: POI\) => \{[\s\S]*?\}, \[\]\);/)
      ?.[0] ?? '';
  assert.ok(seg.length > 0, 'handleSelect block exists');
  // 卡片/列表选中不动相机:不置 userMovedMapRef(ws-poi-vanish 首点修复,
  // 选择公司 ≠ 放弃定位,geolocation settle 仍会飞用户位置)
  assert.doesNotMatch(seg, /userMovedMapRef\.current = true/);
  // 无 geoSettled / mapReady 门控,无 pendingFlyToRef
  assert.doesNotMatch(seg, /if \(!mapReady \|\| !geoSettled\)|pendingFlyToRef/);
  assert.match(seg, /setSelectedId\(poi\.id\);/);
});

test('onOpenDetail 无门控:立即 setDetailPoi + flyToLocation', () => {
  const shell = src('components/map-shell.tsx');
  const seg = shell.match(/onOpenDetail=\{\(poi\) => \{[\s\S]*?\}\}/)?.[0] ?? '';
  assert.ok(seg.length > 0, 'onOpenDetail block exists');
  // 会 flyTo 的入口置 userMovedMapRef(与地图手势同口径)
  assert.match(seg, /userMovedMapRef\.current = true;/);
  assert.doesNotMatch(seg, /if \(!mapReady \|\| !geoSettled\)|pendingFlyToRef/);
  assert.match(seg, /setDetailPoi\(poi\);/);
  assert.match(seg, /if \(poi\.location\) flyToLocation\(mapInstance\.current, poi\.location\.lng, poi\.location\.lat\);/);
});

test('pendingFlyToRef 机制整体删除:settleGeolocation 只置 geoSettled', () => {
  const shell = src('components/map-shell.tsx');
  assert.doesNotMatch(shell, /pendingFlyToRef/);
  const seg = shell.match(/const settleGeolocation = \(\) => \{[\s\S]*?\};/)?.[0] ?? '';
  assert.ok(seg.length > 0, 'settleGeolocation helper exists');
  assert.match(seg, /const settleGeolocation = \(\) => \{\s*setGeoSettled\(true\);/);
  assert.doesNotMatch(seg, /flyToLocation|pending/);
});

test('all three geolocation exits (!loc / success / error) settle via settleGeolocation', () => {
  const shell = src('components/map-shell.tsx');
  // !loc 分支
  assert.match(shell, /if \(!loc\) \{\s*settleGeolocation\(\);/);
  // 成功分支:settle 在 userMovedMapRef+默认中心 双门控块之后(已移图/恢复视野 → 不 setCenter)
  assert.match(
    shell,
    /if \(!userMovedMapRef\.current && isNearDefaultCenter\([\s\S]*?setMapCenter\(\{ lng, lat \}\);\s*\}\s*settleGeolocation\(\);/
  );
  // 失败分支
  assert.match(shell, /\.catch\(\(\) => \{\s*settleGeolocation\(\);/);
});

test('初始加载不被 geolocation 门控:load() 只以 mapReady 为门', () => {
  const shell = src('components/map-shell.tsx');
  const seg = shell.match(/async function load\(\) \{[\s\S]*?\n    \}/)?.[0] ?? '';
  assert.ok(seg.length > 0, 'load function exists');
  assert.doesNotMatch(seg, /geoSettled/);
});

test('userMovedMapRef semantics untouched: set once, never reset (ws-a contract)', () => {
  const shell = src('components/map-shell.tsx');
  assert.doesNotMatch(shell, /userMovedMapRef\.current = false/);
});
