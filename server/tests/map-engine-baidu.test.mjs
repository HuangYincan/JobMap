// ============================================================
// 百度地图 GL(BMapGL)引擎适配层测试 — map-engine-baidu(ws-e)
//
// 核心:bd09 边界转换钉住(漏转 ≈700m 偏移):
//   - 入参 gcj02 → 厂商侧收到 gcj02ToBd09 的结果(同一纯函数,精确相等)
//   - 出参厂商 bd09 → 返回 gcj02(往返自洽 ±1e-5)
//   - 相机闭环:setCenter(gcj02) → getState(gcj02) 回到同一坐标
//
// 固定点位:天安门 gcj02 (116.397428, 39.90923) → 百度官方公式 bd09
//   (116.4038005645, 39.9155730161)。
//   ⚠️ 网传对照点 bd09 (116.403963, 39.915119) 与公式差 ~4.5e-4(ws-b 实测,
//   本 WS 复核 dlng=1.62e-4 / dlat=-4.54e-4)——**不用网传值做固定点位断言**。
//
// 测试基建:installEngineMock 装到 BMapGL namespace(coordSystem:'bd09'),
// 再以测试内「忠实厂商双面」(BMapGL 形状的 Point/Size/Bounds/Map/Marker/
// Circle/PlaceSearch/Geocoder/Geolocation/Autocomplete/ScaleControl + 全局
// BMAPGL_* 常量)覆盖,让适配器走真实 vendor API 命名、断言厂商侧收到的
// 确切形状。未改动共享 fixture(engine-mock.mjs)。
// ============================================================

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installEngineMock } from './fixtures/engine-mock.mjs';
import { resetScriptLoader } from '../src/lib/map-engine/script-loader.ts';
import { gcj02ToBd09, bd09ToGcj02 } from '../src/lib/map-engine/coord-utils.ts';
import {
  BAIDU_NAMESPACE,
  createBaiduEngine,
} from '../src/lib/map-engine/baidu/baidu-engine.ts';

const KEY_VAR = 'NEXT_PUBLIC_BAIDU_AK';
const EPS = 1e-5;

/** 固定点位:天安门 gcj02(公式 bd09 见 T21;勿用网传值) */
const GCJ = { lng: 116.397428, lat: 39.90923 };

function approx(actual, expected, label, eps = EPS) {
  assert.ok(
    Math.abs(actual.lng - expected.lng) <= eps && Math.abs(actual.lat - expected.lat) <= eps,
    `${label}: got (${actual.lng}, ${actual.lat}), want ≈(${expected.lng}, ${expected.lat})`,
  );
}

/** 设 env 并返回还原函数(try/finally 还原) */
function setEnv(name, value) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  };
}

// ------------------------------------------------------------
// BMapGL 形状的厂商双面(记录厂商侧收到的确切参数)
// ------------------------------------------------------------

class FakePoint {
  constructor(lng, lat) {
    this.lng = lng;
    this.lat = lat;
  }
}

class FakeSize {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}

class FakeBounds {
  constructor(southWest, northEast) {
    this.sw = southWest;
    this.ne = northEast;
  }
  getSouthWest() {
    return this.sw;
  }
  getNorthEast() {
    return this.ne;
  }
}

class FakeMap {
  constructor(container) {
    this.container = container;
    this.center = null;
    this.zoom = null;
    this.tilt = 0;
    this.heading = 0;
    this.mapType = null;
    this.bounds = null;
    this.boundsArg = null;
    this.overlays = [];
    this.controls = [];
    this.listeners = new Map();
    this.destroyed = false;
    this.panned = false;
    this.raw = this; // 逃生舱:mock 自身即 raw 实例
  }
  centerAndZoom(center, zoom) {
    this.center = center;
    this.zoom = zoom;
  }
  setCenter(center) {
    this.center = center;
  }
  setZoom(zoom) {
    this.zoom = zoom;
  }
  setTilt(tilt) {
    this.tilt = tilt;
  }
  setHeading(heading) {
    this.heading = heading;
  }
  panTo(center) {
    this.center = center;
    this.panned = true;
  }
  setBounds(bounds) {
    this.boundsArg = bounds;
  }
  setMapType(mapType) {
    this.mapType = mapType;
  }
  getCenter() {
    return this.center;
  }
  getZoom() {
    return this.zoom;
  }
  getTilt() {
    return this.tilt;
  }
  getHeading() {
    return this.heading;
  }
  getBounds() {
    return this.bounds;
  }
  addOverlay(overlay) {
    this.overlays.push(overlay);
  }
  removeOverlay(overlay) {
    this.overlays = this.overlays.filter((o) => o !== overlay);
  }
  addControl(control) {
    this.controls.push(control);
  }
  addEventListener(event, handler) {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }
  removeEventListener(event, handler) {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, list.filter((h) => h !== handler));
  }
  trigger(event, payload) {
    for (const h of this.listeners.get(event) ?? []) h(payload);
  }
  destroy() {
    this.destroyed = true;
  }
}

