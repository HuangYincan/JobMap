// ============================================================
// 腾讯地图引擎测试 — TMap JS API GL 适配(map-engine-tencent)
// 用 engine-mock(installEngineMock 装到 TMap 命名空间)+ 本地忠实厂商双面
// (LatLng 纬度在前 / LatLngBounds / offset 对象 / setBaseMap / ScaleControl)
// 测:createView 参数传递、createMarker offset 元组转换、setStyle 映射/降级、
// search 归一化(gcj02 直通断言)、isConfigured env 开关、脚本 URL / API 命名。
// ============================================================

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TENCENT_ENGINE,
  normalizeTencentPOI,
  normalizeTencentSuggestion,
} from '../src/lib/map-engine/tencent/tencent-engine.ts';
import { wgs84ToGcj02 } from '../src/lib/map-engine/coord-utils.ts';
import { installEngineMock, MockView, MockMarker, MockCircle } from './fixtures/engine-mock.mjs';

const KEY = 'NEXT_PUBLIC_TENCENT_JSAPI_KEY';

function setKey(value) {
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
}

/** 捕获 console.warn 调用(不污染测试输出) */
function captureWarn() {
  const orig = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  return {
    calls,
    restore() {
      console.warn = orig;
    },
  };
}

/**
 * 忠实厂商双面:在共享 engine-mock 上补齐真实 TMap 方法面,让适配器走
 * 真实 vendor API 命名(纬度在前 LatLng、setBaseMap、offset 对象、setMap(null)
 * 移除、ScaleControl 控件、LatLngBounds 访问器),同时记录构造参数供断言。
 */
function installTMapDouble() {
  const inst = installEngineMock('TMap', { coordSystem: 'gcj02' });
  const { ns } = inst;

  // —— 真实 TMap 形状:TMap.LatLng(lat, lng) 纬度在前;LatLngBounds(sw, ne) ——
  ns.LatLng = class TMapLatLng {
    constructor(lat, lng) {
      this.lat = lat;
      this.lng = lng;
    }
  };
  ns.LatLngBounds = class TMapLatLngBounds {
    constructor(sw, ne) {
      this.sw = sw;
      this.ne = ne;
    }
    getWest() {
      return this.sw.lng;
    }
    getSouth() {
      return this.sw.lat;
    }
    getEast() {
      return this.ne.lng;
    }
    getNorth() {
      return this.ne.lat;
    }
  };
  ns.control = {
    ScaleControl: class ScaleControl {
      constructor(opts) {
        this.opts = opts;
      }
    },
  };

  // 真实 TMap.Map(container, options) 双参签名
  ns.Map = class TMapMapView extends MockView {
    constructor(container, opts = {}) {
      super({ ...opts, container });
      this.container = container;
    }
  };

  // —— 在共享 mock 上补 vendor 方法面(getState 之外的取值器 / setBaseMap / off)——
  const viewPatches = {
    getCenter() {
      const c = this.state.center;
      return new ns.LatLng(c.lat, c.lng);
    },
    getZoom() {
      return this.state.zoom;
    },
    getPitch() {
      return this.state.pitch;
    },
    getRotation() {
      return this.state.rotation;
    },
    setBaseMap(baseMap) {
      this.baseMap = baseMap;
    },
    off(event, cb) {
      const list = this.listeners.get(event) ?? [];
      this.listeners.set(event, list.filter((f) => f !== cb));
    },
  };
  const markerPatches = {
    setMap(map) {
      this.map = map;
    },
    on(event, cb) {
      if (!this.listeners) this.listeners = new Map();
      const list = this.listeners.get(event) ?? [];
      list.push(cb);
      this.listeners.set(event, list);
    },
  };
  const circlePatches = {
    setMap(map) {
      this.map = map;
    },
  };

  const originals = new Map();
  for (const [cls, patches] of [
    [MockView, viewPatches],
    [MockMarker, markerPatches],
    [MockCircle, circlePatches],
  ]) {
    for (const [name, fn] of Object.entries(patches)) {
      originals.set(`${cls.name}:${name}`, { cls, name, had: Object.hasOwn(cls.prototype, name) });
      cls.prototype[name] = fn;
    }
  }

  return {
    ns,
    restore() {
      for (const { cls, name, had } of originals.values()) {
        if (had) delete cls.prototype[name];
        else cls.prototype[name] = undefined;
      }
      inst.uninstall();
    },
  };
}

