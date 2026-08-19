import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ---- 首点补放(w2):首次点击公司 POI 不吞相机意图 ----
// 根因(2026-08-20 插桩实测):geoSettled 门控在 geolocation 落地前直接 return,
// 首次点击的 flyTo 被静默丢弃,相机停在杭州初始中心;geolocation 晚 resolve 又被
// hasInteractedRef 拦住补飞 → 第二次点击 geoSettled=true 才正常。
// 契约:门控仍在,命中时改为「暂存目标 poi + return」;geolocation settle 后
// (setGeoSettled(true) 之后)补执行一次 flyToLocation 并清空 ref。

test('pendingFlyToRef declared right after hasInteractedRef (same region)', () => {
  const shell = src('components/map-shell.tsx');
  assert.match(
    shell,
    /const hasInteractedRef = useRef\(false\);\s*\/\*\* 首点补放[\s\S]*?\*\/\s*const pendingFlyToRef = useRef<POI \| null>\(null\);/
  );
});

test('handleSelect gate hit records poi into pendingFlyToRef instead of bare return', () => {
  const shell = src('components/map-shell.tsx');
  const seg =
    shell.match(/const handleSelect = useCallback\(\(poi: POI\) => \{[\s\S]*?\}, \[mapReady, geoSettled\]\);/)
      ?.[0] ?? '';
  assert.ok(seg.length > 0, 'handleSelect block exists');
  // 交互语义不变:选中即「用户已接管相机」
  assert.match(seg, /hasInteractedRef\.current = true;/);
  // 门控仍在,但命中时暂存 poi
  assert.match(seg, /if \(!mapReady \|\| !geoSettled\) \{\s*pendingFlyToRef\.current = poi;/);
  assert.match(seg, /return;/);
});

test('onOpenDetail gate hit records poi into pendingFlyToRef instead of bare return', () => {
  const shell = src('components/map-shell.tsx');
  const seg = shell.match(/onOpenDetail=\{\(poi\) => \{[\s\S]*?\}\}/)?.[0] ?? '';
  assert.ok(seg.length > 0, 'onOpenDetail block exists');
  assert.match(seg, /hasInteractedRef\.current = true;/);
  assert.match(seg, /if \(!mapReady \|\| !geoSettled\) \{\s*pendingFlyToRef\.current = poi;/);
  assert.match(seg, /return;/);
  // settle 后的正常路径(设计语义)保留:开门详情 + 立即飞
  assert.match(seg, /setDetailPoi\(poi\);\s*if \(poi\.location\) flyToLocation\(mapInstance\.current, poi\.location\.lng, poi\.location\.lat\);/);
});

test('geolocation settle replays pending flyTo after setGeoSettled(true) and clears ref', () => {
  const shell = src('components/map-shell.tsx');
  const seg = shell.match(/const settleGeolocation = \(\) => \{[\s\S]*?\};/)?.[0] ?? '';
  assert.ok(seg.length > 0, 'settleGeolocation helper exists');
  // 必须先 setGeoSettled(true):视口 loader 以 geoSettled 自守卫,提前飞会被吞
  assert.match(seg, /const settleGeolocation = \(\) => \{\s*setGeoSettled\(true\);/);
  assert.match(seg, /const pending = pendingFlyToRef\.current;/);
  assert.match(seg, /if \(pending\) \{\s*pendingFlyToRef\.current = null;/);
  assert.match(seg, /if \(pending\.location\) \{\s*flyToLocation\(mapInstance\.current, pending\.location\.lng, pending\.location\.lat\);/);
});

test('all three geolocation exits (!loc / success / error) settle via settleGeolocation', () => {
  const shell = src('components/map-shell.tsx');
  // !loc 分支
  assert.match(shell, /if \(!loc\) \{\s*settleGeolocation\(\);/);
  // 成功分支:settle 在 hasInteractedRef 相机门控块之后(已交互 → 不 setCenter,只补飞)
  assert.match(
    shell,
    /if \(!hasInteractedRef\.current\) \{[\s\S]*?setMapCenter\(\{ lng, lat \}\);\s*\}\s*settleGeolocation\(\);/
  );
  // 失败分支
  assert.match(shell, /\.catch\(\(\) => \{\s*settleGeolocation\(\);/);
});

test('hasInteractedRef semantics untouched: set once, never reset (ws-a contract)', () => {
  const shell = src('components/map-shell.tsx');
  assert.doesNotMatch(shell, /hasInteractedRef\.current = false/);
});