class FakeMarker {
  constructor(point, opts = {}) {
    this.point = point;
    this.opts = opts;
    this.content = null;
    this.listeners = new Map();
    this.removed = false;
  }
  getPosition() {
    return this.point;
  }
  setPosition(point) {
    this.point = point;
  }
  setContent(html) {
    this.content = html;
  }
  addEventListener(event, cb) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }
  trigger(event) {
    for (const cb of this.listeners.get(event) ?? []) cb();
  }
  remove() {
    this.removed = true;
  }
}

class FakeCircle {
  constructor(center, radius, opts = {}) {
    this.center = center;
    this.radius = radius;
    this.opts = opts;
    this.removed = false;
  }
  remove() {
    this.removed = true;
  }
}

class FakeScaleControl {
  constructor() {
    this.scale = true;
  }
}

const emptyPlaceResult = { getCurrentNumPois: () => 0, getPoi: () => null };

class FakePlaceSearch {
  constructor(opts) {
    this.opts = opts;
    this.lastSearch = null;
    this.lastNearby = null;
    captures.places.push(this);
  }
  search(keyword) {
    this.lastSearch = keyword;
    this.opts.onSearchComplete?.(FakePlaceSearch.result ?? emptyPlaceResult);
  }
  searchNearby(keyword, center, radius) {
    this.lastNearby = { keyword, center, radius };
    this.opts.onSearchComplete?.(FakePlaceSearch.result ?? emptyPlaceResult);
  }
}

class FakeGeocoder {
  constructor() {
    this.lastCall = null;
    captures.geocoders.push(this);
  }
  getPoint(address, callback, city) {
    this.lastCall = { address, callback, city };
    callback(FakeGeocoder.result ?? null);
  }
}

class FakeGeolocation {
  constructor() {
    captures.geolocations.push(this);
  }
  getCurrentPosition(callback) {
    callback(FakeGeolocation.result ?? null);
  }
}

class FakeAutocomplete {
  constructor(opts) {
    this.opts = opts;
    this.lastSearch = null;
    captures.autocompletes.push(this);
  }
  search(keyword) {
    this.lastSearch = keyword;
    this.opts.onSearchComplete?.(FakeAutocomplete.result ?? { getValues: () => [] });
  }
}

/** 捕获各服务构造的实例(重置于 setup) */
const captures = {
  places: [],
  geocoders: [],
  geolocations: [],
  autocompletes: [],
};

let mockNs = null;

/** 安装 BMapGL namespace(installEngineMock 外壳 + 厂商双面覆盖) */
function setup() {
  for (const key of Object.keys(captures)) captures[key].length = 0;
  FakePlaceSearch.result = undefined;
  FakeGeocoder.result = undefined;
  FakeGeolocation.result = undefined;
  FakeAutocomplete.result = undefined;
  mockNs = installEngineMock(BAIDU_NAMESPACE, { coordSystem: 'bd09' });
  Object.assign(mockNs.ns, {
    Point: FakePoint,
    Size: FakeSize,
    Bounds: FakeBounds,
    Map: FakeMap,
    Marker: FakeMarker,
    Circle: FakeCircle,
    PlaceSearch: FakePlaceSearch,
    Geocoder: FakeGeocoder,
    Geolocation: FakeGeolocation,
    ScaleControl: FakeScaleControl,
  });
  globalThis.BMAPGL_NORMAL_MAP = 'BMAPGL_NORMAL_MAP';
  globalThis.BMAPGL_SATELLITE_MAP = 'BMAPGL_SATELLITE_MAP';
  return mockNs;
}

