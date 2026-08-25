// ============================================================
// 收藏图层互斥语义回归测试(ws-1 saved-layer-mutex,2026-08-22)
//
// 用户决策:收藏图层开关从「叠加(并集显示)」改为「互斥」——
// 开 = 地图只显示收藏点 pin + Explore 列表切为收藏列表;
// 关 = 恢复搜索管线(catalog pin + 搜索管线列表)。
//
// 实现分工(jsdom 可测的纯函数层):
// - mergeMapPois 只建 marker「池」:catalog 结果全量保留(池只增不删,
//   关时秒恢复、不触发重查),enabled 时把 catalog 未命中的收藏点快照补入;
// - mutexVisibleIds 在可见性层落地互斥:enabled 时只返回收藏点 id
//   (普通 POI 全部排除,marker 实例保留不销毁),disabled 返回 null 走
//   正常 LOD/聚合可见性。
// 本文件:纯函数行为 + 源码契约(接线点)双覆盖。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import { mergeMapPois, mutexVisibleIds, savedPlacesToOverlay } from '../src/lib/saved-overlay.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const alibaba = INTERNSHIP_SEED.find((item) => item.id === 'alibaba-xixi');
assert.ok(alibaba, 'seed fixture alibaba-xixi must exist');
const netease = INTERNSHIP_SEED.find((item) => item.id && item.id !== 'alibaba-xixi');
assert.ok(netease, 'seed fixture must have a second recruitment POI');

/** map-shell 同构派生:池 = mergeMapPois(pipeline, overlay, enabled) → 可见集 = mutexVisibleIds(池, overlayIds, enabled) */
function deriveMapState(pipeline, overlay, enabled) {
  const pool = mergeMapPois(pipeline, overlay, enabled);
  const overlayIds = new Set(overlay.map((p) => p.id));
  const visible = mutexVisibleIds(pool, overlayIds, enabled);
  return { pool, overlayIds, visible };
}

// ---- mutexVisibleIds:可见性层互斥 ----

test('mutexVisibleIds:开时只返回收藏点 id,普通 POI 全部排除', () => {
  const overlay = savedPlacesToOverlay(
    [{ id: 's1', poiId: alibaba.id, name: '阿里', mode: 'work', kind: 'recruitment', createdAt: '2026-08-16T00:00:00.000Z' }],
    INTERNSHIP_SEED,
    'work',
  );
  const { visible } = deriveMapState([alibaba, netease], overlay, true);
  assert.ok(visible, '开时返回可见 id 集');
  assert.deepEqual(visible, [alibaba.id], '只含收藏点 id(alibaba),普通 POI(netease)被排除');
});

test('mutexVisibleIds:关时返回 null → 调用方走正常 LOD/聚合可见性(catalog 恢复显示)', () => {
  const overlay = savedPlacesToOverlay(
    [{ id: 's1', poiId: alibaba.id, name: '阿里', mode: 'work', kind: 'recruitment', createdAt: '2026-08-16T00:00:00.000Z' }],
    INTERNSHIP_SEED,
    'work',
  );
  const { visible } = deriveMapState([alibaba, netease], overlay, false);
  assert.equal(visible, null, '关时无互斥可见集,恢复管线可见性');
});

test('mutexVisibleIds:已登录无收藏 → 开时空地图([]),且允许开(非 null)', () => {
  const { visible } = deriveMapState([alibaba, netease], [], true);
  assert.deepEqual(visible, [], '无收藏 → 空可见集 = 空地图');
});

test('mutexVisibleIds:可见集 = 池 ∩ overlay(池中不存在的 id 不显示,防御)', () => {
  const overlay = [
    { id: 'extra', kind: 'domain', name: '不在池', mode: 'domain', source: 'api', location: { lng: 120, lat: 30 }, category: '收藏' },
  ];
  // 直接以 raw 池调用(不经 mergeMapPois):overlay id 不在池里 → 不显示
  const overlayIds = new Set(overlay.map((p) => p.id));
  const visible = mutexVisibleIds([alibaba], overlayIds, true);
  assert.deepEqual(visible, [], '可见集是池与 overlay 的交集,池外 id 不显示');
});

// ---- mergeMapPois:marker 池只增不删 ----

test('mergeMapPois:开时池保留 catalog 全量 + 补入未命中的收藏点(池只增不删)', () => {
  const overlay = savedPlacesToOverlay(
    [
      { id: 's1', poiId: alibaba.id, name: '阿里', mode: 'work', kind: 'recruitment', createdAt: '2026-08-16T00:00:00.000Z' },
      { id: 's2', poiId: 'cold-company', name: '冷门公司', mode: 'work', kind: 'recruitment', lng: 120.02, lat: 30.28, createdAt: '2026-08-16T00:00:00.000Z' },
    ],
    INTERNSHIP_SEED,
    'work',
  );
  const pool = mergeMapPois([alibaba, netease], overlay, true);
  const ids = new Set(pool.map((p) => p.id));
  assert.ok(ids.has(alibaba.id) && ids.has(netease.id), 'catalog 结果全量保留(关时秒恢复,不重查)');
  assert.ok(ids.has('cold-company'), 'catalog 未命中的收藏点快照补入池(实例保留)');
  assert.equal(pool.length, 3, '池 = 结果 + 未命中收藏点,不重复(alibaba 去重)');
});