/** 快速建视图(双面已装 + window 就绪) */
async function createView(overrides = {}) {
  return TENCENT_ENGINE.createView({
    container: { nodeType: 1 },
    center: { lng: 120.15, lat: 30.27 },
    zoom: 12,
    pitch: 30,
    rotation: 45,
    style: 'normal',
    ...overrides,
  });
}

/** 伪造 document:捕获注入的 script 标签 */
function makeFakeDocument() {
  const scripts = [];
  const doc = {
    head: {
      appended: [],
      appendChild(el) {
        this.appended.push(el);
      },
    },
    createElement(tag) {
      if (tag !== 'script') return { style: {} };
      const el = {
        src: '',
        async: false,
        onload: null,
        onerror: null,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      scripts.push(el);
      return el;
    },
  };
  return { doc, scripts };
}

afterEach(() => {
  setKey(undefined);
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.navigator;
  delete globalThis.fetch;
});

// ------------------------------------------------------------
// 配置 / 加载
// ------------------------------------------------------------

test('isConfigured:env trim 非空开关(运行时读 process.env)', () => {
  setKey(undefined);
  assert.equal(TENCENT_ENGINE.isConfigured(), false);
  setKey('');
  assert.equal(TENCENT_ENGINE.isConfigured(), false);
  setKey('   ');
  assert.equal(TENCENT_ENGINE.isConfigured(), false);
  setKey('test-key');
  assert.equal(TENCENT_ENGINE.isConfigured(), true);
  setKey('  test-key  ');
  assert.equal(TENCENT_ENGINE.isConfigured(), true, '前后空白应 trim 后判定');
});

test('load:key 缺失拒绝;SSR(无 window)拒绝;TMap 已就绪短路成功', async () => {
  setKey(undefined);
  await assert.rejects(TENCENT_ENGINE.load(), /未配置.*NEXT_PUBLIC_TENCENT_JSAPI_KEY/);

  setKey('test-key');
  delete globalThis.window;
  await assert.rejects(TENCENT_ENGINE.load(), /only available in the browser/);

  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    await TENCENT_ENGINE.load(); // 命名空间已就绪 → 不抛
    assert.equal(TENCENT_ENGINE.isLoaded(), true);
  } finally {
    restore();
  }
  assert.equal(TENCENT_ENGINE.isLoaded(), false, '卸载后 isLoaded 归 false');
});

test('load:真实脚本 URL(map.qq.com/api/gljs)+ callback 模式 + 幂等 + 失败清理', async () => {
  setKey('test-key');
  globalThis.window = {};
  const { doc, scripts } = makeFakeDocument();
  globalThis.document = doc;

  const p = TENCENT_ENGINE.load();
  assert.equal(scripts.length, 1, '首次加载注入一个 script');
  assert.equal(
    scripts[0].src,
    'https://map.qq.com/api/gljs?v=1.exp&key=test-key&callback=onTMapScriptLoad',
    '脚本 URL 必须与官方文档一致(v=1.exp + key + callback)',
  );
  assert.equal(typeof globalThis.window.onTMapScriptLoad, 'function', '回调必须在注入前注册');
  scripts[0].onload();
  await p;
  assert.equal(globalThis.window.onTMapScriptLoad, undefined, 'settle 后清理全局回调');

  // 幂等:成功后再 load,不重复注入
  await TENCENT_ENGINE.load();
  assert.equal(scripts.length, 1, '同 URL 重复 load 不得重新注入');

  // 失败:onerror → 拒绝 + 移除 script 标签(可重试,由 loader 语义保证)
  setKey('fail-key');
  const p2 = TENCENT_ENGINE.load();
  assert.equal(scripts.length, 2, '新 URL 重新注入');
  scripts[1].onerror();
  await assert.rejects(p2, /failed to load/);
  assert.equal(scripts[1].removed, true, '失败必须移除 script 标签');
});

// ------------------------------------------------------------
// createView / 视图方法
// ------------------------------------------------------------