afterEach(() => {
  if (mockNs) mockNs.uninstall();
  delete globalThis.BMAPGL_NORMAL_MAP;
  delete globalThis.BMAPGL_SATELLITE_MAP;
  mockNs = null;
});

async function makeView(extra = {}) {
  const e = createBaiduEngine();
  const view = await e.createView({
    container: {},
    center: GCJ,
    zoom: 12,
    style: 'normal',
    ...extra,
  });
  return { e, view };
}

// ------------------------------------------------------------
// 1. 描述 / isConfigured / isLoaded
// ------------------------------------------------------------

test('引擎描述:id/label/namespace/coordSystem bd09/keyVar/search', () => {
  const e = createBaiduEngine();
  assert.equal(e.id, 'baidu');
  assert.equal(e.label, '百度地图');
  assert.equal(e.namespace, 'BMapGL');
  assert.equal(e.coordSystem, 'bd09');
  assert.equal(e.keyVar, 'NEXT_PUBLIC_BAIDU_AK');
  assert.equal(typeof e.search.searchPOI, 'function');
  assert.equal(typeof e.search.fetchSuggestions, 'function');
  assert.equal(typeof e.search.getCurrentPosition, 'function');
  assert.equal(typeof e.search.geocodeAddress, 'function');
});

test('isConfigured:env 开关(空/空白/有效/前后空白)', () => {
  const e = createBaiduEngine();
  const r1 = setEnv(KEY_VAR, undefined);
  assert.equal(e.isConfigured(), false);
  r1();
  const r2 = setEnv(KEY_VAR, '   ');
  assert.equal(e.isConfigured(), false);
  r2();
  const r3 = setEnv(KEY_VAR, 'test-key');
  assert.equal(e.isConfigured(), true);
  r3();
  const r4 = setEnv(KEY_VAR, '  test-key  ');
  assert.equal(e.isConfigured(), true);
  r4();
});

test('isLoaded:namespace 安装后 true / 摘除后 false', () => {
  const e = createBaiduEngine();
  assert.equal(e.isLoaded(), false);
  setup();
  assert.equal(e.isLoaded(), true);
});

// ------------------------------------------------------------
// 2. load:脚本 URL / 幂等 / 失败清理
// ------------------------------------------------------------

test('load:key 缺失 → 明确报错', async () => {
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, undefined);
  try {
    await assert.rejects(e.load(), /NEXT_PUBLIC_BAIDU_AK/);
  } finally {
    restore();
  }
});

test('load:有 key 但非浏览器 → script-loader 拒绝', async () => {
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  try {
    await assert.rejects(e.load(), /only available in the browser/);
  } finally {
    restore();
  }
});

test('load:真实脚本 URL + onload 就绪 + 命名空间校验', async () => {
  resetScriptLoader(); // 清模块级 URL 缓存(同进程前例可能已缓存该 URL)
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const scripts = [];
  globalThis.window = globalThis;
  globalThis.document = {
    createElement: (tag) => ({
      tag,
      src: null,
      async: false,
      onload: null,
      onerror: null,
      removed: false,
      remove() {
        this.removed = true;
      },
    }),
    head: {
      appendChild(script) {
        scripts.push(script);
      },
    },
  };
  try {
    const p = e.load();
    assert.equal(scripts.length, 1);
    assert.equal(
      scripts[0].src,
      'https://api.map.baidu.com/api?v=1.0&type=webgl&ak=test-key',
    );
    assert.equal(scripts[0].async, true);
    globalThis.BMapGL = { Map: class {} };
    scripts[0].onload();
    await p;
    assert.equal(e.isLoaded(), true);
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    restore();
  }
});

test('load:onerror → 失败清理(标签移除)+ 可重试', async () => {
  resetScriptLoader(); // 清模块级 URL 缓存(同进程前例可能已缓存该 URL)
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const scripts = [];
  globalThis.window = globalThis;
  globalThis.document = {
    createElement: (tag) => ({
      tag,
      src: null,
      async: false,
      onload: null,
      onerror: null,
      removed: false,
      remove() {
        this.removed = true;
      },
    }),
    head: {
      appendChild(script) {
        scripts.push(script);
      },
    },
  };
  try {
    const p = e.load();
    assert.equal(scripts.length, 1);
    scripts[0].onerror(new Error('boom'));
    await assert.rejects(p, /failed to load/);
    assert.equal(scripts[0].removed, true);
    // 失败清缓存后可重试:再次注入新标签
    const p2 = e.load();
    assert.equal(scripts.length, 2);
    globalThis.BMapGL = { Map: class {} };
    scripts[1].onload();
    await p2;
    assert.equal(e.isLoaded(), true);
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    restore();
  }
});

