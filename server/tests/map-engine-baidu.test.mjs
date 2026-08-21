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
import { gcj02ToBd09, bd09ToGcj02, wgs84ToGcj02 } from '../src/lib/map-engine/coord-utils.ts';
import { recruitmentBadgeHTML } from '../src/lib/map-markers.ts';
import {
  BAIDU_NAMESPACE,
  createBaiduEngine,
} from '../src/lib/map-engine/baidu/baidu-engine.ts';
import {
  preflightRemoteIcon,
  remoteIconStatus,
  resetIconPreflightCache,
} from '../src/lib/map-engine/icon-preflight.ts';

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
    this.scrollWheelZoom = false;
    this.raw = this; // 逃生舱:mock 自身即 raw 实例
    captures.maps.push(this);
    // 模拟 BMapGL v1.0 异步渲染:构造 + 相机操作后 ~10ms 触发首帧就绪事件
    // onfirsttilesloaded(2026-08-22 SDK 源码核实的 v1.0 就绪信号;旧版
    // tilesloaded 注册名经 BaseClass "on" 前缀归一同样命中,改用派发原名);
    // 就绪超时测试用不自动触发的 Map 子类覆盖
    setTimeout(() => this.trigger('onfirsttilesloaded'), 10);
  }
  enableScrollWheelZoom() {
    this.scrollWheelZoom = true;
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
  getContainer() {
    return this.container;
  }
  addEventListener(event, handler) {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }
  removeEventListener(event, handler) {
    const list = (this.listeners.get(event) ?? []).filter((h) => h !== handler);
    if (list.length === 0) this.listeners.delete(event);
    else this.listeners.set(event, list);
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
    this.zIndex = undefined;
    this.visible = true;
    this.icon = null;
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
  removeEventListener(event, cb) {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, list.filter((h) => h !== cb));
  }
  trigger(event) {
    for (const cb of this.listeners.get(event) ?? []) cb();
  }
  setZIndex(z) {
    this.zIndex = z;
  }
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  setIcon(icon) {
    this.icon = icon;
  }
  remove() {
    this.removed = true;
  }
}