test('createView:TMap.Map(container, opts) 参数传递,LatLng 纬度在前', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    const container = { nodeType: 1 };
    const view = await TENCENT_ENGINE.createView({
      container,
      center: { lng: 120.15, lat: 30.27 },
      zoom: 12,
      pitch: 30,
      rotation: 45,
      style: 'normal',
    });
    assert.ok(view.raw instanceof ns.Map);
    assert.equal(view.engine, TENCENT_ENGINE);
    assert.equal(view.raw.container, container, 'container 原样透传');
    assert.deepEqual({ ...view.raw.opts.center }, { lat: 30.27, lng: 120.15 }, 'TMap.LatLng 纬度在前(lat, lng)');
    assert.equal(view.raw.opts.zoom, 12);
    assert.equal(view.raw.opts.pitch, 30);
    assert.equal(view.raw.opts.rotation, 45);
    assert.deepEqual(view.raw.opts.baseMap, { type: 'vector' }, 'normal → 矢量底图');
  } finally {
    restore();
  }
});

test('getState:从 TMap 原语归一回 {lng, lat} 视图状态', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    const view = await createView();
    assert.deepEqual(view.getState(), {
      center: { lng: 120.15, lat: 30.27 },
      zoom: 12,
      pitch: 30,
      rotation: 45,
    });
  } finally {
    restore();
  }
});

test('setBounds/getBounds:LatLngBounds(sw, ne) 纬度在前,回读归还 MapBounds', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    const view = await createView();
    view.setBounds({ west: 119.9, south: 30.1, east: 120.4, north: 30.5 });
    assert.deepEqual({ ...view.raw.bounds.sw }, { lat: 30.1, lng: 119.9 }, '西南角 LatLng 纬度在前');
    assert.deepEqual({ ...view.raw.bounds.ne }, { lat: 30.5, lng: 120.4 }, '东北角 LatLng 纬度在前');
    assert.deepEqual(view.getBounds(), { west: 119.9, south: 30.1, east: 120.4, north: 30.5 });

    view.raw.bounds = null;
    assert.equal(view.getBounds(), null, '无边界 → null');
  } finally {
    restore();
  }
});

test('setCenter/setZoom:animateMs>0 → flyTo(duration);否则直设;setPitch/setRotation 直设', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  let flyCalls = 0;
  const origFlyTo = MockView.prototype.flyTo;
  MockView.prototype.flyTo = function (opts = {}) {
    flyCalls++;
    if (opts.center) this.state.center = { ...opts.center };
    if (opts.zoom !== undefined) this.state.zoom = opts.zoom;
    return this;
  };
  try {
    const view = await createView();

    view.setCenter({ lng: 1, lat: 2 }, 0);
    assert.equal(flyCalls, 0, 'animateMs=0 直设');
    assert.deepEqual(view.raw.state.center, { lat: 2, lng: 1 }, 'setCenter 入参 LatLng 纬度在前');

    view.setCenter({ lng: 3, lat: 4 }, 500);
    assert.equal(flyCalls, 1, 'animateMs>0 走 flyTo');
    assert.deepEqual(view.raw.state.center, { lat: 4, lng: 3 });

    view.setZoom(14, 300);
    assert.equal(flyCalls, 2, 'animateMs>0 走 flyTo');
    assert.equal(view.raw.state.zoom, 14);
    view.setZoom(13);
    assert.equal(flyCalls, 2, '无动画直设 setZoom');
    assert.equal(view.raw.state.zoom, 13);

    view.setPitch(40);
    assert.equal(view.raw.state.pitch, 40);
    view.setRotation(90);
    assert.equal(view.raw.state.rotation, 90);

    view.flyTo({ center: { lng: 120.2, lat: 30.3 }, zoom: 11 });
    assert.equal(flyCalls, 3);
    assert.deepEqual(view.raw.state.center, { lat: 30.3, lng: 120.2 });
    assert.equal(view.raw.state.zoom, 11);
  } finally {
    MockView.prototype.flyTo = origFlyTo;
    restore();
  }
});