test('load:namespace 已就绪 → 幂等短路(不再注入)', async () => {
  setup();
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  try {
    await e.load();
    assert.equal(e.isLoaded(), true);
  } finally {
    restore();
  }
});

// ------------------------------------------------------------
// 3. createView / 视图方法(含 bd09 边界)
// ------------------------------------------------------------

test('createView:container 透传 + 初始中心 bd09 + zoom/pitch/rotation + 默认样式', async () => {
  setup();
  const e = createBaiduEngine();
  const container = { node: true };
  const view = await e.createView({
    container,
    center: GCJ,
    zoom: 15,
    pitch: 30,
    rotation: 90,
    style: 'normal',
  });
  const map = view.raw;
  assert.equal(view.engine, e);
  assert.equal(map.container, container);
  const bd = gcj02ToBd09(GCJ.lng, GCJ.lat);
  assert.equal(map.center.lng, bd.lng, '初始中心 lng = 公式 bd09');
  assert.equal(map.center.lat, bd.lat, '初始中心 lat = 公式 bd09');
  assert.equal(map.zoom, 15);
  assert.equal(map.tilt, 30);
  assert.equal(map.heading, 90);
  assert.equal(map.mapType, 'BMAPGL_NORMAL_MAP');
});

test('createView:BMapGL 未就绪 → 明确报错(提示先 load)', async () => {
  const e = createBaiduEngine();
  await assert.rejects(
    e.createView({ container: {}, center: GCJ, zoom: 10, style: 'normal' }),
    /BMapGL 未就绪/,
  );
});

test('getState:厂商 bd09 中心 → gcj02 返回(±1e-5)+ 形状', async () => {
  setup();
  const { view } = await makeView();
  const bd = gcj02ToBd09(GCJ.lng, GCJ.lat);
  view.raw.center = new FakePoint(bd.lng, bd.lat);
  view.raw.zoom = 14;
  view.raw.tilt = 25;
  view.raw.heading = 45;
  const s = view.getState();
  approx(s.center, GCJ, 'getState center 回 gcj02');
  assert.deepEqual(Object.keys(s.center).sort(), ['lat', 'lng']);
  assert.equal(s.zoom, 14);
  assert.equal(s.pitch, 25);
  assert.equal(s.rotation, 45);
});

test('相机闭环:setCenter(gcj02) → getState(gcj02) 同一坐标(防 700m 偏移)', async () => {
  setup();
  const { view } = await makeView();
  const p = { lng: 120.15005, lat: 30.24246 };
  view.setCenter(p);
  approx(view.getState().center, p, 'camera roundtrip');
});

test('getBounds:厂商 bd09 角点 → gcj02 返回 + null 守卫', async () => {
  setup();
  const { view } = await makeView();
  const swG = { lng: 120.0, lat: 30.0 };
  const neG = { lng: 120.2, lat: 30.2 };
  const swB = gcj02ToBd09(swG.lng, swG.lat);
  const neB = gcj02ToBd09(neG.lng, neG.lat);
  view.raw.bounds = new FakeBounds(new FakePoint(swB.lng, swB.lat), new FakePoint(neB.lng, neB.lat));
  const b = view.getBounds();
  approx({ lng: b.west, lat: b.south }, swG, 'sw 回 gcj02');
  approx({ lng: b.east, lat: b.north }, neG, 'ne 回 gcj02');
  view.raw.bounds = null;
  assert.equal(view.getBounds(), null);
});

test('setCenter:厂商收到 bd09;animateMs>0 → panTo 动画分支', async () => {
  setup();
  const { view } = await makeView();
  const p = { lng: 120.15005, lat: 30.24246 };
  view.setCenter(p);
  const bd = gcj02ToBd09(p.lng, p.lat);
  assert.equal(view.raw.center.lng, bd.lng);
  assert.equal(view.raw.center.lat, bd.lat);
  assert.equal(view.raw.panned, false);
  view.setCenter(p, 500);
  assert.equal(view.raw.panned, true);
  assert.equal(view.raw.center.lng, bd.lng);
  assert.equal(view.raw.center.lat, bd.lat);
});