test('mergeMapPois:关时池回到 catalog 本体(不混入收藏快照)', () => {
  const overlay = savedPlacesToOverlay(
    [{ id: 's2', poiId: 'cold-company', name: '冷门公司', mode: 'work', kind: 'recruitment', lng: 120.02, lat: 30.28, createdAt: '2026-08-16T00:00:00.000Z' }],
    INTERNSHIP_SEED,
    'work',
  );
  const pool = mergeMapPois([alibaba], overlay, false);
  assert.deepEqual(pool.map((p) => p.id), [alibaba.id], '关时只含 catalog 结果');
});

// ---- 完整互斥流(开→关):派生链纯函数,无 fetch 参与 ----

test('互斥流:开 = 地图只含收藏点;关 = 恢复 catalog 管线(派生零重查)', () => {
  const pipeline = [alibaba, netease];
  const overlay = savedPlacesToOverlay(
    [{ id: 's1', poiId: alibaba.id, name: '阿里', mode: 'work', kind: 'recruitment', createdAt: '2026-08-16T00:00:00.000Z' }],
    INTERNSHIP_SEED,
    'work',
  );
  // 开:savedOverlay && user → enabled
  const on = deriveMapState(pipeline, overlay, true);
  assert.deepEqual(on.visible, [alibaba.id], '开 → 地图只显示收藏点 pin');
  assert.deepEqual(
    on.pool.map((p) => p.id).sort(),
    [alibaba.id, netease.id].sort(),
    '池保留 catalog 全量(普通 pin 隐藏而非销毁)',
  );
  // 关:enabled=false → 可见集恢复管线路径(null → LOD 正常显示)
  const off = deriveMapState(pipeline, overlay, false);
  assert.equal(off.visible, null, '关 → 恢复 toggle 前的可见性逻辑');
  assert.deepEqual(off.pool.map((p) => p.id), [alibaba.id, netease.id], '关 → 池 = catalog 本体');
  // 全程无 fetch:派生只读内存态(pipeline/overlay),切换不触发网络请求
});

// ---- 源码契约:接线点 ----

test('map-shell:互斥接线(池不变 + 可见性互斥 + 聚合/列表互斥)', () => {
  const shell = src('components/map-shell.tsx');
  // 互斥开关 = savedOverlay && user(未登录保持现有门控)
  assert.match(shell, /const savedLayerEnabled = savedOverlay && Boolean\(user\);/);
  // 可见性层落地:池保留(2026-08-25 f-lod-pool 后 domain 池 = catalog 原始全量
  // 目录,work 池 = 管线输出;均不经 replace 销毁筛选出的 marker),只显示收藏点
  // 由 mutexVisibleIds 决定
  assert.match(shell, /mergeMapPois\(catalog, overlayPois, savedOverlay && Boolean\(user\)\)/);
  assert.match(shell, /mutexVisibleIds\(markerPois, overlayIds, savedLayerEnabled\)/);
  // 聚合(work zoom ≤ 8)互斥:互斥开时按收藏点聚合,徽章不混入 catalog 公司
  assert.match(shell, /const source = savedLayerEnabled \? overlayPois : markerPois;/);
  // 桌面 Explore 列表互斥:SecondarySidebar 收 savedMode 接线
  assert.match(shell, /savedMode=\{savedLayerEnabled\}/);
  assert.match(shell, /onPickSaved=\{handlePickSaved\}/);
  // 移动抽屉列表互斥(2026-08-22 卡片化):互斥开时 Explore sheet 切 POIList 卡片
  assert.match(shell, /收藏图层互斥开:移动 Explore 列表切为收藏卡片列表/);
  assert.match(shell, /<POIList\s+pois=\{savedListPois\}/);
  // 卡片右上「移除收藏」:POIList 收 onRemove(poiId 适配)
  assert.match(shell, /onRemove=\{user \? \(poi\) => handleRemoveSaved\(poi\.id\) : undefined\}/);
});

test('secondary-sidebar:互斥开时列表区切收藏卡片列表(POIList),关时恢复 POIList', () => {
  const sidebar = src('components/secondary-sidebar.tsx');
  assert.match(sidebar, /savedMode\?: boolean/);
  assert.match(sidebar, /savedItems\?: SavedPlace\[\]/);
  assert.match(sidebar, /onPickSaved\?: \(place: SavedPlace\) => void/);
  assert.match(sidebar, /savedMode \? \(\s*\/\* 收藏图层互斥开:列表区切换为收藏卡片列表/);
  assert.match(sidebar, /<POIList\s+pois=\{savedListPois\}/);
  // 不再消费 SavedList(对比表保留在账户页):动态导入与 JSX 渲染已移除
  assert.doesNotMatch(sidebar, /const SavedList = dynamic/);
  assert.doesNotMatch(sidebar, /<SavedList/);
});

test('saved-overlay:契约注释更新为互斥语义 + mutexVisibleIds 导出', () => {
  const lib = src('lib/saved-overlay.ts');
  assert.match(lib, /互斥语义/);
  assert.match(lib, /export function mutexVisibleIds\(/);
  // 旧「搜索列表仍只走 catalog 管线」的叠加声明已移除(契约修正)
  assert.doesNotMatch(lib, /搜索列表仍只走 catalog 管线/);
});