test('setStyle:satellite→raster、normal→vector、whitesmoke→回退 normal + console.warn', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  const warn = captureWarn();
  try {
    const view = await createView({ style: 'satellite' });
    assert.deepEqual(view.raw.opts.baseMap, { type: 'raster' }, '构造期 satellite → 栅格底图');

    view.setStyle('satellite');
    assert.deepEqual(view.raw.baseMap, { type: 'raster' });
    assert.equal(warn.calls.length, 0, '支持样式不告警');

    view.setStyle('normal');
    assert.deepEqual(view.raw.baseMap, { type: 'vector' });

    view.setStyle('whitesmoke');
    assert.deepEqual(view.raw.baseMap, { type: 'vector' }, '不支持 → 回退 normal');
    assert.equal(warn.calls.length, 1, '不支持样式必须 console.warn');
    assert.match(String(warn.calls[0][0]), /回退 normal/);
  } finally {
    warn.restore();
    restore();
  }
});

test('createMarker:offset 元组 → {x,y} 对象、LatLng 纬度在前、onClick 注册、setPosition/setContent/remove', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    const view = await createView();
    let clicked = 0;
    const marker = view.createMarker({
      position: { lng: 120.16, lat: 30.28 },
      content: '<b>X</b>',
      offset: [4, -6],
      zIndex: 9,
      onClick: () => clicked++,
    });
    assert.ok(marker.raw instanceof MockMarker);
    assert.deepEqual({ ...marker.raw.opts.position }, { lat: 30.28, lng: 120.16 }, 'Marker position LatLng 纬度在前');
    assert.equal(marker.raw.opts.content, '<b>X</b>');
    assert.deepEqual(marker.raw.opts.offset, { x: 4, y: -6 }, '契约 offset 元组 → TMap {x,y} 对象');
    assert.equal(marker.raw.opts.zIndex, 9);
    assert.equal(marker.raw.opts.map, view.raw, 'marker 挂到当前地图');

    marker.raw.listeners.get('click')[0]();
    assert.equal(clicked, 1, 'onClick 经 Marker click 事件注册');

    marker.setPosition({ lng: 1, lat: 2 });
    assert.deepEqual({ ...marker.raw.position }, { lat: 2, lng: 1 }, 'setPosition LatLng 纬度在前');
    marker.setContent('Y');
    assert.equal(marker.raw.content, 'Y');
    marker.remove();
    assert.equal(marker.raw.map, null, 'GL Marker 移除 = setMap(null)');
  } finally {
    restore();
  }
});

test('createCircle:center/radius/颜色映射 + setMap(null) 移除', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    const view = await createView();
    const circle = view.createCircle({
      center: { lng: 120.15, lat: 30.27 },
      radius: 500,
      color: '#007AFF',
    });
    assert.ok(circle.raw instanceof MockCircle);
    assert.deepEqual({ ...circle.raw.opts.center }, { lat: 30.27, lng: 120.15 }, 'Circle center LatLng 纬度在前');
    assert.equal(circle.raw.opts.radius, 500);
    assert.equal(circle.raw.opts.strokeColor, '#007AFF');
    assert.equal(circle.raw.opts.fillColor, '#007AFF');
    assert.equal(circle.raw.opts.fillOpacity, 0.2);
    assert.equal(circle.raw.opts.map, view.raw);
    circle.remove();
    assert.equal(circle.raw.map, null, 'Circle 移除 = setMap(null)');
  } finally {
    restore();
  }
});

test('addControl:scale → TMap.control.ScaleControl(bottomRight);未知 kind no-op', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    const view = await createView();
    view.addControl('scale');
    assert.ok(view.raw.control instanceof ns.control.ScaleControl);
    assert.deepEqual(view.raw.control.opts, { position: 'bottomRight' });
    view.addControl('garbage');
    assert.ok(view.raw.control instanceof ns.control.ScaleControl, '未知 kind 不得覆盖现有控件');
  } finally {
    restore();
  }
});