test('setZoom 直设;setPitch 钳制 0-45;setRotation 归一 [0,360)', async () => {
  setup();
  const { view } = await makeView();
  view.setZoom(16);
  assert.equal(view.raw.zoom, 16);
  view.setPitch(60);
  assert.equal(view.raw.tilt, 45, 'pitch 超厂商范围 → 钳制 45');
  view.setPitch(-10);
  assert.equal(view.raw.tilt, 0, '负 pitch → 钳制 0');
  view.setPitch(20);
  assert.equal(view.raw.tilt, 20);
  view.setRotation(-90);
  assert.equal(view.raw.heading, 270, '负旋转 → 归一 [0,360)');
  view.setRotation(450);
  assert.equal(view.raw.heading, 90, '超圈旋转 → 归一 [0,360)');
});

test('setBounds:sw/ne 均转 bd09(精确相等)', async () => {
  setup();
  const { view } = await makeView();
  view.setBounds({ west: 120.0, south: 30.0, east: 120.2, north: 30.2 });
  const b = view.raw.boundsArg;
  const swB = gcj02ToBd09(120.0, 30.0);
  const neB = gcj02ToBd09(120.2, 30.2);
  assert.equal(b.getSouthWest().lng, swB.lng);
  assert.equal(b.getSouthWest().lat, swB.lat);
  assert.equal(b.getNorthEast().lng, neB.lng);
  assert.equal(b.getNorthEast().lat, neB.lat);
});

test('flyTo:panTo 收到 bd09 + zoom 设置', async () => {
  setup();
  const { view } = await makeView();
  const p = { lng: 120.15005, lat: 30.24246 };
  view.flyTo({ center: p, zoom: 14 });
  const bd = gcj02ToBd09(p.lng, p.lat);
  assert.equal(view.raw.panned, true);
  assert.equal(view.raw.center.lng, bd.lng);
  assert.equal(view.raw.center.lat, bd.lat);
  assert.equal(view.raw.zoom, 14);
});

test('setStyle:normal/satellite 映射;whitesmoke 回退 normal + console.warn', async () => {
  setup();
  const { view } = await makeView();
  view.setStyle('satellite');
  assert.equal(view.raw.mapType, 'BMAPGL_SATELLITE_MAP');
  view.setStyle('normal');
  assert.equal(view.raw.mapType, 'BMAPGL_NORMAL_MAP');
  const warns = [];
  const origWarn = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    view.setStyle('whitesmoke');
  } finally {
    console.warn = origWarn;
  }
  assert.equal(view.raw.mapType, 'BMAPGL_NORMAL_MAP', '不支持样式回退 normal');
  assert.ok(warns.length >= 1, '应 console.warn');
  assert.match(warns[0], /whitesmoke/);
});

test('setStyle:厂商常量缺失 → 静默跳过(不抛错)', async () => {
  setup();
  delete globalThis.BMAPGL_NORMAL_MAP;
  delete globalThis.BMAPGL_SATELLITE_MAP;
  const { view } = await makeView();
  assert.equal(view.raw.mapType, null);
  view.setStyle('satellite');
  assert.equal(view.raw.mapType, null);
});

test('createMarker(核心):厂商收到 gcj02ToBd09 结果;offset/content/zIndex/onClick', async () => {
  setup();
  const { view } = await makeView();
  const bd = gcj02ToBd09(GCJ.lng, GCJ.lat);
  const clicked = [];
  const marker = view.createMarker({
    position: GCJ,
    content: '<b>x</b>',
    offset: [4, -6],
    zIndex: 9,
    onClick: () => clicked.push(1),
  });
  const raw = marker.raw;
  assert.equal(raw.point.lng, bd.lng, 'marker lng = 公式 bd09(精确)');
  assert.equal(raw.point.lat, bd.lat, 'marker lat = 公式 bd09(精确)');
  assert.equal(raw.opts.offset.width, 4);
  assert.equal(raw.opts.offset.height, -6);
  assert.equal(raw.opts.zIndex, 9);
  assert.equal(raw.content, '<b>x</b>');
  assert.equal(view.raw.overlays.length, 1, 'addOverlay 上地图');
  raw.trigger('click');
  assert.equal(clicked.length, 1, 'onClick 注册到厂商 click 事件');
  // setPosition 同样转 bd09
  const p2 = { lng: 120.15005, lat: 30.24246 };
  marker.setPosition(p2);
  const bd2 = gcj02ToBd09(p2.lng, p2.lat);
  assert.equal(raw.point.lng, bd2.lng);
  assert.equal(raw.point.lat, bd2.lat);
  marker.setContent('y');
  assert.equal(raw.content, 'y');
  marker.remove();
  assert.equal(view.raw.overlays.length, 0, 'removeOverlay');
  assert.equal(raw.removed, true, '厂商 remove()');
});

