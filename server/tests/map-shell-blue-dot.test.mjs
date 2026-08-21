// 非 AMap 引擎用户定位蓝点(ws-d,2026-08-22,fix/geolocation-blue-dot)
//
// bug 5「腾讯地图之类连用户定位点都消失了」:定位蓝点此前是 AMap 专属路径
// (amap-api Geolocation 控件),腾讯/百度引擎只定位不渲染蓝点。
// 修复:非 AMap 引擎定位成功后经契约 view.createMarker({ position, icon:
// { src: dataURL, size } }) 自绘蓝点,setPosition 跟随更新,remove 清理;
// AMap 路径零改动。
//
// map-shell.tsx 是 TSX(JSX),node --test 无法 import → 沿用仓库既有
// 源码契约断言风格(component-contracts / filter-unicorn-regression),
// 对「mock 行为」的等价断言落到:createMarker 调用形状(icon src 为
// dataURL/zIndex 高于 POI)、setPosition/remove 调用、amap 门控早退、
// 挂载/定位按钮两处接线、与 POI 控制器(聚合/LOD)隔离。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const shell = src('components/map-shell.tsx');

/** 提取 syncUserBlueDot 函数体(截至下一个顶层函数声明/组件结束的最近锚点) */
function blueDotFn() {
  const start = shell.indexOf('function syncUserBlueDot');
  assert.ok(start >= 0, 'syncUserBlueDot 存在');
  // 函数体到 createMap 声明为止(两者相邻,见实现)
  const end = shell.indexOf('function createMap', start);
  assert.ok(end > start, 'syncUserBlueDot 后紧跟 createMap');
  return shell.slice(start, end);
}

test('蓝点图标:内联 SVG dataURL,圆点 #007AFF 系 + 晕圈 + 白心,尺寸 22x22', () => {
  const region = shell.slice(shell.indexOf('const USER_BLUE_DOT_ICON'), shell.indexOf('const USER_BLUE_DOT_Z_INDEX'));
  const m = region.match(/src: "((?:data:image\/svg\+xml,)[^"]+)"/);
  assert.ok(m, 'USER_BLUE_DOT_ICON 含 dataURL src');
  assert.match(m[1], /^data:image\/svg\+xml,%3Csvg/);
  // 解码 URL 编码的 SVG,验证圆点结构
  const svg = decodeURIComponent(m[1].slice('data:image/svg+xml,'.length));
  assert.match(svg, /width='22' height='22' viewBox='0 0 22 22'/);
  // 晕圈(半透明)+ 实心蓝点 + 白心,全部 #007AFF(项目 UI 蓝,非旧 #4A90E2)
  assert.match(svg, /r='9' fill='#007AFF' opacity='0\.25'/);
  assert.match(svg, /r='5' fill='#007AFF'/);
  assert.match(svg, /r='2' fill='white'/);
  assert.doesNotMatch(region, /4A90E2/, '蓝点不用旧主题色 #4A90E2');
  assert.match(region, /size: \[22, 22\]/);
});

test('契约:非 AMap 定位成功后 createMarker 创建蓝点(icon src = dataURL + zIndex 高于 POI)', () => {
  const fn = blueDotFn();
  // amap 早退先于 createMarker —— 蓝点只走非 AMap 引擎
  assert.match(fn, /if \(view\.engine\.id === "amap"\) return;/);
  assert.ok(fn.indexOf('createMarker') > fn.indexOf('"amap"'), 'createMarker 在 amap 门控之后');
  // 契约调用形状:position + icon(src/size) + zIndex
  const call = fn.slice(fn.indexOf('view.createMarker'), fn.indexOf('view.createMarker') + 260);
  assert.match(call, /position: \{ lng, lat \}/);
  assert.match(call, /icon: USER_BLUE_DOT_ICON/);
  assert.match(call, /zIndex: USER_BLUE_DOT_Z_INDEX/);
  // zIndex 200 > POI marker 最高 100(选中)与聚合徽章 50 —— 蓝点恒在最上
  assert.match(shell, /const USER_BLUE_DOT_Z_INDEX = 200;/);
  const markers = src('lib/map-markers.ts');
  assert.match(markers, /if \(state === 'selected'\) return 100;/);
  assert.match(markers, /zIndex: 50,/);
});