test('on:契约事件 → TMap 事件名映射(zoomchange→zoom、moveend/complete→idle、click→click)+ 解绑', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    const view = await createView();
    const seen = [];
    const offZoom = view.on('zoomchange', () => seen.push('zoomchange'));
    const offMove = view.on('moveend', () => seen.push('moveend'));
    const offComplete = view.on('complete', () => seen.push('complete'));
    const offClick = view.on('click', () => seen.push('click'));

    assert.deepEqual(
      [...view.raw.listeners.keys()].sort(),
      ['click', 'idle', 'zoom'],
      '契约事件必须映射到 TMap 原生事件名',
    );

    view.raw.trigger('zoom');
    assert.deepEqual(seen, ['zoomchange']);
    view.raw.trigger('idle');
    assert.deepEqual(seen, ['zoomchange', 'moveend', 'complete'], 'idle 同时承载 moveend/complete');
    view.raw.trigger('click');
    assert.deepEqual(seen, ['zoomchange', 'moveend', 'complete', 'click']);

    offZoom();
    view.raw.trigger('zoom');
    assert.deepEqual(seen, ['zoomchange', 'moveend', 'complete', 'click'], '解绑后不再触发');
    offMove();
    view.raw.trigger('idle');
    assert.deepEqual(seen, ['zoomchange', 'moveend', 'complete', 'click', 'complete'], 'moveend 解绑后 idle 只剩 complete');
    offComplete();
    offClick();
  } finally {
    restore();
  }
});

test('destroy:幂等 + isDestroyed', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  let destroyed = 0;
  const origDestroy = MockView.prototype.destroy;
  MockView.prototype.destroy = function () {
    destroyed++;
    this.destroyed = true;
  };
  try {
    const view = await createView();
    assert.equal(view.isDestroyed(), false);
    view.destroy();
    view.destroy();
    assert.equal(destroyed, 1, 'destroy 幂等:二次调用不再触碰 vendor 实例');
    assert.equal(view.isDestroyed(), true);
  } finally {
    MockView.prototype.destroy = origDestroy;
    restore();
  }
});

// ------------------------------------------------------------
// search:vendor 命名空间路径(engine-mock 注入)
// ------------------------------------------------------------

test('searchPOI(vendor):归一化 DomainPOI,gcj02 直通零转换,无效记录过滤', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    const seen = [];
    ns.search.searchPOI = async (opts) => {
      seen.push(opts);
      return [
        {
          id: 'tx1',
          title: ' 西湖 ',
          address: '西湖区龙井路1号',
          category: '旅游景点;景点',
          location: { lng: 120.15, lat: 30.27 },
        },
        { id: 'tx2', title: '无坐标', category: '其他', location: null },
        { id: 'tx3', title: '坐标非法', location: { lng: NaN, lat: 30.1 } },
      ];
    };
    const pois = await TENCENT_ENGINE.search.searchPOI({ keyword: '西湖', city: '杭州', limit: 5 });
    assert.deepEqual(seen, [{ keyword: '西湖', city: '杭州', limit: 5 }], 'vendor 参数原样透传');
    assert.equal(pois.length, 1, '非法坐标/缺坐标记录被过滤');
    assert.deepEqual(pois[0], {
      id: 'tx1',
      kind: 'domain',
      name: '西湖',
      mode: 'domain',
      source: 'amap',
      location: { lng: 120.15, lat: 30.27, address: '西湖区龙井路1号' },
      category: '旅游景点',
    });
    // gcj02 断言:腾讯原生坐标系,location 直通零转换
    assert.equal(pois[0].location.lng, 120.15);
    assert.equal(pois[0].location.lat, 30.27);
  } finally {
    restore();
  }
});

test('fetchSuggestions(vendor):归一化 AmapSuggestion 形状(含 city/district)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    ns.search.fetchSuggestions = async (kw, city) => [
      {
        id: 's1',
        title: '西湖',
        category: '旅游景点',
        address: '西湖区龙井路1号',
        location: { lng: 120.15, lat: 30.27 },
        ad_info: { city: '杭州市', district: '西湖区' },
      },
      { id: 's2', title: '无坐标', location: {} },
    ];
    const sugs = await TENCENT_ENGINE.search.fetchSuggestions('西湖', '杭州');
    assert.equal(sugs.length, 1);
    assert.deepEqual(sugs[0], {
      id: 's1',
      name: '西湖',
      type: '旅游景点',
      location: { lng: 120.15, lat: 30.27 },
      address: '西湖区龙井路1号',
      city: ['杭州市'],
      district: '西湖区',
    });
  } finally {
    restore();
  }
});