test('createCircle:中心 bd09 + radius + 视觉样式 + remove', async () => {
  setup();
  const { view } = await makeView();
  const c = { lng: 120.15005, lat: 30.24246 };
  const circle = view.createCircle({ center: c, radius: 500, color: '#007AFF' });
  const raw = circle.raw;
  const bd = gcj02ToBd09(c.lng, c.lat);
  assert.equal(raw.center.lng, bd.lng);
  assert.equal(raw.center.lat, bd.lat);
  assert.equal(raw.radius, 500);
  assert.equal(raw.opts.strokeColor, '#007AFF');
  assert.equal(raw.opts.fillColor, '#007AFF');
  assert.equal(raw.opts.fillOpacity, 0.08);
  assert.equal(view.raw.overlays.length, 1);
  circle.remove();
  assert.equal(view.raw.overlays.length, 0);
  assert.equal(raw.removed, true);
});

test('addControl:scale → ScaleControl;未知 kind no-op', async () => {
  setup();
  const { view } = await makeView();
  view.addControl('scale');
  assert.equal(view.raw.controls.length, 1);
  assert.equal(view.raw.controls[0].scale, true);
  view.addControl('legend');
  assert.equal(view.raw.controls.length, 1, '未知 kind 不添加');
});

test('on:事件名映射(click/zoomend/moveend/tilesloaded)+ 解绑', async () => {
  setup();
  const { view } = await makeView();
  const events = [];
  const off1 = view.on('click', () => events.push('click'));
  const off2 = view.on('zoomchange', () => events.push('zoom'));
  const off3 = view.on('moveend', () => events.push('move'));
  const off4 = view.on('complete', () => events.push('complete'));
  view.raw.trigger('click');
  view.raw.trigger('zoomend');
  view.raw.trigger('moveend');
  view.raw.trigger('tilesloaded');
  assert.deepEqual(events, ['click', 'zoom', 'move', 'complete']);
  off1();
  off2();
  off3();
  off4();
  events.length = 0;
  view.raw.trigger('click');
  view.raw.trigger('zoomend');
  view.raw.trigger('moveend');
  view.raw.trigger('tilesloaded');
  assert.deepEqual(events, [], '解绑后不再触发');
});

test('destroy:vendor destroy + isDestroyed', async () => {
  setup();
  const { view } = await makeView();
  assert.equal(view.isDestroyed(), false);
  view.destroy();
  assert.equal(view.isDestroyed(), true);
  assert.equal(view.raw.destroyed, true);
});

// ------------------------------------------------------------
// 4. search:四方法(出参均 gcj02)
// ------------------------------------------------------------

test('searchPOI(核心):pageCapacity/location + POI bd09 → gcj02 归一化', async () => {
  setup();
  const e = createBaiduEngine();
  const bdPoi = gcj02ToBd09(120.153576, 30.287459);
  FakePlaceSearch.result = {
    getCurrentNumPois: () => 2,
    getPoi: (i) =>
      i === 0
        ? {
            title: '西湖',
            point: { lng: bdPoi.lng, lat: bdPoi.lat },
            address: '杭州市西湖区',
            tags: '风景名胜;公园',
            uid: 'abc123',
          }
        : { title: 'bad', point: null }, // 非法记录应过滤
  };
  const pois = await e.search.searchPOI({ keyword: '西湖', city: '杭州市', limit: 5 });
  const ps = captures.places[0];
  assert.equal(ps.opts.pageCapacity, 5);
  assert.equal(ps.opts.location, '杭州市', 'city → PlaceSearch.location');
  assert.equal(ps.lastSearch, '西湖');
  assert.equal(pois.length, 1);
  const poi = pois[0];
  assert.equal(poi.id, 'baidu-abc123');
  assert.equal(poi.kind, 'domain');
  assert.equal(poi.name, '西湖');
  assert.equal(poi.category, '风景名胜', 'tags 首段');
  assert.equal(poi.source, 'baidu', '归一化如实标注百度数据源');
  approx(poi.location, { lng: 120.153576, lat: 30.287459 }, 'POI 坐标回 gcj02');
  assert.equal(poi.location.address, '杭州市西湖区');
});

