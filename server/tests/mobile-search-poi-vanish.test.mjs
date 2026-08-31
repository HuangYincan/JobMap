// ============================================================
// 手机搜索框 + 全国视野 POI 同时消失(2026-08-31 真机 jobmap.nvc.ac)
//
// 症状:安卓 Chrome 底栏只剩一条把手,搜索/工具栏/列表都不在;地图 50km
// 珠三角视野上也没有公司 pin 或城市聚合徽章。
//
// 两条独立根因叠在同一屏:
// 1. 抽屉 chrome:mini + 非 explore sheet 不渲染搜索,工具栏/内容被 CSS 藏掉;
//    拖到浏览器底栏松手时 pointerup 丢失,inline height 卡在半屏。
// 2. 聚合:zoom≤8 藏个体 pin;AMap 3D 安卓上 HTML Marker 经常不画;即便画了,
//    hide() 仍留在 LabelsLayer 上的公司点会把深圳/广州徽章吃掉。zoomend 不
//    写 realZoom 时 pinch 还可能根本不进聚合。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sheetAfterDrawerSnap,
  shouldShowMobileSearch,
} from '../src/lib/mobile-drawer-chrome.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

test('mini drawer still shows search when the sheet is layers/agent/recent/account', () => {
  assert.equal(shouldShowMobileSearch('explore', 'mini'), true);
  assert.equal(shouldShowMobileSearch('explore', 'half'), true);
  assert.equal(shouldShowMobileSearch('layers', 'full'), false);
  assert.equal(shouldShowMobileSearch('agent', 'half'), false);
  assert.equal(shouldShowMobileSearch('layers', 'mini'), true, 'mini chrome must keep the search box');
  assert.equal(shouldShowMobileSearch('agent', 'mini'), true);
  assert.equal(shouldShowMobileSearch('recent', 'mini'), true);
  assert.equal(shouldShowMobileSearch('account', 'mini'), true);
});

test('snapping the drawer to mini returns the sheet to explore', () => {
  assert.equal(sheetAfterDrawerSnap('layers', 'mini'), 'explore');
  assert.equal(sheetAfterDrawerSnap('agent', 'mini'), 'explore');
  assert.equal(sheetAfterDrawerSnap('recent', 'mini'), 'explore');
  assert.equal(sheetAfterDrawerSnap('account', 'mini'), 'explore');
  assert.equal(sheetAfterDrawerSnap('layers', 'half'), 'layers');
  assert.equal(sheetAfterDrawerSnap('explore', 'mini'), 'explore');
});

test('map-shell wires search chrome and mini-snap helpers', () => {
  const shell = src('components/map-shell.tsx');
  const gesture = src('hooks/use-mobile-drawer-gesture.ts');
  assert.match(shell, /shouldShowMobileSearch\(mobileSheet, drawer\)/);
  assert.match(gesture, /sheetAfterDrawerSnap\(/);
  assert.match(gesture, /handleDrawerLostPointerCapture/);
  assert.match(shell, /onLostPointerCapture=\{handleDrawerLostPointerCapture\}/);
  assert.match(gesture, /addEventListener\("pointerup"/);
});

test('zoomend syncView copies live zoom so cluster mode cannot stay stale after pinch', () => {
  const shell = src('components/map-shell.tsx');
  const syncAt = shell.indexOf('const syncView = () => {');
  assert.ok(syncAt >= 0, 'syncView exists');
  const sync = shell.slice(syncAt, shell.indexOf('const offMoveEnd', syncAt));
  assert.match(sync, /setRealZoom\(state\.zoom\)/);
  assert.match(sync, /setZoom\(Math\.round\(state\.zoom\)\)/);
});

test('AMap cluster badges use a separate LabelsLayer so hidden company pins cannot eat them', () => {
  const engine = src('lib/map-engine/amap/amap-engine.ts');
  const markers = src('lib/map-markers.ts');
  assert.match(engine, /clusterLabelsLayer/);
  assert.match(engine, /ensureClusterLabelsLayer/);
  assert.match(markers, /clusterLayer/);
  assert.match(
    markers,
    /view\.engine\?\.id === 'tencent' \|\| view\.engine\?\.id === 'amap'/,
  );
});

test('AMap LabelMarker setVisible(false) removes the pin from the company layer', () => {
  const engine = src('lib/map-engine/amap/amap-engine.ts');
  const createAt = engine.indexOf('private createLabelMarker');
  const setVisibleAt = engine.indexOf('setVisible: (v: boolean) => {', createAt);
  assert.ok(createAt >= 0 && setVisibleAt >= 0, 'LabelMarker setVisible exists');
  const block = engine.slice(setVisibleAt, setVisibleAt + 900);
  assert.match(block, /layer\.remove\(marker\)/);
  assert.match(block, /layer\.add\(marker\)/);
});

test('mobile drawer backdrop-filter is on ::before so Android WebGL does not eat children', () => {
  const css = src('components/map-shell.module.css');
  const mobileAt = css.lastIndexOf('@media (max-width: 767px) {');
  assert.ok(mobileAt >= 0);
  const mobile = css.slice(mobileAt);
  const drawerAt = mobile.indexOf('\n  .mobileDrawer {');
  const drawerEnd = mobile.indexOf('\n  }', drawerAt);
  const drawer = mobile.slice(drawerAt, drawerEnd + 4);
  assert.doesNotMatch(drawer, /backdrop-filter:/);
  assert.match(mobile, /\.mobileDrawer::before \{[\s\S]*backdrop-filter:/);
  assert.match(css, /@media \(max-width: 767px\) \{\s*\.shell \{\s*min-height:\s*0;/);
});