test('getCurrentPosition/geocodeAddress(vendor):gcj02 直通返回', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    ns.search.getCurrentPosition = async () => ({ lng: 120.1, lat: 30.2 });
    assert.deepEqual(await TENCENT_ENGINE.search.getCurrentPosition(), { lng: 120.1, lat: 30.2 });

    ns.search.geocodeAddress = async (addr, city) => ({ lng: 120.12, lat: 30.22 });
    assert.deepEqual(await TENCENT_ENGINE.search.geocodeAddress('西湖区文三路', '杭州'), {
      lng: 120.12,
      lat: 30.22,
    });
  } finally {
    restore();
  }
});

// ------------------------------------------------------------
// search:WebService 路径(真实生产路径,无 TMap 命名空间 → fetch)
// ------------------------------------------------------------

test('searchPOI(WebService):boundary region/nearby 构造 + 归一化 + 失败安全值', async () => {
  setKey('test-key');
  globalThis.window = {}; // 无 TMap 命名空间 → 走 WebService
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        status: 0,
        data: [{ id: 'p1', title: '西湖', category: '旅游景点', location: { lng: 120.15, lat: 30.27 } }],
      }),
    };
  };
  try {
    const pois = await TENCENT_ENGINE.search.searchPOI({ keyword: '西湖', city: '杭州' });
    assert.equal(pois.length, 1);
    assert.equal(pois[0].name, '西湖');
    assert.match(calls[0], /\/ws\/place\/v1\/search/, '官方 WebService 关键词搜索端点');
    assert.ok(calls[0].includes('boundary=region'), 'city → region 边界');
    assert.ok(calls[0].includes('page_size=20'), '默认 limit → page_size 20');

    calls.length = 0;
    await TENCENT_ENGINE.search.searchPOI({
      keyword: '咖啡',
      center: { lng: 120.15, lat: 30.27 },
      radius: 2000,
      limit: 5,
    });
    assert.ok(calls[0].includes('boundary=nearby'), 'center → nearby 边界');
    assert.ok(calls[0].includes('2000'), 'radius 透传');
    assert.ok(calls[0].includes('page_size=5'), 'limit → page_size');
  } finally {
    delete globalThis.fetch;
  }
});

test('searchPOI(WebService):HTTP 失败 / status!=0 → 空数组安全值 + warn', async () => {
  setKey('test-key');
  globalThis.window = {};
  const warn = captureWarn();
  try {
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    assert.deepEqual(await TENCENT_ENGINE.search.searchPOI({ keyword: 'x' }), []);
    assert.ok(warn.calls.length >= 1, 'WebService 失败必须告警(可观测)');

    warn.calls.length = 0;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 311, message: 'key 无效' }) });
    assert.deepEqual(await TENCENT_ENGINE.search.searchPOI({ keyword: 'x' }), [], 'status!=0 → 空结果');
  } finally {
    warn.restore();
    delete globalThis.fetch;
  }
});

test('fetchSuggestions(WebService):suggestion 端点 + region 参数 + city 数组', async () => {
  setKey('test-key');
  globalThis.window = {};
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        status: 0,
        data: [
          {
            id: 's1',
            title: '西湖',
            category: '旅游景点',
            address: '西湖区龙井路1号',
            location: { lng: 120.15, lat: 30.27 },
            ad_info: { city: '杭州市', district: '西湖区' },
          },
        ],
      }),
    };
  };
  try {
    const sugs = await TENCENT_ENGINE.search.fetchSuggestions('西湖', '杭州');
    assert.match(calls[0], /\/ws\/place\/v1\/suggestion/, '官方 WebService 建议端点');
    assert.ok(calls[0].includes('region=%E6%9D%AD%E5%B7%9E'), 'city → region 参数');
    assert.deepEqual(sugs[0].city, ['杭州市']);
  } finally {
    delete globalThis.fetch;
  }
});

test('geocodeAddress(WebService):geocoder 端点,成功 → gcj02,无结果/失败 → null', async () => {
  setKey('test-key');
  globalThis.window = {};
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({ status: 0, result: { location: { lat: 30.2, lng: 120.1 } } }),
    };
  };
  try {
    const pos = await TENCENT_ENGINE.search.geocodeAddress('西湖区文三路', '杭州');
    assert.match(calls[0], /\/ws\/geocoder\/v1\//, '官方 WebService 地理编码端点');
    assert.deepEqual(pos, { lng: 120.1, lat: 30.2 }, 'result.location(gcj02) 归一回 {lng, lat}');

    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => ({ status: 110, message: '无结果' }),
    });
    assert.equal(await TENCENT_ENGINE.search.geocodeAddress('不存在的地方'), null, 'status!=0 → null');

    globalThis.fetch = async () => ({ ok: false, status: 500 });
    assert.equal(await TENCENT_ENGINE.search.geocodeAddress('x'), null, 'HTTP 失败 → null 安全值');
  } finally {
    delete globalThis.fetch;
  }
});