test('生命周期:已有蓝点 setPosition 跟随更新;清理 remove + 置空 ref', () => {
  const fn = blueDotFn();
  assert.match(fn, /marker\.setPosition\(\{ lng, lat \}\)/);
  assert.match(fn, /blueDotRef\.current = view\.createMarker/);
  // 卸载/切引擎:createMap cleanup 摘除蓝点(remove 走契约包装,引擎侧
  // TMap setMap(null) / BMapGL removeOverlay 均由适配层吸收)
  const cleanup = shell.slice(shell.indexOf('const cleanup = () => {'));
  assert.match(cleanup, /blueDotRef\.current\?\.remove\?\.\(\);/);
  assert.match(cleanup, /blueDotRef\.current = null;/);
  // 视图已销毁(StrictMode double-invoke/切引擎竞态)不建点
  assert.match(fn, /view\.isDestroyed\?\.\(\)/);
});

test('接线:挂载定位 settle 与定位按钮 handleLocate 都同步蓝点', () => {
  // 挂载路径:createMap 的 locateForMap .then 内,setUserLocation 后同步蓝点
  const mountBlock = shell.slice(shell.indexOf('function createMap'), shell.indexOf('function createMap') + 1200);
  assert.match(mountBlock, /setUserLocation\(\{ lng, lat \}\);/);
  assert.match(mountBlock, /syncUserBlueDot\(view, lng, lat\);/);
  // 定位按钮路径:handleLocate 定位成功后同样同步(先蓝点后移相机)
  const locate = shell.slice(shell.indexOf('const handleLocate'), shell.indexOf('const handleLocate') + 1300);
  assert.match(locate, /locateForMap\(mapInstance\.current\)/);
  const iSync = locate.indexOf('syncUserBlueDot(mapInstance.current, lng, lat)');
  const iCenter = locate.indexOf('setCenter');
  assert.ok(iSync >= 0 && iCenter > iSync, 'handleLocate 先同步蓝点再移相机');
});

test('AMap 路径零变化:locateForMap amap 分支仍走 Geolocation 控件,蓝点函数对 amap 早退', () => {
  // 定位分派:amap → getCurrentPosition(view.raw)(amap-api Geolocation 控件,
  // 蓝点+精度圈绑定原始实例);非 amap → 引擎 search 纯定位
  const locateFn = shell.slice(shell.indexOf('function locateForMap'), shell.indexOf('function locateForMap') + 600);
  assert.match(locateFn, /view\.engine\.id === "amap"/);
  assert.match(locateFn, /getCurrentPosition\(view\.raw\)/);
  assert.match(locateFn, /view\.engine\.search\.getCurrentPosition\(\)/);
  // syncUserBlueDot 对 amap 直接 return,不 createMarker(AMap 蓝点由控件渲染)
  const fn = blueDotFn();
  assert.doesNotMatch(fn.slice(0, fn.indexOf('createMarker')), /createMarker/, 'amap 早退前无 createMarker');
  // amap-api 不动:蓝点能力仍只在 amap-api(Geolocation 控件)
  const amapApi = src('lib/amap-api.ts');
  assert.match(amapApi, /AMap\.Geolocation/);
});

test('共存:蓝点是独立 marker,不参与 POI 控制器(LOD/聚合不误删)', () => {
  const fn = blueDotFn();
  // 蓝点经 view.createMarker 直建并只记入 blueDotRef,不经 POI 控制器
  assert.doesNotMatch(fn, /usePOIMap|poiController|addMarker\(/);
  assert.match(fn, /blueDotRef\.current/);
  // POI 控制器(聚合/LOD 所在)完全不感知蓝点:map-markers 零处 blueDot
  const markers = src('lib/map-markers.ts');
  assert.doesNotMatch(markers, /blueDot|BlueDot/);
});