test('searchPOI:无 city → 不设 location(厂商默认区域)', async () => {
  setup();
  const e = createBaiduEngine();
  FakePlaceSearch.result = emptyPlaceResult;
  await e.search.searchPOI({ keyword: '餐厅', limit: 3 });
  const ps = captures.places[0];
  assert.equal(ps.opts.pageCapacity, 3);
  assert.equal(ps.opts.location, undefined);
});

test('searchPOI 周边:中心点 bd09 + radius 透传', async () => {
  setup();
  const e = createBaiduEngine();
  FakePlaceSearch.result = emptyPlaceResult;
  const center = { lng: 120.15005, lat: 30.24246 };
  const r = await e.search.searchPOI({ keyword: '餐厅', center, radius: 2000 });
  const ps = captures.places[0];
  const bd = gcj02ToBd09(center.lng, center.lat);
  assert.equal(ps.lastNearby.keyword, '餐厅');
  assert.equal(ps.lastNearby.center.lng, bd.lng, '周边中心 bd09');
  assert.equal(ps.lastNearby.center.lat, bd.lat);
  assert.equal(ps.lastNearby.radius, 2000);
  assert.deepEqual(r, []);
});

test('searchPOI:空关键词 → 空数组;limit 缺省 10', async () => {
  setup();
  const e = createBaiduEngine();
  assert.deepEqual(await e.search.searchPOI({ keyword: '  ' }), []);
  FakePlaceSearch.result = emptyPlaceResult;
  await e.search.searchPOI({ keyword: 'x' });
  assert.equal(captures.places[0].opts.pageCapacity, 10);
});

test('fetchSuggestions:无 headless Autocomplete → 回退 searchPOI 顶部结果(gcj02)', async () => {
  setup();
  const e = createBaiduEngine();
  const bdPoi = gcj02ToBd09(GCJ.lng, GCJ.lat);
  FakePlaceSearch.result = {
    getCurrentNumPois: () => 1,
    getPoi: () => ({
      title: '天安门',
      point: { lng: bdPoi.lng, lat: bdPoi.lat },
      address: '东城区',
    }),
  };
  const tips = await e.search.fetchSuggestions('天安门', '北京市');
  assert.equal(captures.places.length, 1);
  assert.equal(tips.length, 1);
  const tip = tips[0];
  assert.equal(tip.name, '天安门');
  approx(tip.location, GCJ, 'suggestion 回 gcj02');
  assert.equal(tip.type, '地点');
  assert.equal(captures.autocompletes.length, 0, '未构造 Autocomplete');
});

test('fetchSuggestions:有 headless search 的 Autocomplete → getValues 归一化', async () => {
  setup();
  mockNs.ns.Autocomplete = class extends FakeAutocomplete {};
  const e = createBaiduEngine();
  const bdTip = gcj02ToBd09(120.153576, 30.287459);
  FakeAutocomplete.result = {
    getValues: () => [
      { value: '西湖', point: { lng: bdTip.lng, lat: bdTip.lat }, city: '杭州市', district: '西湖区' },
      { value: '西湖区' }, // 无坐标 → 仅 name
    ],
  };
  const tips = await e.search.fetchSuggestions('西湖');
  const ac = captures.autocompletes[0];
  assert.equal(ac.lastSearch, '西湖');
  assert.equal(ac.opts.location, '全国', '未传 city → 全国');
  assert.equal(tips.length, 2);
  approx(tips[0].location, { lng: 120.153576, lat: 30.287459 }, 'autocomplete 回 gcj02');
  assert.deepEqual(tips[0].city, ['杭州市']);
  assert.equal(tips[0].district, '西湖区');
  assert.equal(tips[1].location, undefined);
  assert.equal(tips[1].name, '西湖区');
});