test('getCurrentPosition(浏览器定位):WGS84 → gcj02 换算;失败/无 API → null', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    ns.search.getCurrentPosition = undefined; // 关闭 vendor 路径 → 浏览器定位
    const want = wgs84ToGcj02(120.15, 30.27);
    globalThis.navigator = {
      geolocation: {
        getCurrentPosition: (ok) => ok({ coords: { longitude: 120.15, latitude: 30.27 } }),
      },
    };
    const pos = await TENCENT_ENGINE.search.getCurrentPosition();
    assert.deepEqual(pos, want);
    assert.notDeepEqual(pos, { lng: 120.15, lat: 30.27 }, '境内点位必须经 gcj02 偏移(浏览器 GPS 是 WGS84)');

    globalThis.navigator.geolocation.getCurrentPosition = (_ok, err) => err(new Error('denied'));
    assert.equal(await TENCENT_ENGINE.search.getCurrentPosition(), null, '定位失败 → null');

    delete globalThis.navigator;
    assert.equal(await TENCENT_ENGINE.search.getCurrentPosition(), null, '无 navigator → null');
  } finally {
    delete globalThis.navigator;
    restore();
  }
});

// ------------------------------------------------------------
// 归一化纯函数
// ------------------------------------------------------------

test('normalizeTencentPOI:字段映射/兜底 id/分号分类/tel 清洗/缺省守卫', () => {
  assert.deepEqual(
    normalizeTencentPOI({
      id: 'x1',
      title: ' 西湖 ',
      address: '西湖区龙井路1号',
      category: '旅游景点;景点',
      tel: ' 0571-123 ',
      location: { lng: 120.15, lat: 30.27 },
    }),
    {
      id: 'x1',
      kind: 'domain',
      name: '西湖',
      mode: 'domain',
      source: 'amap',
      location: { lng: 120.15, lat: 30.27, address: '西湖区龙井路1号' },
      category: '旅游景点',
      tel: '0571-123',
    },
  );
  // 兜底 id + 分类缺省
  const fallback = normalizeTencentPOI({ title: '无名', location: { lng: 120.1, lat: 30.2 } });
  assert.equal(fallback.id, 'tencent-120.1-30.2-无名');
  assert.equal(fallback.category, '地点');
  assert.equal(fallback.tel, undefined);
  assert.equal(fallback.location.address, undefined);
  // 守卫:缺 title / 缺 location / NaN → null
  assert.equal(normalizeTencentPOI({ location: { lng: 1, lat: 2 } }), null);
  assert.equal(normalizeTencentPOI({ title: 'x' }), null);
  assert.equal(normalizeTencentPOI({ title: 'x', location: { lng: NaN, lat: 2 } }), null);
  assert.equal(normalizeTencentPOI(null), null);
});

test('normalizeTencentSuggestion:AmapSuggestion 形状(含 city/district);缺坐标 → null', () => {
  assert.deepEqual(
    normalizeTencentSuggestion({
      id: 's1',
      title: '西湖',
      category: '旅游景点',
      address: '西湖区龙井路1号',
      location: { lng: 120.15, lat: 30.27 },
      ad_info: { city: '杭州市', district: '西湖区' },
    }),
    {
      id: 's1',
      name: '西湖',
      type: '旅游景点',
      location: { lng: 120.15, lat: 30.27 },
      address: '西湖区龙井路1号',
      city: ['杭州市'],
      district: '西湖区',
    },
  );
  // 无 ad_info → city/district 缺省
  assert.equal(
    normalizeTencentSuggestion({ title: 'x', location: { lng: 1, lat: 2 } }).city,
    undefined,
  );
  assert.equal(normalizeTencentSuggestion({ title: 'x' }), null);
  assert.equal(normalizeTencentSuggestion(null), null);
});