class FakeIcon {
  constructor(url, size, opts = {}) {
    this.url = url;
    this.size = size;
    // BMapGL Icon 第三参 opts.offset === anchor(锚点从图标左上角量起;
    // 2026-08-22 SDK 源码核实:anchor===offset,默认 (w/2,h/2))
    this.anchor = opts.offset ?? null;
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

/** 永不就绪的 Map(无 setMapReadyCallback、不自动触发就绪事件):AK 被禁用时
 * BMapGL 内部异步失败形态——Map 创建成功但不渲染,无任何就绪信号。
 * 注意:不能 extends FakeMap(其构造器会调度自动就绪定时器)。trigger 供测试
 * 手动派发任一事件(多通道就绪断言用)。 */
class NeverReadyMap {
  constructor(container) {
    this.container = container;
    this.destroyed = false;
    this.center = null;
    this.zoom = null;
    this.scrollWheelZoom = false;
    this.listeners = new Map();
    captures.maps.push(this);
  }
  enableScrollWheelZoom() {
    this.scrollWheelZoom = true;
  }
  centerAndZoom(center, zoom) {
    this.center = center;
    this.zoom = zoom;
  }
  setTilt() {}
  setHeading() {}
  setMapType() {}
  getContainer() {
    return this.container;
  }
  addEventListener(event, handler) {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }
  removeEventListener(event, handler) {
    const list = (this.listeners.get(event) ?? []).filter((h) => h !== handler);
    if (list.length === 0) this.listeners.delete(event);
    else this.listeners.set(event, list);
  }
  trigger(event) {
    for (const h of this.listeners.get(event) ?? []) h();
  }
  destroy() {
    this.destroyed = true;
  }
}

/** 带 setMapReadyCallback(BMapGL 2.0 官方就绪回调)的 Map:是否触发回调由
 * 测试手动控制(fireReady);无 tilesloaded 自动触发。 */
class CallbackReadyMap extends NeverReadyMap {
  constructor(container) {
    super(container);
    this.readyCallback = null;
    this.readyFired = false;
  }
  setMapReadyCallback(cb) {
    this.readyCallback = cb;
  }
  fireReady() {
    this.readyFired = true;
    this.readyCallback?.();
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
  maps: [],
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
    Icon: FakeIcon,
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
  resetIconPreflightCache(); // ws-e icon 防御测试:清预检会话缓存
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

test('isLoaded:残缺命名空间({} 占位无 Map)→ false(getscript 半载形态视为未就绪)', () => {
  const e = createBaiduEngine();
  const inst = installEngineMock(BAIDU_NAMESPACE, { coordSystem: 'bd09' });
  try {
    // getscript 脚本开头即 window.BMapGL={} 占位;无 Map 构造器 = 半载/异常
    delete inst.ns.Map;
    assert.equal(e.isLoaded(), false, '无 Map 构造器 → 未就绪(load 轮询会兜住)');
    inst.ns.Map = class FakeMap {};
    assert.equal(e.isLoaded(), true, 'Map 构造器可用 → 功能就绪');
  } finally {
    inst.uninstall();
  }
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

/** 伪造 document:捕获注入的 script/link 元素(按 tag 过滤) */
function makeFakeDocument() {
  const injected = [];
  const doc = {
    head: {
      appended: [],
      appendChild(el) {
        this.appended.push(el);
        injected.push(el);
      },
    },
    createElement(tag) {
      const el = {
        tag,
        src: '',
        async: false,
        onload: null,
        onerror: null,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      if (tag !== 'script') injected.push(el);
      return el;
    },
    querySelector() {
      return null; // CSS 幂等守卫:从未注入过
    },
  };
  return { doc, scripts: () => injected.filter((el) => el.tag === 'script'), all: injected };
}

test('load:真实脚本 URL 直连 getscript(绕过 document.write 包装器)+ 同步注入(async=false)+ 就绪校验', async () => {
  resetScriptLoader(); // 清模块级 URL 缓存(同进程前例可能已缓存该 URL)
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const { doc, scripts } = makeFakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  try {
    const p = e.load();
    const [script] = scripts();
    assert.equal(scripts().length, 1, '首次加载注入一个 script');
    assert.equal(
      script.src,
      'https://api.map.baidu.com/getscript?type=webgl&v=1.0&ak=test-key',
      '直连 getscript 本体(官方 /api 包装器 document.write 被浏览器拦截,ws-6 实测)',
    );
    assert.equal(script.async, false, '同步注入:async=false(AMap/TMap 默认 async=true,百度专用)');
    assert.equal(script.defer, false, '同步注入:不使用 defer(同步执行保证 onload 即完整命名空间)');
    globalThis.BMapGL = { Map: class {} };
    script.onload();
    await p;
    assert.equal(e.isLoaded(), true);
    // 包装器第二支 document.write(注入 bmap.css)的等价物:幂等注入 link
    const links = doc.head.appended.filter((el) => el.tag === 'link');
    assert.equal(links.length, 1, 'load 成功后注入 bmap.css link(控件样式)');
    assert.equal(links[0].href, 'https://api.map.baidu.com/res/webgl/10/bmap.css');
    assert.equal(links[0].rel, 'stylesheet');
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    restore();
  }
});

test('load:命名空间残缺({} 占位无 Map)→ 就绪轮询等待,补全后放行(不抛错)', async () => {
  resetScriptLoader();
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const { doc, scripts } = makeFakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  try {
    const p = e.load();
    const [script] = scripts();
    globalThis.BMapGL = {}; // getscript 开头占位(半载/异常形态:有对象无构造器)
    script.onload();
    let settled = false;
    p.then(() => {
      settled = true;
    }).catch(() => {}); // 派生 promise 必须 catch(同错未处理会被 node:test 判失败)
    p.catch(() => {}); // 防未处理拒绝噪音
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false, 'onload 后命名空间残缺 → 必须轮询等待,不得立即判就绪');
    assert.equal(e.isLoaded(), false, '残缺命名空间(isLoaded 功能判定)视为未就绪');
    // 轮询窗口内命名空间补全(getscript 执行完毕的等价物)→ 放行
    globalThis.BMapGL = { Map: class {} };
    await p;
    assert.equal(e.isLoaded(), true);
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    restore();
  }
});

test('load:onload 后命名空间永不就绪 → 2s 超时抛「命名空间未就绪」(switch 回滚契约)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    resetScriptLoader();
    const e = createBaiduEngine();
    const restore = setEnv(KEY_VAR, 'test-key');
    const savedWindow = globalThis.window;
    const savedDocument = globalThis.document;
    const { doc, scripts } = makeFakeDocument();
    globalThis.window = globalThis;
    globalThis.document = doc;
    try {
      const p = e.load();
      const [script] = scripts();
      globalThis.BMapGL = {}; // 永不补全
      script.onload();
      let settled = false;
      // then 链派生 promise 必须带 catch:派生 promise 会随 p 以同错 reject,
      // 裸 then 会留下未处理拒绝(node:test 判「async activity after test ended」)
      p.then(() => {
        settled = true;
      }).catch(() => {});
      p.catch(() => {}); // 防未处理拒绝噪音(真实错误由下方 await p 抛出)
      await new Promise((r) => setImmediate(r));
      // 轮询链是「timer → 微任务续 → 下一 timer」:tick 与微任务排空交替,
      // 逐拍快进(mock.timers.tick 不同步执行 promise 续体)
      for (let i = 0; i < 39; i++) {
        mock.timers.tick(50);
        await Promise.resolve();
      }
      assert.equal(settled, false, '未到轮询上限仍挂起(带超时,不永久挂起)');
      mock.timers.tick(50);
      await Promise.resolve();
      await assert.rejects(p, /命名空间未就绪/, '超时必须抛「命名空间未就绪」(switch 回滚依赖该错误)');
    } finally {
      delete globalThis.BMapGL;
      globalThis.window = savedWindow;
      globalThis.document = savedDocument;
      restore();
    }
  } finally {
    mock.timers.reset();
  }
});

test('load:onerror → 失败清理(标签移除)+ 可重试', async () => {
  resetScriptLoader(); // 清模块级 URL 缓存(同进程前例可能已缓存该 URL)
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const { doc, scripts } = makeFakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  try {
    const p = e.load();
    assert.equal(scripts().length, 1);
    scripts()[0].onerror(new Error('boom'));
    await assert.rejects(p, /failed to load/);
    assert.equal(scripts()[0].removed, true);
    // 失败清缓存后可重试:再次注入新标签
    const p2 = e.load();
    assert.equal(scripts().length, 2);
    globalThis.BMapGL = { Map: class {} };
    scripts()[1].onload();
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

test('createView:相机先行——centerAndZoom 触发底图图层/瓦片请求,onfirsttilesloaded 就绪后才返回', async () => {
  setup();
  const e = createBaiduEngine();
  const p = e.createView({
    container: {},
    center: GCJ,
    zoom: 14,
    pitch: 20,
    rotation: 30,
    style: 'normal',
  });
  const map = captures.maps[0];
  const bd = gcj02ToBd09(GCJ.lng, GCJ.lat);
  assert.equal(
    map.center.lng,
    bd.lng,
    '相机必须先于就绪等待应用(v1.0 GL 底图图层在 centerAndZoomIn 内才创建;等就绪再设相机 = 零瓦片请求 = 必然超时)',
  );
  assert.equal(map.center.lat, bd.lat);
  assert.equal(map.zoom, 14, 'zoom 先于就绪应用');
  assert.equal(map.tilt, 20, 'pitch 先于就绪应用');
  assert.equal(map.heading, 30, 'rotation 先于就绪应用');
  assert.ok(map.listeners.has('onfirsttilesloaded'), '就绪等待注册 v1.0 首帧事件');
  const view = await p;
  assert.equal(map.center.lng, bd.lng, '就绪后相机保持(SDK 无异步初始化重置)');
  assert.equal(map.center.lat, bd.lat);
  assert.equal(map.zoom, 14);
  assert.equal(map.mapType, 'BMAPGL_NORMAL_MAP');
  assert.equal(view.raw, map);
  assert.equal(map.listeners.size, 0, '就绪后全部监听必须解绑');
});

test('createView:就绪信号永不触发 → 1.5s 超时抛「BMapGL 地图就绪超时」(switch 回滚契约)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    setup();
    // AK 被禁用形态:Map 创建成功但不渲染,onfirsttilesloaded/ontilesloaded/
    // onstyle_loaded/setMapReadyCallback 均无信号
    mockNs.ns.Map = NeverReadyMap;
    const e = createBaiduEngine();
    const p = e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' });
    let settled = false;
    p.then(
      () => {
        settled = true;
      },
      () => {}, // 拒绝分支吞掉(防派生 promise 未处理拒绝;assert.rejects 管主链)
    );
    const map = captures.maps[0];
    const bd = gcj02ToBd09(GCJ.lng, GCJ.lat);
    assert.equal(map.center.lng, bd.lng, '相机先行:超时等待期间相机已应用(与就绪信号无关)');
    mock.timers.tick(1400);
    assert.equal(settled, false, '1.4s 未到超时,仍挂起等待');
    mock.timers.tick(150);
    await assert.rejects(
      p,
      /BMapGL 地图就绪超时/,
      '超时必须抛「BMapGL 地图就绪超时」(switch 回滚依赖 createView 抛错)',
    );
    assert.equal(map.destroyed, true, '超时抛错前销毁未渲染的 Map(容器交还回滚视图)');
    assert.equal(map.listeners.size, 0, '超时后全部监听必须解绑');
  } finally {
    mock.timers.reset();
  }
});

test('createView:setMapReadyCallback 存在(BMapGL 2.0 就绪回调)→ 注册回调;触发即就绪;永不触发 → 超时', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    setup();
    mockNs.ns.Map = CallbackReadyMap;
    const e = createBaiduEngine();
    const p = e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' });
    const map = captures.maps[0];
    assert.equal(typeof map.readyCallback, 'function', '存在 setMapReadyCallback → 必须注册就绪回调(优先通道)');
    mock.timers.tick(1000);
    assert.equal(map.readyFired, false, '回调未触发 → 仍挂起等待');
    map.fireReady(); // SDK 就绪 → 回调触发
    const view = await p;
    const bd = gcj02ToBd09(GCJ.lng, GCJ.lat);
    assert.equal(map.center.lng, bd.lng, '相机已先行应用(v1.0 时序),回调就绪后返回');
    assert.equal(map.zoom, 12);
    assert.equal(view.raw, map);
    assert.equal(map.destroyed, false, '正常就绪不销毁');
    // 回调注册了但永不触发 → 1.5s 超时抛错(与事件通道同契约)
    mockNs.ns.Map = CallbackReadyMap;
    const p2 = e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' });
    p2.catch(() => {});
    const map2 = captures.maps[1];
    mock.timers.tick(1500);
    await assert.rejects(p2, /BMapGL 地图就绪超时/);
    assert.equal(map2.destroyed, true, '回调通道超时同样销毁未渲染的 Map');
  } finally {
    mock.timers.reset();
  }
});

test('createView:就绪多通道——onfirsttilesloaded/tilesloaded/onstyle_loaded 任一触发即就绪', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    setup();
    mockNs.ns.Map = NeverReadyMap; // 无自动信号:由测试手动派发各通道
    const e = createBaiduEngine();
    // 通道 1:onstyle_loaded(样式层早期信号,先于瓦片)→ 即就绪
    let p = e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' });
    let map = captures.maps[0];
    assert.ok(map.listeners.has('onfirsttilesloaded'), '注册首帧瓦片完成事件(v1.0 派发原名)');
    assert.ok(map.listeners.has('tilesloaded'), '注册瓦片全部完成事件(SDK 派发 ontilesloaded,注册名归一命中)');
    assert.ok(map.listeners.has('onstyle_loaded'), '注册样式加载事件');
    assert.equal(map.listeners.get('onfirsttilesloaded').length, 1, '每事件恰一个监听(幂等)');
    map.trigger('onstyle_loaded');
    await p;
    assert.equal(map.listeners.size, 0, 'onstyle_loaded 触发就绪 → 全部解绑');
    // 通道 2:onfirsttilesloaded(首帧渲染完成)→ 即就绪
    p = e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' });
    map = captures.maps[1];
    map.trigger('onfirsttilesloaded');
    await p;
    assert.equal(map.listeners.size, 0, 'onfirsttilesloaded 触发就绪 → 全部解绑');
    // 通道 3:tilesloaded(全部瓦片完成,无前缀别名)→ 即就绪
    p = e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' });
    map = captures.maps[2];
    map.trigger('tilesloaded');
    await p;
    assert.equal(map.listeners.size, 0, 'tilesloaded 触发就绪 → 全部解绑');
  } finally {
    mock.timers.reset();
  }
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

test('createMarker(核心):厂商收到 gcj02ToBd09 结果;content/zIndex/onClick + 锚点语义', async () => {
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
  assert.equal(raw.opts.offset, undefined, 'Marker 构造 offset 不参与渲染定位(SDK 源码核实)→ 不传');
  assert.equal(raw.opts.zIndex, 9);
  assert.equal(raw.content, '<b>x</b>');
  assert.equal(view.raw.overlays.length, 1, 'addOverlay 上地图');
  // 锚点语义(bug 7,SDK 源码核实):GL 无内容纹理 → content 标记配透明 1×1
  // 图标扛锚点;icon.anchor = -契约 offset → 双路径(纹理/DOM)imageTopLeft
  // 均为 屏幕位 + offset,与 AMap 契约一致
  assert.ok(raw.icon instanceof FakeIcon, 'content 标记必须配锚点图标(默认红图钉会双重渲染+偏置)');
  assert.equal(raw.icon.size.width, 1, '锚点图标 1×1(透明)');
  assert.equal(raw.icon.size.height, 1);
  assert.equal(raw.icon.anchor.width, -4, 'icon.anchor = -offset[0]');
  assert.equal(raw.icon.anchor.height, 6, 'icon.anchor = -offset[1]');
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

test('createMarker 契约方法:setZIndex 大写直通 / setVisible→show·hide / on·off→addEventListener', async () => {
  setup();
  const { view } = await makeView();
  const marker = view.createMarker({ position: GCJ });
  const raw = marker.raw;

  marker.setZIndex(77);
  assert.equal(raw.zIndex, 77, 'BMapGL 官方大写 setZIndex 直通');
  marker.setZIndex(120);
  assert.equal(raw.zIndex, 120);

  marker.setVisible(false);
  assert.equal(raw.visible, false, 'setVisible(false) → hide()');
  marker.setVisible(true);
  assert.equal(raw.visible, true, 'setVisible(true) → show()');

  let clicks = 0;
  const cb = () => clicks++;
  marker.on('click', cb);
  assert.equal(raw.listeners.get('click').length, 1, 'on → addEventListener');
  raw.trigger('click');
  assert.equal(clicks, 1);
  marker.off('click', cb);
  assert.equal(raw.listeners.get('click').length, 0, 'off(cb) → removeEventListener 精确解绑');
  raw.trigger('click');
  assert.equal(clicks, 1, '解绑后不再触发');
  // cb 缺省:BMapGL 无「按事件清空」形态 → 保留(调用方应传 cb 精确解绑)
  marker.on('click', cb);
  marker.off('click');
  assert.equal(raw.listeners.get('click').length, 1, 'off 缺省 cb 不误删(契约允许空操作)');
  marker.off('click', cb);
  assert.equal(raw.listeners.get('click').length, 0);
});

test('createMarker 契约方法:icon 规格 → BMapGL.Icon(url, Size, {offset:anchor})(缺省 21x21)', async () => {
  setup();
  const { view } = await makeView();
  const marker = view.createMarker({
    position: GCJ,
    icon: { src: 'pin.svg', size: [24, 32] },
    offset: [4, -6],
  });
  const raw = marker.raw;
  assert.ok(raw.icon instanceof FakeIcon, 'setIcon 收到 BMapGL.Icon 实例');
  assert.equal(raw.icon.url, 'pin.svg', 'url = icon.src');
  assert.ok(raw.icon.size instanceof FakeSize, 'size 转 BMapGL.Size');
  assert.equal(raw.icon.size.width, 24);
  assert.equal(raw.icon.size.height, 32);
  // 锚点(bug 7,SDK 核实):icon.anchor = -契约 offset → imageTopLeft = 屏幕位 + offset
  assert.ok(raw.icon.anchor instanceof FakeSize);
  assert.equal(raw.icon.anchor.width, -4, 'icon.anchor = -offset[0]');
  assert.equal(raw.icon.anchor.height, 6, 'icon.anchor = -offset[1]');
  assert.equal(view.raw.overlays.length, 1, 'icon 路径仍 addOverlay 上地图');

  // size 缺省 → 兜底 BMapGL 默认 marker 尺寸 21x21;无 offset → anchor (0,0)(左上角,AMap 契约)
  const m2 = view.createMarker({ position: GCJ, icon: { src: 'x.png' } });
  assert.ok(m2.raw.icon instanceof FakeIcon);
  assert.equal(m2.raw.icon.size.width, 21);
  assert.equal(m2.raw.icon.size.height, 21);
  assert.equal(m2.raw.icon.anchor.width, 0, '无 offset → anchor (0,0)(icon 左上角在点位)');
  assert.equal(m2.raw.icon.anchor.height, 0);
});

test('createMarker 契约方法:厂商方法缺失 → warn 降级不抛(Icon 缺失同款)', async () => {
  setup();
  const { view } = await makeView();
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args);
  // 方法在原型上:实例 delete 无效 → 从原型摘除(厂商缺失模拟),测后还原
  const proto = FakeMarker.prototype;
  const orig = {
    setZIndex: proto.setZIndex,
    show: proto.show,
    hide: proto.hide,
    addEventListener: proto.addEventListener,
    removeEventListener: proto.removeEventListener,
    setIcon: proto.setIcon,
  };
  try {
    const marker = view.createMarker({ position: GCJ });
    delete proto.setZIndex;
    delete proto.show;
    delete proto.hide;
    assert.doesNotThrow(() => marker.setZIndex(10), 'setZIndex 缺失不得抛');
    assert.doesNotThrow(() => marker.setVisible(false), 'hide 缺失不得抛');
    assert.doesNotThrow(() => marker.setVisible(true), 'show 缺失不得抛');

    // on/off 缺失 → warn 降级不抛
    delete proto.addEventListener;
    delete proto.removeEventListener;
    assert.doesNotThrow(() => marker.on('click', () => {}), 'addEventListener 缺失不得抛');
    assert.doesNotThrow(() => marker.off('click', () => {}), 'removeEventListener 缺失不得抛');

    // ns.Icon 缺失 → 图标降级 warn 不抛
    const origIcon = mockNs.ns.Icon;
    delete mockNs.ns.Icon;
    assert.doesNotThrow(
      () => view.createMarker({ position: GCJ, icon: { src: 'x.png' } }),
      'Icon 缺失不得抛(图标降级)',
    );
    mockNs.ns.Icon = origIcon;

    // raw.setIcon 缺失 → 图标降级 warn 不抛
    delete proto.setIcon;
    assert.doesNotThrow(
      () => view.createMarker({ position: GCJ, icon: { src: 'y.png' } }),
      'setIcon 缺失不得抛(图标降级)',
    );
  } finally {
    proto.setZIndex = orig.setZIndex;
    proto.show = orig.show;
    proto.hide = orig.hide;
    proto.addEventListener = orig.addEventListener;
    proto.removeEventListener = orig.removeEventListener;
    proto.setIcon = orig.setIcon;
    console.warn = origWarn;
  }
  assert.ok(warns.length >= 7, '每个缺失路径必须 console.warn(可观测):' + warns.map((w) => String(w[0])).join(' | '));
  assert.ok(warns.every((w) => String(w[0]).includes('[map-engine]')), '告警带 [map-engine] 前缀');
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

test('createView:BMapGL 默认控件 DOM 防御——zoom/omView 隐藏,版权/比例尺不误伤', async () => {
  setup();
  // 忠实 BMapGL DOM 类名:默认 zoom 左上 / .BMap_omView 3D 指北针(z-index 1000
  // 量级)/ .BMap_cpyCtrl 版权右下 / .BMap_scaleCtrl 引擎 addControl 自建比例尺
  const zoomEl = { style: {}, className: 'BMap_zoomCtrl' };
  const omEl = { style: {}, className: 'BMap_omView' };
  const cpyEl = { style: {}, className: 'BMap_cpyCtrl' };
  const scaleEl = { style: {}, className: 'BMap_scaleCtrl' };
  const container = {
    node: true,
    querySelectorAll(sel) {
      const terms = [...sel.matchAll(/class\*="([^"]+)"/g)].map((m) => m[1]);
      return [zoomEl, omEl, cpyEl, scaleEl].filter((el) =>
        terms.some((t) => el.className.includes(t)),
      );
    },
  };
  const e = createBaiduEngine();
  await e.createView({ container, center: GCJ, zoom: 12, style: 'normal' });
  assert.equal(zoomEl.style.display, 'none', '默认 zoom 控件必须隐藏(display:none)');
  assert.equal(zoomEl.style.pointerEvents, 'none', '默认 zoom 控件解除点击');
  assert.equal(omEl.style.display, 'none', '.BMap_omView 3D 指北针必须隐藏(z-index 1000 盖 UI)');
  assert.equal(omEl.style.pointerEvents, 'none');
  assert.equal(cpyEl.style.display, undefined, '版权保留可见(ToS,由 map-shell CSS 隐藏)');
  assert.equal(scaleEl.style.display, undefined, '不误伤引擎 addControl 自建比例尺');
  assert.equal(scaleEl.style.pointerEvents, undefined, '比例尺不解除点击');
});

test('createView:BMapGL 默认控件防御——无控件 DOM/querySelectorAll 抛错均不炸', async () => {
  setup();
  const e = createBaiduEngine();
  // 容器无 querySelectorAll(FakeMap.getContainer 返回 {})→ 静默跳过
  await assert.doesNotReject(
    e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' }),
    '无 DOM API 不得抛',
  );
  // querySelectorAll 抛错 → 防御式 try/catch 吞掉
  const evil = {
    node: true,
    querySelectorAll() {
      throw new Error('dom boom');
    },
  };
  await assert.doesNotReject(
    e.createView({ container: evil, center: GCJ, zoom: 12, style: 'normal' }),
    'querySelectorAll 异常不得抛(防御式)',
  );
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

// ------------------------------------------------------------
// 6. 失败分类与可操作指引 + 加载幂等性(2026-08-22 ws-c,bug 3 诊断)
// ------------------------------------------------------------

test('失败分类:key 缺失 → not-configured + 指引(.env.local)', async () => {
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, undefined);
  try {
    const err = await e.load().then(() => null, (e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.code, 'not-configured');
    assert.equal(err.stage, 'load');
    assert.match(err.message, /NEXT_PUBLIC_BAIDU_AK/);
    assert.match(err.guidance, /\.env\.local/, '指引必须给出可操作动作');
  } finally {
    restore();
  }
});

test('失败分类:非浏览器 → script-load-failed(message 保留 loader 原文)', async () => {
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedPerf = globalThis.performance;
  // node 无资源时序(entry 为空)→ 会误判拦截;装带 entry 的 fake 归网络失败
  globalThis.performance = {
    getEntriesByType: () => [
      { name: 'https://api.map.baidu.com/getscript?type=webgl&v=1.0&ak=test-key' },
    ],
  };
  try {
    const err = await e.load().then(() => null, (e) => e);
    assert.equal(err.code, 'script-load-failed');
    assert.equal(err.stage, 'load');
    assert.match(err.message, /only available in the browser/, '原始 loader 文案必须保留');
    assert.match(err.guidance, /referer/);
    assert.match(err.guidance, /localhost:3000/);
  } finally {
    globalThis.performance = savedPerf;
    restore();
  }
});

test('失败分类:script onerror → script-load-failed + 指引 + 失败清理仍生效', async () => {
  resetScriptLoader();
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const savedPerf = globalThis.performance;
  const { doc, scripts } = makeFakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  // Resource Timing 有该 URL 的 entry → 网络层失败(请求确实发出)→ 非客户端拦截
  globalThis.performance = {
    getEntriesByType: () => [
      { name: 'https://api.map.baidu.com/getscript?type=webgl&v=1.0&ak=test-key' },
    ],
  };
  try {
    const p = e.load();
    scripts()[0].onerror(new Error('boom'));
    const err = await p.then(() => null, (e) => e);
    assert.equal(err.code, 'script-load-failed');
    assert.equal(err.stage, 'load');
    assert.match(err.message, /failed to load/, '原始 loader 文案必须保留(既有断言依赖)');
    assert.match(err.guidance, /referer/);
    assert.match(err.guidance, /localhost:3000/);
    assert.ok(scripts()[0].removed, 'onerror 失败清理(移除标签)仍生效');
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    globalThis.performance = savedPerf;
    restore();
  }
});

test('失败分类:script onerror + Resource Timing 无该 URL(请求未发出)→ script-blocked-by-client(ERR_BLOCKED_BY_CLIENT)', async () => {
  resetScriptLoader();
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const savedPerf = globalThis.performance;
  const { doc, scripts } = makeFakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  // 被浏览器扩展/广告拦截器拦截:请求从未发出 → Resource Timing 无 entry
  // (2026-08-22 boss 证据:用户 console `net::ERR_BLOCKED_BY_CLIENT`)
  globalThis.performance = { getEntriesByType: () => [] };
  try {
    const p = e.load();
    scripts()[0].onerror(new Error('boom'));
    const err = await p.then(() => null, (e) => e);
    assert.equal(err.code, 'script-blocked-by-client');
    assert.equal(err.stage, 'load');
    assert.match(err.guidance, /ERR_BLOCKED_BY_CLIENT/, '指引点名拦截错误码');
    assert.match(err.guidance, /api\.map\.baidu\.com/, '指引给出白名单域名');
    assert.ok(scripts()[0].removed, '失败清理仍生效');
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    globalThis.performance = savedPerf;
    restore();
  }
});

test('失败分类:performance 不可用/抛错 → 保守归 script-load-failed(指引含拦截分支)', async () => {
  resetScriptLoader();
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const savedPerf = globalThis.performance;
  const { doc, scripts } = makeFakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  try {
    // 无 performance(旧浏览器/被清空)→ 归网络失败(诚实保守,指引双分支)
    delete globalThis.performance;
    let p = e.load();
    scripts()[0].onerror(new Error('boom'));
    let err = await p.then(() => null, (e) => e);
    assert.equal(err.code, 'script-load-failed');
    assert.match(err.guidance, /ERR_BLOCKED_BY_CLIENT/, 'script-load-failed 指引也必须覆盖拦截分支');
    // getEntriesByType 抛错 → 归网络失败(不炸)
    globalThis.performance = {
      getEntriesByType() {
        throw new Error('perf boom');
      },
    };
    p = e.load();
    scripts()[1].onerror(new Error('boom'));
    err = await p.then(() => null, (e) => e);
    assert.equal(err.code, 'script-load-failed');
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    globalThis.performance = savedPerf;
    restore();
  }
});

test('失败分类:命名空间永不就绪 → namespace-not-ready(2s 有界,不永久挂起)+ 重试重新注入', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    resetScriptLoader();
    const e = createBaiduEngine();
    const restore = setEnv(KEY_VAR, 'test-key');
    const savedWindow = globalThis.window;
    const savedDocument = globalThis.document;
    const { doc, scripts } = makeFakeDocument();
    globalThis.window = globalThis;
    globalThis.document = doc;
    try {
      // 第一次:getscript 占位 BMapGL={} 永不补全 → 2s 轮询超时 → 分类抛错
      const p = e.load();
      scripts()[0].onload();
      // 先排空微任务(onload 同步触发 loader 成功,load() 续体要等微任务才
      // 进入轮询;漏掉此拍会让首个 tick 空转、末拍轮询永不触发 → 挂起)
      await new Promise((r) => setImmediate(r));
      for (let i = 0; i < 39; i++) {
        mock.timers.tick(50);
        await Promise.resolve();
      }
      mock.timers.tick(50);
      await Promise.resolve();
      const err1 = await p.then(() => null, (e) => e);
      assert.equal(err1.code, 'namespace-not-ready');
      assert.equal(err1.stage, 'load');
      assert.match(err1.message, /命名空间未就绪/, '回滚契约文案保留');
      assert.match(err1.guidance, /lbsyun/);
      assert.match(err1.guidance, /referer/);
      // 第二次:必须重新注入(幂等修复:失败后不被 URL 缓存/命名空间 truthy
      // 短路),而不是白烧 2s 轮询——切走再切回/多次切换应可恢复
      const p2 = e.load();
      assert.equal(scripts().length, 2, '失败后重试必须重新注入 script(不再短路)');
      globalThis.BMapGL = { Map: class {} };
      scripts()[1].onload();
      await p2; // 命名空间立即就绪(首轮检查命中,不依赖 timer 快进)
      assert.equal(e.isLoaded(), true);
      assert.equal(scripts().length, 2, '成功路径不重复注入');
    } finally {
      delete globalThis.BMapGL;
      globalThis.window = savedWindow;
      globalThis.document = savedDocument;
      restore();
    }
  } finally {
    mock.timers.reset();
  }
});

test('失败分类:createView 就绪超时 → map-ready-timeout + 指引(销毁语义不变)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    setup();
    mockNs.ns.Map = NeverReadyMap; // AK 被禁用形态:无任何就绪信号
    const e = createBaiduEngine();
    const p = e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' });
    p.catch(() => {}); // 防未处理拒绝噪音(主链由下方 then 捕获)
    const map = captures.maps[0];
    mock.timers.tick(1500);
    const err = await p.then(() => null, (e) => e);
    assert.equal(err.code, 'map-ready-timeout');
    assert.equal(err.stage, 'createView');
    assert.match(err.message, /BMapGL 地图就绪超时/, '回滚契约文案保留');
    assert.match(err.guidance, /referer/);
    assert.match(err.guidance, /localhost:3000/);
    assert.equal(map.destroyed, true, '超时先销毁未渲染的 Map(容器交还回滚视图)');
  } finally {
    mock.timers.reset();
  }
});

test('失败分类:createView 未 load → unclassified(message 保留「BMapGL 未就绪」)', async () => {
  const e = createBaiduEngine();
  const err = await e
    .createView({ container: {}, center: GCJ, zoom: 10, style: 'normal' })
    .then(() => null, (e) => e);
  assert.equal(err.code, 'unclassified');
  assert.equal(err.stage, 'createView');
  assert.match(err.message, /BMapGL 未就绪/);
  assert.ok(err.guidance.length > 0, '兜底分类也必须有指引');
});

test('幂等:并发 load 共享同一注入(单 script 标签)', async () => {
  resetScriptLoader();
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const { doc, scripts } = makeFakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  try {
    const p1 = e.load();
    const p2 = e.load();
    assert.equal(scripts().length, 1, '并发调用共享同一注入(URL 缓存)');
    globalThis.BMapGL = { Map: class {} };
    scripts()[0].onload();
    await Promise.all([p1, p2]);
    assert.equal(e.isLoaded(), true);
    assert.equal(scripts().length, 1);
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    restore();
  }
});

test('幂等:load 成功后切走再切回 → 零注入短路(命名空间保持)', async () => {
  resetScriptLoader();
  const e = createBaiduEngine();
  const restore = setEnv(KEY_VAR, 'test-key');
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  const { doc, scripts } = makeFakeDocument();
  globalThis.window = globalThis;
  globalThis.document = doc;
  try {
    const p = e.load();
    globalThis.BMapGL = { Map: class {} };
    scripts()[0].onload();
    await p;
    // 切走(卸载/切其他引擎)后再切回:脚本已加载,命名空间短路,零注入
    await e.load();
    assert.equal(scripts().length, 1, '命名空间已就绪 → 不重复注入');
    assert.equal(e.isLoaded(), true);
  } finally {
    delete globalThis.BMapGL;
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    restore();
  }
});

// ------------------------------------------------------------
// 7. 滚轮缩放显式启用(bug 6)+ content 标记锚点(bug 7)(2026-08-22 ws-c)
// ------------------------------------------------------------

test('createView:BMapGL 默认禁用滚轮缩放 → 显式 enableScrollWheelZoom(bug 6)', async () => {
  setup();
  const e = createBaiduEngine();
  await e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' });
  // SDK 源码核实:Map config 默认 enableWheelZoom = !H.apiVersionIsGL() → GL 恒
  // false,mouseWheel 处理器 if(!config.enableWheelZoom){return} 静默忽略
  assert.equal(
    captures.maps[0].scrollWheelZoom,
    true,
    '必须显式启用滚轮缩放(BMapGL GL 默认禁用,用户「百度无法中间滚动视角」根因)',
  );
});

test('createView:enableScrollWheelZoom API 缺失 → 静默不抛(旧 SDK 兼容)', async () => {
  setup();
  const proto = FakeMap.prototype;
  const orig = proto.enableScrollWheelZoom;
  delete proto.enableScrollWheelZoom;
  try {
    const e = createBaiduEngine();
    await assert.doesNotReject(
      e.createView({ container: {}, center: GCJ, zoom: 12, style: 'normal' }),
      '滚轮缩放 API 缺失不得抛(降级为不可用)',
    );
  } finally {
    proto.enableScrollWheelZoom = orig;
  }
});

test('createMarker 锚点:content 标记(图钉/徽章)配透明 1×1 锚点图标(icon.anchor = -offset)', async () => {
  setup();
  const { view } = await makeView();
  // 图钉契约形态:content + offset [-16,-40] → anchor (16,40) 底尖对齐点位
  const pin = view.createMarker({ position: GCJ, content: '<img .../>', offset: [-16, -40] });
  assert.ok(pin.raw.icon instanceof FakeIcon, 'content 标记必须配锚点图标(默认红图钉双重渲染)');
  assert.equal(pin.raw.icon.size.width, 1, '锚点图标 1×1(透明)');
  assert.equal(pin.raw.icon.size.height, 1);
  assert.equal(pin.raw.icon.anchor.width, 16, '图钉底尖 anchor = -offset(SDK 双路径公式)');
  assert.equal(pin.raw.icon.anchor.height, 40);
  // 徽章契约形态:content + offset [-20,-20] → anchor (20,20) 中心对齐点位
  const badge = view.createMarker({ position: GCJ, content: '<div class="dm-badge">', offset: [-20, -20] });
  assert.equal(badge.raw.icon.anchor.width, 20);
  assert.equal(badge.raw.icon.anchor.height, 20);
  // 无 offset → anchor (0,0)(左上角在点位,AMap 契约)
  const plain = view.createMarker({ position: GCJ, content: 'x' });
  assert.equal(plain.raw.icon.anchor.width, 0);
  assert.equal(plain.raw.icon.anchor.height, 0);
});

test('createMarker 锚点:Icon 构造失败 → content 标记位置降级 warn 不抛', async () => {
  setup();
  const origIcon = mockNs.ns.Icon;
  mockNs.ns.Icon = class {
    constructor() {
      throw new Error('icon boom');
    }
  };
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args);
  try {
    const { view } = await makeView();
    assert.doesNotThrow(() => view.createMarker({ position: GCJ, content: 'x', offset: [-16, -40] }));
    assert.ok(warns.length >= 1, '锚点图标降级必须 console.warn(可观测)');
    assert.match(String(warns[0][0]), /锚点图标构造失败/);
  } finally {
    mockNs.ns.Icon = origIcon;
    console.warn = origWarn;
  }
});

// ---- ws-e(2026-08-22,fix/icon-cors-preflight):icon 路径 CORS 防御 ----
// BMapGL 同为 WebGL 渲染,`new Icon(远程URL)` 纹理必须 CORS-clean;远程
// 未预检/已失败 → 回退 content 锚点路径(msTarget DOM 渲染 <img> 无需
// CORS),后台预检成功后再升级。相对路径/dataURL 行为零变化(见既有 icon 测试)。
// ws-f:预检从 fetch 改为 new Image()(console 噪音减半),mock 相应替换。

const settle = () => new Promise((r) => setTimeout(r, 0));

/** Image mock:failUrls 命中 → onerror;否则 onload(加载异步触发,贴近真实)。 */
function installImageMock({ failUrls = [] } = {}) {
  const original = globalThis.Image;
  const calls = [];
  class MockImage {
    constructor() {
      this.crossOrigin = undefined;
      this.referrerPolicy = undefined;
      this.onload = null;
      this.onerror = null;
      this._src = null;
      calls.push(this);
    }
    set src(url) {
      this._src = url;
      queueMicrotask(() => {
        if (failUrls.includes(url)) {
          if (typeof this.onerror === 'function') this.onerror(new Error('image load failed'));
        } else if (typeof this.onload === 'function') {
          this.onload();
        }
      });
    }
    get src() {
      return this._src;
    }
  }
  globalThis.Image = MockImage;
  return { calls, restore: () => (globalThis.Image = original) };
}

test('createMarker icon 防御(ws-e):远程未验证 → 回退 content 锚点路径 + 后台预检', async () => {
  setup();
  const { view } = await makeView();
  const image = installImageMock();
  try {
    const marker = view.createMarker({
      position: GCJ,
      content: '<b>徽章</b>',
      icon: { src: 'https://favicon.im/example.com', size: [24, 24] },
    });
    const raw = marker.raw;
    assert.ok(raw.icon instanceof FakeIcon, '远程未验证 → 不构造远程 Icon,回退 content 锚点图标');
    assert.ok(String(raw.icon.url).startsWith('data:'), '锚点图标为本地 dataURL(透明 1×1)');
    assert.equal(raw.icon.size.width, 1, '锚点图标 1×1');
    assert.equal(raw.content, '<b>徽章</b>', 'content 已设(msTarget DOM 渲染,<img> 无需 CORS)');
    assert.equal(image.calls.length, 1, '未验证 → 触发后台预检');
    assert.equal(image.calls[0].src, 'https://favicon.im/example.com');
    assert.equal(image.calls[0].crossOrigin, 'anonymous', '匿名 CORS 预检(与 WebGL 纹理加载同源)');
  } finally {
    image.restore();
  }
});

test('createMarker icon 防御(ws-e):预检 ok → 真 URL Icon;fail → 回退 content 路径不重试', async () => {
  setup();
  const { view } = await makeView();
  const image = installImageMock({ failUrls: ['https://favicon.im/fail.example'] });
  try {
    // 预检成功 → 真 logo 直通,缓存命中不重复预检
    preflightRemoteIcon('https://favicon.im/ok.example');
    await settle();
    assert.equal(remoteIconStatus('https://favicon.im/ok.example'), 'ok');
    const m1 = view.createMarker({
      position: GCJ,
      icon: { src: 'https://favicon.im/ok.example', size: [24, 24] },
    });
    assert.ok(m1.raw.icon instanceof FakeIcon);
    assert.equal(m1.raw.icon.url, 'https://favicon.im/ok.example', 'ok → 真 logo 直通');
    assert.equal(image.calls.length, 1, 'ok 缓存命中不重复预检');

    // 预检失败 → 回退 content 锚点路径;失败记忆化同一 URL 不重试
    resetIconPreflightCache();
    preflightRemoteIcon('https://favicon.im/fail.example');
    await settle();
    assert.equal(remoteIconStatus('https://favicon.im/fail.example'), 'fail');
    const m2 = view.createMarker({
      position: GCJ,
      content: '<b>徽章2</b>',
      icon: { src: 'https://favicon.im/fail.example', size: [24, 24] },
    });
    assert.ok(String(m2.raw.icon.url).startsWith('data:'), 'fail → 回退 content 锚点(dataURL)');
    assert.equal(m2.raw.icon.size.width, 1);
    assert.equal(image.calls.length, 2, 'fail 记忆化:同一 URL 不重试(仅 ok.example 与 fail.example 各一次)');
    assert.equal(m2.raw.content, '<b>徽章2</b>', 'content 仍渲染');
  } finally {
    image.restore();
  }
});

// ------------------------------------------------------------
// 8. 单点级(zoom>8)公司 POI content 徽章 + 定位真实化(2026-08-22 ws-b,
// fix/baidu-poi-locate;bug 2「POI 无法正确加载」单点级 + bug 5「定位不是
// 真实位置」)
// ------------------------------------------------------------
// bug 2 单点级核查结论(读码 + 既有 SDK 源码核实,ws-c bug 7):
//   - 公司 POI(zoom>8)走 content 路径:setContent(徽章 HTML)→ msTarget DOM,
//     透明 1×1 锚点图标(anchor = -契约 offset)→ 徽章中心对齐点位;
//   - 点击:marker 模块把 click 绑在 msTarget 上,徽章子元素事件冒泡可达;
//   - favicon.im 403 → 内联 onerror 候选链(favicon.im → icon.horse → emoji);
//     BMapGL setContent 是 innerHTML,内联 onerror 属性不丢(SDK 不覆写)。
// 以下测试把这三条全部钉住(onerror 链为逐字执行内联属性的 DOM-less 模拟)。

/** 从徽章 HTML 提取 data-fb 属性并做 HTML 实体解码(浏览器 dataset 语义)。 */
function decodeHtmlAttr(s) {
  return s.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

test('单点级(zoom>8)公司 POI:content 徽章原样进 msTarget + 锚点(20,20) + 点击可达(ws-b)', async () => {
  setup();
  const { view } = await makeView();
  const badgeHtml = recruitmentBadgeHTML(
    'A',
    'https://favicon.im/example.com',
    '#007AFF',
    'normal',
    ['https://icon.horse/icon/example.com']
  );
  let clicks = 0;
  const marker = view.createMarker({
    position: GCJ,
    offset: [-20, -20],
    content: badgeHtml,
    onClick: () => clicks++,
  });
  const raw = marker.raw;
  assert.equal(raw.content, badgeHtml, '徽章 HTML 原样进 msTarget(DOM content 路径)');
  assert.match(raw.content, /<img src="https:\/\/favicon\.im\/example\.com"/, '主 logo 源=favicon.im');
  assert.match(raw.content, /data-fb=/, '内联候选链数据 data-fb 保留');
  assert.match(raw.content, /onerror=/, '内联 onerror 属性保留(BMapGL innerHTML 不丢事件属性)');
  assert.match(raw.content, /icon\.horse/, '候选链含 icon.horse(favicon.im 403 → 下一候选)');
  assert.match(raw.content, /dm-badge-emoji/, 'emoji 兜底存在');
  assert.ok(raw.icon instanceof FakeIcon, 'content 标记必须配透明锚点图标(GL 无内容纹理)');
  assert.equal(raw.icon.size.width, 1);
  assert.equal(raw.icon.size.height, 1);
  assert.equal(raw.icon.anchor.width, 20, '徽章契约 offset [-20,-20] → anchor (20,20) 中心对齐点位');
  assert.equal(raw.icon.anchor.height, 20);
  raw.trigger('click');
  assert.equal(clicks, 1, '徽章点击(msTarget 子元素冒泡)可达');
});

test('单点级徽章内联 onerror 链(favicon.im 403 → icon.horse → emoji)逐字模拟(ws-b)', async () => {
  const badgeHtml = recruitmentBadgeHTML(
    'A',
    'https://favicon.im/example.com',
    '#007AFF',
    'normal',
    ['https://icon.horse/icon/example.com']
  );
  const handler = badgeHtml.match(/onerror="([^"]*)"/)?.[1];
  const fallbacks = JSON.parse(decodeHtmlAttr(badgeHtml.match(/data-fb="([^"]*)"/)?.[1] ?? '[]'));
  assert.ok(handler, '徽章必须带内联 onerror 属性');
  assert.deepEqual(fallbacks, ['https://icon.horse/icon/example.com'], '候选链数据正确');
  // 元素形状 = 浏览器 img 暴露给内联 handler 的属性(dataset/src/style/nextElementSibling)
  const el = {
    dataset: { fb: JSON.stringify(fallbacks) },
    style: {},
    src: 'https://favicon.im/example.com',
    nextElementSibling: { style: {} },
  };
  const fire = () => new Function(handler).call(el);
  fire(); // favicon.im 403
  assert.equal(
    el.src,
    'https://icon.horse/icon/example.com',
    '第一次 onerror → 切 icon.horse(候选链生效)'
  );
  fire(); // icon.horse 也失败
  assert.equal(el.style.display, 'none', '候选耗尽 → 隐藏 img');
  assert.equal(el.nextElementSibling.style.display, 'block', '显示 emoji 兜底(不破相)');
});

test('单点级徽章 onerror 链:空候选 → 首错即 emoji;多候选按序切换(ws-b)', async () => {
  // 空候选(如裸 IP 无域名映射):favicon.im 失败 → 直接 emoji
  const noFb = recruitmentBadgeHTML('B', 'https://favicon.im/naked-ip.example', '#007AFF', 'normal', []);
  const h1 = noFb.match(/onerror="([^"]*)"/)?.[1];
  const el1 = { dataset: { fb: '[]' }, style: {}, src: 'https://favicon.im/naked-ip.example', nextElementSibling: { style: {} } };
  new Function(h1).call(el1);
  assert.equal(el1.style.display, 'none', '空候选 → 首错即隐藏 img');
  assert.equal(el1.nextElementSibling.style.display, 'block', 'emoji 兜底');
  // 多候选:按序切换(h1 → h2 → emoji)
  const multi = recruitmentBadgeHTML('C', 'https://favicon.im/x.example', '#007AFF', 'normal', [
    'https://icon.horse/icon/x.example',
    'https://fallback2.example/x.png',
  ]);
  const h2 = multi.match(/onerror="([^"]*)"/)?.[1];
  const fb2 = JSON.parse(decodeHtmlAttr(multi.match(/data-fb="([^"]*)"/)?.[1] ?? '[]'));
  assert.equal(fb2.length, 2);
  const el2 = { dataset: { fb: JSON.stringify(fb2) }, style: {}, src: 'https://favicon.im/x.example', nextElementSibling: { style: {} } };
  const fire2 = () => new Function(h2).call(el2);
  fire2();
  assert.equal(el2.src, 'https://icon.horse/icon/x.example', '第一候选');
  fire2();
  assert.equal(el2.src, 'https://fallback2.example/x.png', '第二候选');
  fire2();
  assert.equal(el2.style.display, 'none', '候选耗尽 → emoji');
});

/** navigator.geolocation mock:成功/失败/选项捕获;restore 还原(node 的
 * navigator 是 getter-only 自有属性 → defineProperty 覆盖 + 描述符还原)。 */
function installNavigatorGeo({ fail = false, coords = null } = {}) {
  const calls = [];
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const mock = {
    geolocation: {
      getCurrentPosition(ok, err, opts) {
        calls.push(opts);
        if (fail) err?.(new Error('denied'));
        else if (coords) ok({ coords: { longitude: coords.lng, latitude: coords.lat, accuracy: 8 } });
        else ok(null);
      },
    },
  };
  Object.defineProperty(globalThis, 'navigator', { value: mock, configurable: true, writable: true });
  return {
    calls,
    restore: () => {
      if (desc) Object.defineProperty(globalThis, 'navigator', desc);
      else delete globalThis.navigator;
    },
  };
}

test('getCurrentPosition(ws-b):浏览器高精度优先(wgs84→gcj02;enableHighAccuracy/maximumAge:0),SDK 不构造', async () => {
  setup();
  const e = createBaiduEngine();
  const nav = installNavigatorGeo({ coords: { lng: 120.15, lat: 30.27 } });
  try {
    const pos = await e.search.getCurrentPosition();
    const want = wgs84ToGcj02(120.15, 30.27);
    approx(pos, want, '浏览器 wgs84 → gcj02(契约输出)');
    assert.notDeepEqual(pos, { lng: 120.15, lat: 30.27 }, '境内点位必须经 gcj02 偏移(浏览器 GPS 是 WGS84)');
    assert.equal(captures.geolocations.length, 0, '浏览器通道成功 → SDK Geolocation 不构造');
    assert.deepEqual(
      nav.calls[0],
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      '高精度 GPS + 不缓存旧位(IP 定位 → 真实定位的通道改造核心)'
    );
  } finally {
    nav.restore();
  }
});

test('getCurrentPosition(ws-b):浏览器被拒/空结果/无 navigator → SDK Geolocation fallback(bd09→gcj02)', async () => {
  setup();
  const e = createBaiduEngine();
  const bd = gcj02ToBd09(120.153576, 30.287459);
  FakeGeolocation.result = { point: { lng: bd.lng, lat: bd.lat } };
  // 浏览器被拒(用户拒绝授权/超时)→ SDK fallback
  const denied = installNavigatorGeo({ fail: true });
  try {
    const pos = await e.search.getCurrentPosition();
    approx(pos, { lng: 120.153576, lat: 30.287459 }, 'SDK fallback bd09 → gcj02');
    assert.equal(captures.geolocations.length, 1, '浏览器失败 → SDK Geolocation 兜底');
  } finally {
    denied.restore();
  }
  // 浏览器空结果(coords 缺失)→ SDK fallback
  const empty = installNavigatorGeo({});
  try {
    const pos = await e.search.getCurrentPosition();
    approx(pos, { lng: 120.153576, lat: 30.287459 }, '浏览器空结果 → SDK fallback');
  } finally {
    empty.restore();
  }
  // 无 navigator(node 默认,无 geolocation API)→ SDK fallback
  const pos = await e.search.getCurrentPosition();
  approx(pos, { lng: 120.153576, lat: 30.287459 }, '无浏览器定位 API → SDK fallback');
});

test('getCurrentPosition(ws-b):浏览器与 SDK 均失败 → null(不抛)', async () => {
  setup();
  const e = createBaiduEngine();
  FakeGeolocation.result = null;
  const nav = installNavigatorGeo({ fail: true });
  try {
    assert.equal(await e.search.getCurrentPosition(), null, '双通道失败 → null 安全值');
  } finally {
    nav.restore();
  }
});