test('fetchSuggestions:Autocomplete 静默失败 → 超时兜底空数组(不挂起)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    setup();
    mockNs.ns.Autocomplete = class extends FakeAutocomplete {
      search() {
        // 模拟厂商静默失败:不触发 onSearchComplete
      }
    };
    const e = createBaiduEngine();
    const pending = e.search.fetchSuggestions('西湖');
    mock.timers.tick(6000); // 快进越过 5s 兜底超时
    assert.deepEqual(await pending, []);
  } finally {
    mock.timers.reset();
  }
});

test('getCurrentPosition:厂商 bd09 → gcj02;失败 → null', async () => {
  setup();
  const e = createBaiduEngine();
  const bd = gcj02ToBd09(120.153576, 30.287459);
  FakeGeolocation.result = { point: { lng: bd.lng, lat: bd.lat } };
  const pos = await e.search.getCurrentPosition();
  approx(pos, { lng: 120.153576, lat: 30.287459 }, 'geolocation 回 gcj02');
  FakeGeolocation.result = { point: null };
  assert.equal(await e.search.getCurrentPosition(), null);
});

test('geocodeAddress:getPoint(address, cb, city) + bd09 → gcj02;无结果 → null', async () => {
  setup();
  const e = createBaiduEngine();
  const bd = gcj02ToBd09(120.153576, 30.287459);
  FakeGeocoder.result = { point: { lng: bd.lng, lat: bd.lat } };
  const p = await e.search.geocodeAddress('龙井路1号', '杭州市');
  const gc = captures.geocoders[0];
  assert.equal(gc.lastCall.address, '龙井路1号');
  assert.equal(gc.lastCall.city, '杭州市', '第三参:城市字符串(官方文档形态)');
  approx(p, { lng: 120.153576, lat: 30.287459 }, 'geocode 回 gcj02');
  FakeGeocoder.result = null;
  assert.equal(await e.search.geocodeAddress('不存在地址'), null);
});

test('search:namespace 缺失 → 四方法全部安全值(不抛错)', async () => {
  const e = createBaiduEngine();
  assert.deepEqual(await e.search.searchPOI({ keyword: 'x' }), []);
  assert.deepEqual(await e.search.fetchSuggestions('x'), []);
  assert.equal(await e.search.getCurrentPosition(), null);
  assert.equal(await e.search.geocodeAddress('x'), null);
});

// ------------------------------------------------------------
// 5. bd09 公式固定点位(往返自洽,钉住公式)
// ------------------------------------------------------------

test('bd09 固定点位:gcj→bd→gcj 往返自洽 ±1e-5(不用网传对照点)', () => {
  // 公式固定点位(百度官方公式,本仓库 coord-utils 实现):
  //   天安门 gcj02 (116.397428, 39.90923) → bd09 (116.4038005645, 39.9155730161)
  //   上海人民广场 (121.473701, 31.230416) → (121.4802384079, 31.2363508010)
  //   深圳市民中心 (114.057868, 22.543099) → (114.0644200241, 22.5487559551)
  //   杭州西湖 (120.15005, 30.24246) → (120.1565527288, 30.2484596834)
  // ⚠️ 网传「天安门 bd09 (116.403963, 39.915119)」与公式差 ~4.5e-4
  //   (dlng=1.62e-4, dlat=-4.54e-4,ws-b 实测 + 本 WS 复核)——网传对照来自
  //   不同采集点/近似值,**不得作为固定点位断言基准**。
  const fixed = [
    { gcj: { lng: 116.397428, lat: 39.90923 }, bd: { lng: 116.4038005645, lat: 39.9155730161 } },
    { gcj: { lng: 121.473701, lat: 31.230416 }, bd: { lng: 121.4802384079, lat: 31.2363508010 } },
    { gcj: { lng: 114.057868, lat: 22.543099 }, bd: { lng: 114.0644200241, lat: 22.5487559551 } },
    { gcj: { lng: 120.15005, lat: 30.24246 }, bd: { lng: 120.1565527288, lat: 30.2484596834 } },
  ];
  for (const { gcj, bd } of fixed) {
    const out = gcj02ToBd09(gcj.lng, gcj.lat);
    approx(out, bd, `公式固定点位 ${gcj.lng},${gcj.lat}`, 1e-6);
    approx(bd09ToGcj02(out.lng, out.lat), gcj, '往返回自身');
  }
});
