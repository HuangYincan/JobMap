// ============================================================
// 腾讯地图引擎测试 — TMap JS API GL 适配(map-engine-tencent)
// 用 engine-mock(installEngineMock 装到 TMap 命名空间)+ 本地忠实厂商双面
// (LatLng 纬度在前 / LatLngBounds / offset 对象 / setBaseMap / ScaleControl)
// 测:createView 参数传递、createMarker 构造器多路径(单点 Marker / MultiMarker
// 聚合 / 两者皆无诊断)、offset 元组转换、setStyle 映射/降级、search 归一化
// (gcj02 直通断言)、isConfigured env 开关、脚本 URL / API 命名。
// ============================================================

import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  TENCENT_ENGINE,
  normalizeTencentPOI,
  normalizeTencentSuggestion,
  resolveTMapMarkerAnchor,
} from '../src/lib/map-engine/tencent/tencent-engine.ts';
import {
  createCityClusterMarker,
  createPOIMarkerController,
  resolveTMapIconSrc,
} from '../src/lib/map-markers.ts';
import {
  preflightRemoteIcon,
  remoteIconStatus,
  resetIconPreflightCache,
} from '../src/lib/map-engine/icon-preflight.ts';
import { faviconCandidatesFromUrl } from '../src/lib/company-logo.ts';
import { wgs84ToGcj02 } from '../src/lib/map-engine/coord-utils.ts';
import {
  installEngineMock,
  MockView,
  MockMarker,
  MockCircle,
  MockMultiMarker,
} from './fixtures/engine-mock.mjs';
import { makePoi, makeDomainPoi } from './fixtures/amap-mock.mjs';

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
  // MultiMarker 路径依赖:Point(anchor 偏移)/ MarkerStyle(样式,仅图片 src 无 HTML)
  ns.Point = class TMapPoint {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
  };
  ns.MarkerStyle = class TMapMarkerStyle {
    constructor(opts = {}) {
      this.opts = opts;
    }
  };
  ns.control = {
    ScaleControl: class ScaleControl {
      constructor(opts) {
        this.opts = opts;
      }
    },
  };

  // 真实 TMap.Map(container, options) 双参签名;模拟异步初始化:构造后
  // 延迟触发 idle 表示地图就绪(createView 等待它;无同步就绪 API)
  ns.Map = class TMapMapView extends MockView {
    constructor(container, opts = {}) {
      super({ ...opts, container });
      this.container = container;
      setTimeout(() => this.trigger('idle'), 10);
    }
  };

  // —— 在共享 mock 上补 vendor 方法面(getState 之外的取值器 / setBaseMap / off /
  // 控件 API / getContainer)——
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
    setMapStyleId(mapStyleId) {
      this.mapStyleId = mapStyleId;
    },
    off(event, cb) {
      const list = this.listeners.get(event) ?? [];
      const rest = list.filter((f) => f !== cb);
      // 空键删除:保持 listeners 只含有效监听(就绪等待的 ready/idle 解绑后即消失)
      if (rest.length === 0) this.listeners.delete(event);
      else this.listeners.set(event, rest);
    },
    getContainer() {
      return this.container;
    },
    setShowControl(v) {
      this.showControl = v;
    },
    getControl(id) {
      return this.controls?.get(id) ?? null;
    },
    removeControl(ctrl) {
      this.controls?.delete(ctrl.id);
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
    off(event, cb) {
      const list = this.listeners?.get(event) ?? [];
      this.listeners?.set(
        event,
        list.filter((f) => f !== cb),
      );
    },
    setZIndex(z) {
      this.zIndex = z;
    },
    setVisible(v) {
      this.visible = v;
    },
    setIcon(icon) {
      this.icon = icon;
    },
  };
  const circlePatches = {
    setMap(map) {
      this.map = map;
    },
  };
  // 批量化(ws-6)依赖 MultiMarker.setStyles(单共享实例新增样式归组):
  // 忠实 SDK v1.8.0.2 语义(全量替换 this.styles,自动补 default)
  const multiPatches = {
    setStyles(styles) {
      this.styles = { ...(styles ?? {}) };
      return this;
    },
  };

  const originals = new Map();
  for (const [cls, patches] of [
    [MockView, viewPatches],
    [MockMarker, markerPatches],
    [MockCircle, circlePatches],
    [MockMultiMarker, multiPatches],
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
  // ws-c:icon 候选链测试使用预检状态机 → 每测后清缓存防串扰
  resetIconPreflightCache();
  try {
    globalThis.sessionStorage?.removeItem('domain-map:icon-preflight-fail');
  } catch {
    // 忽略:sessionStorage 不可用时不需清理
  }
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
    assert.equal(view.raw.opts.showControl, false, '构造 options 必须传 showControl:false(禁用默认控件)');
    assert.equal(view.raw.showControl, false, '构造后 setShowControl(false) 补防御');
    assert.equal(view.raw.listeners.size, 0, '就绪等待的 ready/idle 监听必须解绑');
  } finally {
    restore();
  }
});

test('createView:地图异步初始化——等 idle 事件就绪再返回;超时兜底不阻塞', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    // 非自动就绪 Map:模拟真实 TMap 异步初始化,由测试手动触发 idle
    let lastMap = null;
    ns.Map = class DeferredReadyMap extends MockView {
      constructor(container, opts = {}) {
        super({ ...opts, container });
        this.container = container;
        lastMap = this;
      }
    };
    const p = TENCENT_ENGINE.createView({
      container: { nodeType: 1 },
      center: { lng: 120.15, lat: 30.27 },
      zoom: 12,
      style: 'normal',
    });
    let settled = false;
    p.then(() => {
      settled = true;
    });
    p.catch(() => {}); // 防未处理拒绝噪音(真实错误由下方 await p 抛出)
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(settled, false, '地图未就绪时 createView 必须挂起等待,不得提前返回');

    // 触发 idle(底层 moveend/zoomend → 300ms debounce 后的就绪信号)
    lastMap.trigger('idle');
    const t0 = Date.now();
    const view = await p;
    assert.ok(view.raw instanceof ns.Map, '就绪后返回视图');
    assert.ok(Date.now() - t0 < 1000, '事件驱动就绪必须在超时(1.5s)前返回');
    assert.equal(view.raw.listeners.size, 0, '就绪后 ready/idle 监听必须解绑(off 清理)');
  } finally {
    restore();
  }
});

test('createView:老版本 SDK 忽略 showControl → getControl/removeControl 摘除默认控件', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    const removed = [];
    // 忠实老版本:构造 options 的 showControl 被忽略(zoom/scale 仍被创建)
    ns.Map = class IgnoreShowControlMap extends MockView {
      constructor(container, opts = {}) {
        super({ ...opts, container });
        this.container = container;
        this.controls = new Map([
          ['zoom', { id: 'zoom' }],
          ['scale', { id: 'scale' }],
        ]);
        setTimeout(() => this.trigger('idle'), 10);
      }
      getControl(id) {
        return this.controls.get(id) ?? null;
      }
      removeControl(ctrl) {
        removed.push(ctrl.id);
        this.controls.delete(ctrl.id);
      }
      setShowControl() {
        // 老版本无此方法(不应被调用路径依赖)
      }
    };
    const view = await createView();
    assert.deepEqual(removed.sort(), ['scale', 'zoom'], '构造后必须摘除默认 zoom/scale 控件');
    assert.equal(view.raw.controls.size, 0, '默认控件全部摘除');
  } finally {
    restore();
  }
});

test('createView:控件 API 全缺失 → DOM 兜底隐藏控件层 + 版权/水印隐藏;canvas/marker 面板 pointer-events:none', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    // 忠实 TMap GL DOM 类名:tencent-map-ctrl-zoom(交互控件)/ tencent-map-copyright
    // (版权)/ tencent-map-canvas(canvas 面板)/ tencent-map-marker(marker 覆盖物面板)
    const zoomEl = { tag: 'div', style: {}, className: 'tencent-map-ctrl-zoom' };
    const copyrightEl = { tag: 'div', style: {}, className: 'tencent-map-copyright' };
    const canvasEl = { tag: 'canvas', style: {}, className: 'tencent-map-canvas' };
    const markerEl = { tag: 'div', style: {}, className: 'tencent-map-marker' };
    const all = [zoomEl, copyrightEl, canvasEl, markerEl];
    const container = {
      nodeType: 1,
      querySelectorAll(sel) {
        // 忠实模拟 DOM 选择器:class*="X" 子串匹配 + 裸 canvas 标签匹配
        const terms = [...sel.matchAll(/class\*="([^"]+)"/g)].map((m) => m[1]);
        const hasCanvasTag = /(^|[\s,])canvas([\s,\[]|$)/.test(sel);
        return all.filter(
          (el) => (el.tag === 'canvas' && hasCanvasTag) || terms.some((t) => el.className.includes(t)),
        );
      },
    };
    // 关闭共享 mock 上补的控件 API(该路径真实场景为更老版本 SDK 无这些方法)
    const hadControlApi = Object.hasOwn(MockView.prototype, 'getControl');
    const hadRemove = Object.hasOwn(MockView.prototype, 'removeControl');
    const hadSet = Object.hasOwn(MockView.prototype, 'setShowControl');
    delete MockView.prototype.getControl;
    delete MockView.prototype.removeControl;
    delete MockView.prototype.setShowControl;
    try {
      ns.Map = class NoControlApiMap extends MockView {
        constructor(c, opts = {}) {
          super({ ...opts, container: c });
          this.container = c;
          setTimeout(() => this.trigger('idle'), 10);
        }
        getContainer() {
          return container;
        }
      };
      await createView({ container });
      assert.equal(zoomEl.style.display, 'none', '交互控件必须隐藏(display:none)');
      assert.equal(zoomEl.style.pointerEvents, 'none', '交互控件同时解除点击');
      // ws-b(2026-08-22):版权/logo 由「保留可见」改为隐藏(用户明确要求去掉腾讯
      // 水印;ToS 权衡见 tech/23 ws-b 节)
      assert.equal(copyrightEl.style.display, 'none', '版权标识隐藏(用户要求去水印)');
      assert.equal(copyrightEl.style.pointerEvents, 'none', '版权标识解除点击拦截');
      assert.equal(canvasEl.style.display, undefined, 'canvas 不得隐藏(底图渲染)');
      assert.equal(canvasEl.style.pointerEvents, 'none', 'canvas 面板解除点击拦截(命中检测经 container)');
      assert.equal(markerEl.style.display, undefined, 'marker 覆盖物面板不得隐藏(SDK 渲染)');
      assert.equal(markerEl.style.pointerEvents, 'none', 'marker 覆盖物面板解除点击拦截');
    } finally {
      if (hadControlApi) MockView.prototype.getControl = () => null;
      if (hadRemove) MockView.prototype.removeControl = () => {};
      if (hadSet) MockView.prototype.setShowControl = () => {};
    }
  } finally {
    restore();
  }
});

test('createView:控件防御时序——先等就绪再摘除默认控件(ready 前不空转)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    const removed = [];
    const domQueries = [];
    let setShowControlCalls = 0;
    const fakeDom = {
      querySelectorAll(sel) {
        domQueries.push(sel);
        return []; // 空 DOM:ready 前控件尚未建立(真实 TMap 异步初始化)
      },
    };
    // 不自动触发 idle 的 Map:由测试手动触发,断言 ready 前后调用序
    // (2026-08-21 ws-4 时序修复:disableDefaultControls 必须在 waitForMapReady 之后)
    let lastMap = null;
    ns.Map = class ManualReadyMap extends MockView {
      constructor(container, opts = {}) {
        super({ ...opts, container });
        this.container = container;
        this.controls = new Map([
          ['zoom', { id: 'zoom' }],
          ['scale', { id: 'scale' }],
        ]);
        lastMap = this;
      }
      getControl(id) {
        return this.controls.get(id) ?? null;
      }
      removeControl(ctrl) {
        removed.push(ctrl.id);
        this.controls.delete(ctrl.id);
      }
      setShowControl() {
        setShowControlCalls++;
      }
      getContainer() {
        return fakeDom;
      }
    };
    const p = TENCENT_ENGINE.createView({
      container: { nodeType: 1 },
      center: { lng: 120.15, lat: 30.27 },
      zoom: 12,
      style: 'normal',
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(removed, [], 'ready 前不得调用 removeControl(控件 DOM 未建立,扫空空转)');
    assert.equal(setShowControlCalls, 0, 'ready 前不得调用 setShowControl');
    assert.equal(domQueries.length, 0, 'ready 前不得扫 DOM');

    lastMap.trigger('idle');
    const view = await p;
    assert.deepEqual(removed.sort(), ['scale', 'zoom'], 'ready 后必须摘除默认 zoom/scale 控件');
    assert.equal(view.raw.controls.size, 0, '默认控件全部摘除');
    assert.equal(setShowControlCalls, 1, 'ready 后 setShowControl(false) 阻止重建');
    assert.ok(domQueries.length >= 1, 'ready 后 DOM 兜底隐藏执行');
    assert.equal(view.raw.listeners.size, 0, '就绪后 ready/idle 监听必须解绑');
  } finally {
    restore();
  }
});

test('createView:idle 永不触发 → 1.5s 超时兜底放行(卡顿减半)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    setKey('test-key');
    globalThis.window = globalThis;
    const { ns, restore } = installTMapDouble();
    try {
      // 瓦片失败/网络被拦时 idle 永不触发:必须靠超时兜底放行,且超时从 3s 收紧到 1.5s
      ns.Map = class NeverReadyMap extends MockView {
        constructor(container, opts = {}) {
          super({ ...opts, container });
          this.container = container;
        }
      };
      const p = TENCENT_ENGINE.createView({
        container: { nodeType: 1 },
        center: { lng: 120.15, lat: 30.27 },
        zoom: 12,
        style: 'normal',
      });
      let settled = false;
      p.then(() => {
        settled = true;
      });
      p.catch(() => {}); // 防未处理拒绝噪音
      // createView 头部是 await load() 的异步链——先等微任务排空(setImmediate 宏任务
      // 边界),1500ms 超时定时器创建后再 tick,否则 tick 落在定时器创建之前空转
      await new Promise((r) => setImmediate(r));
      mock.timers.tick(1400);
      assert.equal(settled, false, '1.4s 未到超时,仍挂起等待');
      mock.timers.tick(150);
      await p;
      assert.equal(settled, true, '1.5s 超时兜底放行,不永久挂起');
    } finally {
      restore();
    }
  } finally {
    mock.timers.reset();
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

test('setStyle:satellite→satellite、normal→vector、whitesmoke→暗色(mapStyleId DARK, ws-b+ws-d 2026-08-22)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  const warn = captureWarn();
  try {
    const view = await createView({ style: 'satellite' });
    assert.deepEqual(view.raw.opts.baseMap, { type: 'satellite' }, '构造期 satellite → 卫星底图(ws-d:raster 非法)');

    view.setStyle('satellite');
    assert.deepEqual(view.raw.baseMap, { type: 'satellite' });
    assert.equal(view.raw.mapStyleId, 'DEFAULT', '卫星复位暗色标识(无残留)');
    assert.equal(warn.calls.length, 0, '支持样式不告警');

    view.setStyle('normal');
    assert.deepEqual(view.raw.baseMap, { type: 'vector' });

    // ws-b(2026-08-22):whitesmoke(UI「深色」/系统深色偏好)不再回退 normal——
    // SDK v1.8.0.2 核实暗色 = Map 选项 mapStyleId 'DARK'(无 styleType 字段)
    view.setStyle('whitesmoke');
    assert.deepEqual(view.raw.baseMap, { type: 'vector' }, '暗色 = vector 底图 + mapStyleId DARK');
    assert.equal(view.raw.mapStyleId, 'DARK', 'whitesmoke → mapStyleId DARK(暗色底图层)');
    assert.equal(warn.calls.length, 0, 'whitesmoke 已支持(暗色),不告警');

    view.setStyle('normal');
    assert.equal(view.raw.mapStyleId, 'DEFAULT', '切回标准复位暗色');
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

test('createMarker:无 content(纯 position POI)+ 默认 zIndex;显式 zIndex 仍优先', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    const view = await createView();
    const marker = view.createMarker({
      position: { lng: 120.16, lat: 30.28 },
      offset: [0, -14],
    });
    assert.ok(marker.raw instanceof MockMarker);
    assert.deepEqual({ ...marker.raw.opts.position }, { lat: 30.28, lng: 120.16 }, 'Marker position LatLng 纬度在前');
    assert.equal(marker.raw.opts.content, undefined, '无 content 场景不得注入 content(纯 position+offset POI)');
    assert.equal(marker.raw.opts.zIndex, 10, '未显式 zIndex → 默认 10(POI 在底图之上可见)');
    assert.deepEqual(marker.raw.opts.offset, { x: 0, y: -14 });
    assert.equal(marker.raw.opts.map, view.raw);
  } finally {
    restore();
  }
});

test('createMarker:构造失败 → console.error 可见 + rethrow(保留 addMarker 簿记语义)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args);
  const OrigMarker = ns.Marker;
  ns.Marker = class ThrowingMarker {
    constructor() {
      throw new Error('marker boom');
    }
  };
  try {
    const view = await createView();
    assert.throws(() => view.createMarker({ position: { lng: 1, lat: 2 } }), /marker boom/, '必须 rethrow(调用方簿记依赖)');
    assert.equal(errors.length, 1, '失败必须 console.error(可观测,addMarker 的 try/catch 会吞掉)');
    assert.match(String(errors[0][0]), /TMap Marker 创建失败/);
  } finally {
    console.error = origError;
    ns.Marker = OrigMarker;
    restore();
  }
});

test('createMarker:仅 MultiMarker(无 Marker)→ 聚合路径,geometries/id/offset→anchor/zIndex 构造正确', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker; // 真实 v=1.exp 全局形态:无单点 Marker
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const marker = view.createMarker({
      position: { lng: 120.16, lat: 30.28 },
      offset: [4, -6],
      zIndex: 9,
    });
    assert.ok(marker.raw instanceof MockMultiMarker, '走 MultiMarker 聚合路径(共享实例)');
    const geo = marker.raw.geometries[0];
    assert.match(geo.id, /^dm-mk-\d+$/, 'id 递增唯一(dm-mk-N)');
    assert.deepEqual({ ...geo.position }, { lat: 30.28, lng: 120.16 }, 'position LatLng 纬度在前');
    assert.equal(geo.styleId, 'dm-st-1', '有 offset → 样式归组分配 dm-st-N(非 default)');
    assert.equal(marker.raw.map, view.raw, '共享 MultiMarker 挂到当前地图');
    assert.equal(marker.raw.zIndex, 9, 'zIndex 透传(SDK:overlay zIndex → layer rank)');
    // 契约 offset [x,y](AMap content 语义:左上角置于 屏幕位+offset)→
    // MarkerStyle.anchor = -(x,y)(渲染公式 imageTopLeft = 屏幕位 - anchor,
    // 联立即 anchor = -offset;ws-c bug 3 修正,旧公式 (w/2-ox, h-oy) 把
    // 图钉/徽章整图上移左上,表现为 POI 坐标偏移)
    assert.ok(marker.raw.styles['dm-st-1'] instanceof ns.MarkerStyle, 'offset 存在 → 注入归组样式(dm-st-N)');
    assert.ok(marker.raw.styles['dm-st-1'].opts.anchor instanceof ns.Point, 'anchor 必须是 TMap.Point 实例');
    assert.deepEqual(
      { ...marker.raw.styles['dm-st-1'].opts.anchor },
      { x: -4, y: 6 },
      '契约 offset (4,-6) → anchor (-4,6)(左上角置于 屏幕位+offset)',
    );
  } finally {
    restore();
  }
});

test('createMarker(MultiMarker):setPosition → updateGeometries 更新同 geometry;remove → 摘单 geometry(共享实例保留)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const marker = view.createMarker({ position: { lng: 120.16, lat: 30.28 } });
    const geo = marker.raw.geometries[0];
    marker.setPosition({ lng: 1, lat: 2 });
    assert.equal(marker.raw.geometries[0], geo, 'updateGeometries 更新同一 geometry 引用(保留 styleId)');
    assert.deepEqual({ ...geo.position }, { lat: 2, lng: 1 }, 'setPosition LatLng 纬度在前');
    assert.equal(marker.raw.geometries.length, 1, '单 geometry 不变多');
    marker.remove();
    assert.equal(marker.raw.geometries.length, 0, 'remove → 该 geometry 从共享实例摘除');
    assert.equal(marker.raw.map, view.raw, '共享实例保留挂图(批量化:不 setMap(null) 误伤他 marker)');
  } finally {
    restore();
  }
});

test('createMarker(MultiMarker):onClick 经 click 事件,按 e.geometry.id 过滤', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    let clicked = 0;
    const marker = view.createMarker({
      position: { lng: 120.16, lat: 30.28 },
      onClick: () => clicked++,
    });
    const geo = marker.raw.geometries[0];
    marker.raw.trigger('click', { geometry: { id: 'dm-mk-999' } });
    assert.equal(clicked, 0, '其他 geometry.id 不得触发');
    marker.raw.trigger('click', { geometry: { id: geo.id } });
    assert.equal(clicked, 1, '本 marker id 触发');
    marker.raw.trigger('click', { geometry: { id: geo.id } });
    assert.equal(clicked, 2, '可重复触发');
  } finally {
    restore();
  }
});

test('createMarker(单点):契约 setZIndex/setVisible/on/off 直通厂商 API', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    const view = await createView();
    const marker = view.createMarker({ position: { lng: 120.16, lat: 30.28 } });
    const raw = marker.raw;

    marker.setZIndex(66);
    assert.equal(raw.zIndex, 66, '单点 setZIndex 直通 TMap');
    marker.setVisible(false);
    assert.equal(raw.visible, false, '单点 setVisible 直通');
    marker.setVisible(true);
    assert.equal(raw.visible, true);

    let clicks = 0;
    const cb = () => clicks++;
    marker.on('click', cb);
    assert.equal(raw.listeners.get('click').length, 1, 'on → raw.on');
    raw.listeners.get('click')[0]();
    assert.equal(clicks, 1);
    marker.off('click', cb);
    assert.equal(raw.listeners.get('click').length, 0, 'off(cb) → raw.off 精确解绑');
    raw.listeners.get('click')?.[0]?.();
    assert.equal(clicks, 1, '解绑后不再触发');
  } finally {
    restore();
  }
});

test('createMarker(单点):icon 规格 → raw.setIcon({src,width,height})', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  try {
    const view = await createView();
    const marker = view.createMarker({
      position: { lng: 120.16, lat: 30.28 },
      icon: { src: 'pin.svg', size: [24, 32] },
    });
    assert.deepEqual(marker.raw.icon, { src: 'pin.svg', width: 24, height: 32 });
  } finally {
    restore();
  }
});

test('createMarker(单点):icon 且无 setIcon → 一次性 warn 降级不抛', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { restore } = installTMapDouble();
  const warn = captureWarn();
  const hadIcon = Object.hasOwn(MockMarker.prototype, 'setIcon');
  const iconFn = MockMarker.prototype.setIcon;
  delete MockMarker.prototype.setIcon;
  try {
    const view = await createView();
    const marker = view.createMarker({
      position: { lng: 120.16, lat: 30.28 },
      icon: { src: 'pin.svg' },
    });
    assert.equal(marker.raw.icon, undefined, '无 setIcon → 不设图标');
    assert.equal(warn.calls.length, 1, '降级必须 console.warn');
    assert.match(String(warn.calls[0][0]), /无 setIcon/);
    // 后续 marker 同缺省路径不再刷屏
    view.createMarker({ position: { lng: 1, lat: 2 }, icon: { src: 'x.png' } });
    assert.equal(warn.calls.length, 1, '一次性 warn(防刷屏)');
  } finally {
    if (hadIcon) MockMarker.prototype.setIcon = iconFn;
    warn.restore();
    restore();
  }
});

test('createMarker(MultiMarker):契约 on/off 按 geometry.id 过滤注册/解绑', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const marker = view.createMarker({ position: { lng: 120.16, lat: 30.28 } });
    const geo = marker.raw.geometries[0];
    let clicks = 0;
    const cb = () => clicks++;
    const cb2 = () => (clicks += 10);
    marker.on('click', cb);
    marker.on('click', cb2);
    marker.raw.trigger('click', { geometry: { id: 'dm-mk-999' } });
    assert.equal(clicks, 0, '其他 geometry.id 不得触发');
    marker.raw.trigger('click', { geometry: { id: geo.id } });
    assert.equal(clicks, 11, '本 marker 两个回调都触发');
    marker.off('click', cb);
    marker.raw.trigger('click', { geometry: { id: geo.id } });
    assert.equal(clicks, 21, 'off(cb) 精确解绑单个回调');
    marker.off('click'); // cb 缺省 → 解绑本 marker 全部 click
    marker.raw.trigger('click', { geometry: { id: geo.id } });
    assert.equal(clicks, 21, 'off 缺省 cb 解绑全部');
  } finally {
    restore();
  }
});

test('createMarker(MultiMarker):setZIndex max 收敛;setVisible 摘挂单 geometry(不误伤他 marker)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  const warn = captureWarn();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const m1 = view.createMarker({ position: { lng: 120.16, lat: 30.28 }, zIndex: 10 });
    const m2 = view.createMarker({ position: { lng: 120.17, lat: 30.29 }, zIndex: 99 });
    const raw = m1.raw; // 共享实例
    const g1 = raw.geometries[0]; // m1 的 geometry(先创建)
    assert.equal(raw.geometries.length, 2, '两 marker 共享同一 MultiMarker 实例');

    // zIndex 实例级:max 收敛(单 marker 层级语义的批量化近似)
    assert.equal(raw.zIndex, 99, '实例 zIndex = max(10, 99)');
    m1.setZIndex(120);
    assert.equal(raw.zIndex, 120, 'max 收敛到 120');
    m2.setZIndex(30);
    assert.equal(raw.zIndex, 120, 'm2 降级后 max 仍为 120(m1 保持)');

    // setVisible:摘挂单 geometry,实例保留挂图、不触碰实例级 setVisible
    m1.setVisible(false);
    assert.equal(raw.geometries.length, 1, '隐藏 = 该 geometry 从共享实例摘除');
    assert.equal(raw.geometries.some((g) => g.id === g1.id), false, 'm1 geometry 不在实例');
    assert.equal(raw.visible, true, '实例级 visible 不受影响(不误伤 m2)');
    assert.equal(raw.map, view.raw, '实例保留挂图');
    m1.setVisible(true);
    assert.equal(raw.geometries.length, 2, '显示 = 重新挂载(同 id 同 geometry)');
    assert.equal(raw.geometries.some((g) => g.id === g1.id), true, 'm1 geometry 回到实例');
    assert.equal(warn.calls.length, 0, '批量化路径不告警(SDK 正常形态)');
  } finally {
    warn.restore();
    restore();
  }
});

test('createMarker(MultiMarker):setZIndex 缺失(老 SDK)→ 一次性 warn 降级不抛;setVisible 不依赖实例级 API', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  const warn = captureWarn();
  const proto = MockMultiMarker.prototype;
  const origZIndex = proto.setZIndex;
  delete proto.setZIndex;
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const marker = view.createMarker({ position: { lng: 120.16, lat: 30.28 } });
    assert.doesNotThrow(() => marker.setZIndex(99), 'setZIndex 缺失不得抛(降级而非异常)');
    assert.doesNotThrow(() => marker.setZIndex(100));
    assert.equal(marker.raw.zIndex, 10, 'zIndex 保持构造期默认,未变更');
    assert.equal(warn.calls.length, 1, '多次调用只 warn 一次(防刷屏)');
    assert.match(String(warn.calls[0][0]), /MultiMarker 无 setZIndex/);

    // setVisible 走 add/remove 摘挂(不依赖实例级 setVisible)→ 老 SDK 无
    // setVisible 也能工作,无降级告警(ws-6 批量化:实例级 setVisible 会误伤
    // 全部 marker,设计上不再使用)
    warn.calls.length = 0;
    marker.setVisible(false);
    assert.equal(marker.raw.geometries.length, 0, '隐藏 = 摘除该 geometry(无 setVisible 也可用)');
    marker.setVisible(true);
    assert.equal(marker.raw.geometries.length, 1, '显示 = 重新挂载');
    assert.equal(marker.raw.map, view.raw, '实例始终保留挂图');
    assert.equal(warn.calls.length, 0, 'setVisible 路径不产生降级告警');
  } finally {
    proto.setZIndex = origZIndex;
    warn.restore();
    restore();
  }
});

test('createMarker(MultiMarker):icon 规格 → 归组 MarkerStyle src/width/height/anchor(含 offset 合并)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const marker = view.createMarker({
      position: { lng: 120.16, lat: 30.28 },
      icon: { src: 'pin.svg', size: [30, 40] },
      offset: [4, -6],
    });
    const style = marker.raw.styles['dm-st-1'];
    assert.ok(style instanceof ns.MarkerStyle, 'icon 存在 → 归组样式注入(dm-st-N)');
    assert.equal(style.opts.src, 'pin.svg');
    assert.equal(style.opts.width, 30);
    assert.equal(style.opts.height, 40);
    assert.deepEqual(
      { ...style.opts.anchor },
      { x: -4, y: 6 },
      '契约 offset (4,-6) → anchor = -(x,y) = (-4,6)(ws-c 修正,与 AMap/Baidu 同语义)',
    );

    // icon 无 offset:anchor = (0,0) 左上角(AMap 无 offset 语义一致,百度同款);
    // 不同签名 → 新样式归组
    const m2 = view.createMarker({ position: { lng: 1, lat: 2 }, icon: { src: 'a.png', size: [20, 20] } });
    assert.deepEqual({ ...m2.raw.styles['dm-st-2'].opts.anchor }, { x: 0, y: 0 });
    assert.equal(m2.raw.styles['dm-st-1'], style, '共享实例累积样式:旧样式保留');
    assert.ok(m2.raw.styles['dm-st-2'] instanceof ns.MarkerStyle, '新签名 → 新 styleId(dm-st-2)');
  } finally {
    restore();
  }
});

test('createMarker(MultiMarker):HTML content 降级默认点 + 一次性 warn(SDK 无 HTML 渲染)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  const warn = captureWarn();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const m1 = view.createMarker({ position: { lng: 1, lat: 2 }, content: '<b>X</b>' });
    const m2 = view.createMarker({ position: { lng: 3, lat: 4 } });
    m1.setContent('<i>Y</i>');
    assert.equal(warn.calls.length, 1, '构造 content + setContent 合计只告警一次(不刷屏)');
    assert.match(String(warn.calls[0][0]), /MultiMarker 不支持 HTML content/);
    assert.equal(m2.raw.geometries[0].content, undefined, 'content 不写入 geometry(会渲染成 GL 文本标签,非 HTML)');
  } finally {
    warn.restore();
    restore();
  }
});

test('批量 MultiMarker:145 marker 单共享实例(无「数据层过多」/监听爆炸)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const constructions = [];
    const OrigMM = MockMultiMarker;
    ns.MultiMarker = class CountingMM extends OrigMM {
      constructor(opts) {
        super(opts);
        constructions.push(this);
      }
    };
    const view = await createView();
    const wrappers = [];
    for (let i = 0; i < 145; i++) {
      wrappers.push(
        view.createMarker({
          position: { lng: 120.0 + i * 0.001, lat: 30.0 + i * 0.001 },
          zIndex: i % 2 === 0 ? 10 : 20,
        }),
      );
    }
    assert.equal(constructions.length, 1, '145 marker 只构造 1 个 MultiMarker 实例(旧实现 = 145 数据层)');
    const raw = wrappers[0].raw;
    assert.equal(raw, wrappers[144].raw, '全部 wrapper 共享同一实例(逃生舱一致)');
    assert.equal(raw.geometries.length, 145, '全部 geometry 在单实例内');
    const ids = new Set(raw.geometries.map((g) => g.id));
    assert.equal(ids.size, 145, 'geometry id 全局唯一(dm-mk-N)');
    assert.equal(raw.map, view.raw, '实例挂到当前地图');
    assert.equal(raw.zIndex, 20, '实例 zIndex = max(10,20)');
    // click 过滤在共享实例下依然互不误触
    let clicked = 0;
    wrappers[42].on('click', () => clicked++);
    raw.trigger('click', { geometry: { id: 'dm-mk-999' } });
    assert.equal(clicked, 0, '他 geometry.id 不触发');
    raw.trigger('click', { geometry: { id: raw.geometries[42].id } });
    assert.equal(clicked, 1, '本 id 触发(共享实例过滤分发)');
    // 单实例渲染预算:listeners 只有 click(无每实例 mousemove 泄漏)
    const listenerCount = [...raw.listeners.values()].reduce((n, l) => n + l.length, 0);
    assert.equal(listenerCount, 1, '145 marker 只有 1 个 click 监听(旧实现 = 145 × N 监听)');
  } finally {
    restore();
  }
});

test('批量 MultiMarker:样式归组——同签名共享 styleId,异签名新增归组(setStyles 累积)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    // 同签名(同 icon + 同 offset)→ 共享同一 styleId
    const m1 = view.createMarker({
      position: { lng: 1, lat: 2 },
      icon: { src: 'pin.svg', size: [30, 40] },
      offset: [4, -6],
    });
    const m2 = view.createMarker({
      position: { lng: 3, lat: 4 },
      icon: { src: 'pin.svg', size: [30, 40] },
      offset: [4, -6],
    });
    assert.equal(m1.raw.geometries[0].styleId, m2.raw.geometries[1].styleId, '同签名 → 同 styleId(dm-st-1)');
    assert.equal(Object.keys(m1.raw.styles).length, 1, '样式字典不膨胀(1 个签名 1 个样式)');

    // 异签名 → 新 styleId + setStyles 累积(旧样式保留)
    const m3 = view.createMarker({
      position: { lng: 5, lat: 6 },
      icon: { src: 'badge.png', size: [20, 20] },
    });
    assert.equal(m3.raw.geometries[2].styleId, 'dm-st-2', '异签名 → 新归组 dm-st-2');
    assert.equal(Object.keys(m3.raw.styles).length, 2, '累积 2 个样式');
    assert.ok(m3.raw.styles['dm-st-1'] instanceof ns.MarkerStyle, '旧样式保留(setStyles 全量替换语义)');
    assert.ok(m3.raw.styles['dm-st-2'] instanceof ns.MarkerStyle, '新样式注入');

    // 无 icon/offset → SDK 内建 default(零样式注入)
    const m4 = view.createMarker({ position: { lng: 7, lat: 8 } });
    assert.equal(m4.raw.geometries[3].styleId, 'default', '无 icon/offset → default(SDK 内建 pin)');
    assert.equal(Object.keys(m4.raw.styles).length, 2, 'default 不占样式字典');
  } finally {
    restore();
  }
});

test('批量 MultiMarker:off 缺省 cb 只解绑本 marker(不误伤他 marker 回调)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const m1 = view.createMarker({ position: { lng: 1, lat: 2 } });
    const m2 = view.createMarker({ position: { lng: 3, lat: 4 } });
    const raw = m1.raw;
    let c1 = 0;
    let c2 = 0;
    m1.on('click', () => c1++);
    m2.on('click', () => c2++);
    raw.trigger('click', { geometry: { id: raw.geometries[0].id } });
    assert.equal(c1, 1);
    assert.equal(c2, 0, 'm1 的 click 不触发 m2 回调(id 过滤)');
    m1.off('click'); // 缺省 cb → 只解绑 m1
    raw.trigger('click', { geometry: { id: raw.geometries[0].id } });
    assert.equal(c1, 1, 'm1 回调已解绑');
    raw.trigger('click', { geometry: { id: raw.geometries[1].id } });
    assert.equal(c2, 1, 'm2 回调不受影响(共享实例按 id 精确解绑)');
  } finally {
    restore();
  }
});

test('批量 MultiMarker:remove 摘单 geometry + 解绑本 marker 回调 + 他 marker 不受影响', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const m1 = view.createMarker({ position: { lng: 1, lat: 2 }, onClick: () => c1++ });
    const m2 = view.createMarker({ position: { lng: 3, lat: 4 }, onClick: () => c2++ });
    const raw = m1.raw;
    let c1 = 0;
    let c2 = 0;
    raw.trigger('click', { geometry: { id: raw.geometries[0].id } });
    assert.equal(c1, 1, 'm1 onClick 生效');
    raw.trigger('click', { geometry: { id: raw.geometries[1].id } });
    assert.equal(c2, 1, 'm2 onClick 生效');

    m1.remove();
    assert.equal(raw.geometries.length, 1, 'm1 geometry 已摘除');
    assert.equal(raw.geometries[0].id, 'dm-mk-2', 'm2 geometry 保留');
    assert.equal(raw.map, view.raw, '共享实例保留挂图(不 setMap(null))');
    raw.trigger('click', { geometry: { id: 'dm-mk-1' } });
    assert.equal(c1, 1, 'm1 回调已解绑(remove 清理)');
    raw.trigger('click', { geometry: { id: raw.geometries[0].id } });
    assert.equal(c2, 2, 'm2 回调不受影响');
    assert.equal(raw.zIndex, 10, 'm1 移除后实例 zIndex 回落(默认 10)');
  } finally {
    restore();
  }
});

test('批量 MultiMarker:zIndex max 收敛——移除 max 回落次高', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const m1 = view.createMarker({ position: { lng: 1, lat: 2 }, zIndex: 10 });
    const m2 = view.createMarker({ position: { lng: 3, lat: 4 }, zIndex: 100 }); // 选中
    const m3 = view.createMarker({ position: { lng: 5, lat: 6 }, zIndex: 80 }); // 高亮
    const raw = m1.raw;
    assert.equal(raw.zIndex, 100, '实例 zIndex = max(10,100,80)');
    m2.remove();
    assert.equal(raw.zIndex, 80, '选中移除 → 回落次高(80)');
    m3.setZIndex(30);
    assert.equal(raw.zIndex, 30, '高亮降级 → max(10,30) = 30');
    m1.remove();
    m3.remove();
    assert.equal(raw.zIndex, 0, '全部移除 → 0(空图层)');
  } finally {
    restore();
  }
});

test('createMarker:Marker/MultiMarker 皆无 → console.error 命名空间诊断 + throw', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    delete ns.Marker;
    delete ns.MultiMarker;
    const view = await createView();
    assert.throws(
      () => view.createMarker({ position: { lng: 1, lat: 2 } }),
      /TMap 无 Marker\/MultiMarker/,
      '必须 throw(调用方簿记依赖)',
    );
    assert.equal(errors.length, 1, '必须 console.error 诊断(可观测)');
    assert.match(String(errors[0][0]), /TMap 无 Marker\/MultiMarker/);
    assert.ok(Array.isArray(errors[0][1]), '第二参为命名空间 keys 数组(诊断用)');
  } finally {
    console.error = origError;
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

test('addControl:control/Control 命名空间都缺失 → 自绘比例尺降级路径(ws-b:不 warn,向 raw map 加控件为 null)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  const warn = captureWarn();
  try {
    delete ns.control; // 模拟 TMap GL v1.exp 无 control 命名空间(ws-b 源码核实:Yd 装配表无控件类)
    const view = await createView();
    // ws-b(2026-08-22):不再仅 warn 降级——返回自绘比例尺 Promise;Node 无 document
    // 时 resolve null(真实浏览器挂 DOM,见 map-engine-tencent-style.test.mjs)
    const pending = view.addControl('scale');
    assert.doesNotThrow(() => pending, '命名空间缺失必须静默降级,不得抛');
    assert.equal(view.raw.control, null, '降级路径不向 raw map 加控件');
    assert.equal(warn.calls.length, 0, '不再 console.warn「不可用」(已由自绘比例尺取代)');
  } finally {
    warn.restore();
    restore();
  }
});

test('addControl:control 缺失但 Control 存在 → 双路径兜底正常创建控件', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    const ScaleControl = ns.control.ScaleControl;
    delete ns.control;
    ns.Control = { ScaleControl };
    const view = await createView();
    view.addControl('scale');
    assert.ok(view.raw.control instanceof ns.Control.ScaleControl, '走 Control 大写命名空间兜底');
    assert.deepEqual(view.raw.control.opts, { position: 'bottomRight' });
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
      source: 'tencent',
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
      source: 'tencent',
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

// ------------------------------------------------------------
// ws-a(2026-08-22,bug 1+6):icon 真图标 + 聚合徽章 TMap 渲染形态 + LOD 可见性
// ------------------------------------------------------------

test('createMarker(MultiMarker):icon 存在时 content 不降级告警(icon 优先);content-only 仍降级', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  const warn = captureWarn();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    // icon + content 并存:icon 是 TMap 渲染形态(公司 icon / 聚合徽章 dataURL
    // 数据图均此形态)→ 不告警降级;content 不写入 geometry(GL 文本标签禁用)
    const m1 = view.createMarker({
      position: { lng: 120.16, lat: 30.28 },
      content: '<div class="dm-cluster">杭州 12</div>',
      icon: { src: 'data:image/svg+xml,%3Csvg%3Ebadge', size: [54, 54] },
    });
    assert.equal(warn.calls.length, 0, 'icon 存在 → content 不告警(icon 优先渲染)');
    assert.equal(m1.raw.geometries[0].content, undefined, 'content 不写入 geometry(GL 文本标签禁用)');
    assert.equal(m1.raw.geometries[0].styleId, 'dm-st-1', 'icon → 归组样式(dm-st-N)');
    m1.setContent('<i>Y</i>');
    assert.equal(warn.calls.length, 0, 'icon marker setContent 不告警(视觉不受影响)');
    // content-only(无 icon):仍降级默认点 + 一次性 warn(契约行为不变)
    const m2 = view.createMarker({ position: { lng: 3, lat: 4 }, content: '<b>X</b>' });
    assert.equal(warn.calls.length, 1, 'content-only 降级告警(与旧行为一致)');
    assert.match(String(warn.calls[0][0]), /不支持 HTML content/);
  } finally {
    warn.restore();
    restore();
  }
});

test('createMarker(MultiMarker):聚合徽章形态——icon dataURL → MarkerStyle src/size/anchor 归组(同签名共享)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    // createCityClusterMarker 同款参数:size 54 → offset [-27,-27] + icon [54,54]
    const badge1 = view.createMarker({
      position: { lng: 120.15, lat: 30.27 },
      content: '<div class="dm-cluster">杭州 12</div>',
      offset: [-27, -27],
      zIndex: 50,
      icon: { src: 'data:image/svg+xml,%3Csvg%3Ebadge', size: [54, 54] },
    });
    const style = badge1.raw.styles['dm-st-1'];
    assert.ok(style instanceof ns.MarkerStyle, 'icon → 归组 MarkerStyle(dm-st-N)');
    assert.equal(style.opts.src, 'data:image/svg+xml,%3Csvg%3Ebadge', '徽章 icon → MarkerStyle.src 真图标');
    assert.equal(style.opts.width, 54);
    assert.equal(style.opts.height, 54);
    assert.deepEqual(
      { ...style.opts.anchor },
      { x: 27, y: 27 },
      '锚点 = -offset = (27,27)(徽章中心钉地理点;旧公式 (54,81) 把徽章整图上移左上 → bug 3 偏移根因,ws-c 修正)',
    );
    // 同签名徽章共享 styleId(样式字典不膨胀)
    const badge2 = view.createMarker({
      position: { lng: 121.5, lat: 31.2 },
      content: '<div class="dm-cluster">上海 8</div>',
      offset: [-27, -27],
      zIndex: 50,
      icon: { src: 'data:image/svg+xml,%3Csvg%3Ebadge', size: [54, 54] },
    });
    assert.equal(badge2.raw.geometries[1].styleId, badge1.raw.geometries[0].styleId, '同签名 → 同 styleId');
    assert.equal(Object.keys(badge1.raw.styles).length, 1, '样式字典不膨胀');
  } finally {
    restore();
  }
});

test('createMarker(MultiMarker):新签名在实例已存在时经 setStyles 全量替换上实例(调用断言)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  let setStylesCalls = 0;
  let origSetStyles;
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const proto = MockMultiMarker.prototype;
    origSetStyles = proto.setStyles;
    proto.setStyles = function (styles) {
      setStylesCalls++;
      return origSetStyles.call(this, styles);
    };
    const view = await createView();
    view.createMarker({ position: { lng: 1, lat: 2 } }); // 无 icon/offset → default,零样式注入
    assert.equal(setStylesCalls, 0, 'default 样式不触发 setStyles');
    const m2 = view.createMarker({
      position: { lng: 3, lat: 4 },
      icon: { src: 'pin.svg', size: [30, 40] },
    });
    assert.equal(setStylesCalls, 1, '新签名 → setStyles 上实例(先于 add geometry)');
    assert.equal(m2.raw.geometries[1].styleId, 'dm-st-1');
    const m3 = view.createMarker({
      position: { lng: 5, lat: 6 },
      icon: { src: 'badge.png' },
      offset: [2, -3],
    });
    assert.equal(setStylesCalls, 2, '又一新签名 → 再次 setStyles(全量替换累积)');
    assert.equal(m3.raw.geometries[2].styleId, 'dm-st-2');
    assert.ok(m3.raw.styles['dm-st-1'] instanceof ns.MarkerStyle, '旧样式保留(setStyles 全量替换语义)');
  } finally {
    MockMultiMarker.prototype.setStyles = origSetStyles;
    restore();
  }
});

test('聚合徽章清理句柄:setMap(null)/remove 收敛为按 marker 摘单 geometry(共享实例挂图,跨 zoom 分桶不误伤个体 pin)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    // 个体 pin(控制器形态;zoom>8 个体模式时全部显示)
    const pin1 = view.createMarker({ position: { lng: 120.16, lat: 30.28 }, zIndex: 10 });
    const pin2 = view.createMarker({ position: { lng: 120.17, lat: 30.29 }, zIndex: 20 });
    const shared = pin1.raw; // 共享 MultiMarker 实例(pin1/pin2 同层)
    assert.equal(shared.geometries.length, 2);
    const pinIds = shared.geometries.map((g) => g.id);

    // 聚合模式(zoom ≤ 8):城市 pin 隐藏(摘除 geometry)+ 徽章挂到共享实例
    pin1.setVisible(false);
    pin2.setVisible(false);
    assert.equal(shared.geometries.length, 0, '聚合模式下个体 pin 全部隐藏(摘除)');
    let drill = 0;
    const badge = createCityClusterMarker(view, { city: '杭州', count: 12, lng: 120.15, lat: 30.27 });
    const badge2 = createCityClusterMarker(view, { city: '上海', count: 8, lng: 121.5, lat: 31.2 }, {
      onClick: () => {
        drill += 1;
      },
    });
    assert.ok(badge && badge2, '徽章创建成功');
    assert.equal(shared.geometries.length, 2, '两徽章 geometry 加入共享实例(同层,无数据层爆炸)');
    const badge2GeoId = shared.geometries[1].id;
    shared.trigger('click', { geometry: { id: pinIds[0] } });
    assert.equal(drill, 0, 'pin geometry.id 不触发徽章回调');
    shared.trigger('click', { geometry: { id: badge2GeoId } });
    assert.equal(drill, 1, '徽章 onClick 接线(geometry.id 过滤)');

    // 跨 zoom 分桶清理(zoom>8 个体模式):map-shell 分派走 setMap 分支
    badge.setMap(null);
    badge2.setMap(null);
    assert.equal(shared.geometries.length, 0, '徽章 geometry 按 marker 摘除(pin 本就不在层上)');
    assert.equal(shared.map, view.raw, '共享实例未被整层摘除(pin 可见性前提)');

    // 个体模式恢复:pin 重新显示——实例仍挂图,立即可见(不依赖重建)
    pin1.setVisible(true);
    pin2.setVisible(true);
    assert.deepEqual(
      shared.geometries.map((g) => g.id),
      pinIds,
      'pin 重新挂载(同 id 同 geometry,跨分桶不泄漏不重建)',
    );
    assert.equal(shared.map, view.raw, '共享实例全程挂图');
    // remove 分派兜底:幂等不抛、不误伤
    assert.doesNotThrow(() => badge.remove());
    assert.equal(shared.geometries.length, 2, 'remove 兜底幂等(不误伤 pin)');
    assert.equal(shared.map, view.raw, 'remove 兜底不摘除共享实例');
  } finally {
    restore();
  }
});

// ------------------------------------------------------------
// ws-a(2026-08-22,bug 1):anchor 正确化 + 点击拾取 + LOD 摘挂状态
// (SDK v1.8.0.2 实包源码核实:MarkerStyle 默认 anchor 常量 (17,50) 不随
// width/height 归一化 → 自定义尺寸图标必须显式传 anchor;渲染公式
// imageTopLeft = 屏幕位 - anchor 双路径(DOM 2d-adapter margin / GL
// instanceInfos)同语义;relativeZoomScale 默认关闭 → 锚点像素偏移不随
// zoom 缩放,锚点钉死地理点;remove(ids) 全量删 _idSet/_idGeoIndexSet +
// DOM 拾取元素 → 摘挂后重 add 同 id 不冲突;updateGeometries 对不在
// _idSet 的 id 会重新 add → 隐藏期 setPosition 必须跳过,否则可见性泄漏)
// ------------------------------------------------------------
// ws-c(2026-08-22,bug 3)修正锚点公式:契约 offset 语义 = AMap content 路径
// (内容左上角置于 屏幕位+offset,百度 ws-c SDK 源码核实同款 anchor=-offset)
// → 联立 SDK 渲染公式 imageTopLeft = 屏幕位 - anchor 得 **anchor = -offset**,
// 与图标尺寸无关。旧公式 (w/2-ox, h-oy) 把图钉/徽章整图相对地理点上移左上
// (图钉 [-16,-40]→(32,80) 而非 (16,40);徽章 [-20,-20]→(40,60) 而非 (20,20);
// 聚合 [-27,-27]→(54,81) 而非 (27,27))——即用户 bug 3「腾讯 poi 坐标偏移」
// 根因。三生产形态修正后落点:图钉底尖 (16,40)、徽章中心 (20,20)、
// 聚合中心 (27,27),与 AMap/Baidu 逐像素一致。
// ------------------------------------------------------------

test('resolveTMapMarkerAnchor:锚点 = -契约 offset(AMap content 语义,与图标尺寸无关)', () => {
  // 契约(AMap content 路径):内容左上角置于 屏幕位+offset;SDK:imageTopLeft
  // = 屏幕位 - anchor → anchor = -offset。三生产形态落点与高德一致:
  assert.deepEqual(resolveTMapMarkerAnchor(32, 40, [-16, -40]), { x: 16, y: 40 }, '图钉 32×40 offset[-16,-40] → (16,40) 底尖钉地理点');
  assert.deepEqual(resolveTMapMarkerAnchor(40, 40, [-20, -20]), { x: 20, y: 20 }, '徽章 40×40 offset[-20,-20] → (20,20) 中心钉地理点');
  assert.deepEqual(resolveTMapMarkerAnchor(54, 54, [-27, -27]), { x: 27, y: 27 }, '聚合 54×54 offset[-27,-27] → (27,27) 中心钉地理点');
  assert.deepEqual(resolveTMapMarkerAnchor(30, 40, [4, -6]), { x: -4, y: 6 }, 'offset (4,-6) → anchor (-4,6)(左上角置于 屏幕位+offset)');
  // 无 offset → (0,0) 左上角(AMap 无 offset 语义一致,百度同款)
  assert.deepEqual(resolveTMapMarkerAnchor(60, 60, undefined), { x: 0, y: 0 }, '无 offset → 左上角锚点 (0,0)');
  // 锚点与图标尺寸无关(纯 offset 函数):同一 offset 下任意尺寸同锚点
  assert.deepEqual(resolveTMapMarkerAnchor(1, 1, [-20, -20]), { x: 20, y: 20 });
  assert.deepEqual(resolveTMapMarkerAnchor(100, 100, [-20, -20]), { x: 20, y: 20 });
});

test('resolveTMapMarkerAnchor:状态尺寸零漂移——40/46/52 同 offset 恒同锚点', () => {
  // 徽章状态尺寸(40 normal / 46 highlighted / 52 selected)在 TMap icon 路径
  // 恒为 [40,40](map-markers 契约 icon.size 常量),且锚点 = -offset 与尺寸
  // 无关 → 选中/高亮态 anchor 不变,不生成新 styleId、无漂移(疑点 c 结论)。
  const a40 = resolveTMapMarkerAnchor(40, 40, [-20, -20]);
  const a46 = resolveTMapMarkerAnchor(46, 46, [-20, -20]);
  const a52 = resolveTMapMarkerAnchor(52, 52, [-20, -20]);
  assert.deepEqual(a40, { x: 20, y: 20 });
  assert.deepEqual(a46, a40, 'highlighted 尺寸 46 → 锚点不变');
  assert.deepEqual(a52, a40, 'selected 尺寸 52 → 锚点不变');
  // 图钉同理:选中态 42×52(1.3 倍)与基准 32×40 同 offset [-16,-40] 同锚点
  assert.deepEqual(resolveTMapMarkerAnchor(42, 52, [-16, -40]), resolveTMapMarkerAnchor(32, 40, [-16, -40]));
});

test('resolveTMapMarkerAnchor:缩放无关——锚点恒定钉死地理点(2 级缩放前后不漂移)', () => {
  // 渲染公式 imageTopLeft = 屏幕位 - anchor:锚点(图像局部坐标)恒与地理点的
  // 屏幕位重合。anchor 是纯像素常量(与 zoom 无关,S 库 relativeZoomScale
  // 默认关闭,像素偏移不随地图比例联动)→ 任意 zoom 下钉点不漂移。
  // 契约断言:imageTopLeft = 屏幕位 + offset(AMap 同款)——缩放前后地理点
  // 屏幕位变化,但 anchor 不变,图像相对点位移恒 = offset。
  const screenZ10 = { x: 500, y: 400 };
  const screenZ12 = { x: 620, y: 330 }; // 相机移动后的屏幕位
  const cases = [
    { w: 32, h: 40, offset: [-16, -40] },
    { w: 40, h: 40, offset: [-20, -20] },
    { w: 54, h: 54, offset: [-27, -27] },
    { w: 60, h: 60, offset: undefined },
  ];
  for (const c of cases) {
    const a = resolveTMapMarkerAnchor(c.w, c.h, c.offset);
    for (const screen of [screenZ10, screenZ12]) {
      const imageTopLeft = { x: screen.x - a.x, y: screen.y - a.y };
      // 契约:图像左上角 = 屏幕位 + offset(锚点恒钉地理点)
      assert.deepEqual(
        { x: imageTopLeft.x - (c.offset?.[0] ?? 0), y: imageTopLeft.y - (c.offset?.[1] ?? 0) },
        screen,
        `${c.w}×${c.h} 锚点恒钉地理点(缩放无关)`,
      );
    }
  }
});

test('createMarker(MultiMarker):LOD 摘挂后 click 分发不失效 + 隐藏期 setPosition 不重挂(可见性状态)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    let c1 = 0;
    let c2 = 0;
    const m1 = view.createMarker({ position: { lng: 120.16, lat: 30.28 }, onClick: () => c1++ });
    const m2 = view.createMarker({ position: { lng: 120.17, lat: 30.29 }, onClick: () => c2++ });
    const raw = m1.raw; // 共享实例
    const g1 = raw.geometries[0];
    const g2 = raw.geometries[1];
    raw.trigger('click', { geometry: { id: g1.id } });
    assert.equal(c1, 1, '摘挂前 click 分发正常');

    // LOD 隐藏 → 摘除 geometry(不可见不可点)
    m1.setVisible(false);
    assert.equal(raw.geometries.length, 1, '隐藏 = 摘除');

    // 隐藏期 setPosition(视口刷新/数据回放常见):不得把 geometry 重新挂回
    // (SDK updateGeometries 对不在 _idSet 的 id 会重新 add → 旧实现可见性泄漏:
    // 隐藏 marker 变可见 + 可点;ws-a 修复:隐藏期只改共享 geometry 对象)
    m1.setPosition({ lng: 1, lat: 2 });
    assert.equal(raw.geometries.length, 1, '隐藏期 setPosition 不得重挂(可见性状态保持)');
    assert.deepEqual({ ...raw.geometries[0].position }, { lat: 30.29, lng: 120.17 }, '实例上仍是 m2 的 geometry');
    // (物理点击隐藏 marker 由 SDK 侧杜绝:geometry 不在图层 + DOM 拾取元素已摘除,
    // hit-test 不会产出该 id 的载荷;mock 无拾取层,无法模拟,故不断言 mock 伪造载荷)

    // LOD 显示 → 重新挂载,同 id 同 geometry(带新位置),click 分发恢复
    m1.setVisible(true);
    assert.equal(raw.geometries.length, 2, '显示 = 重新挂载');
    assert.equal(raw.geometries[1], g1, '同 id 同 geometry 引用(无 id 冲突残留)');
    assert.deepEqual({ ...raw.geometries[1].position }, { lat: 2, lng: 1 }, '重新挂载带隐藏期更新的新位置');
    raw.trigger('click', { geometry: { id: g1.id } });
    assert.equal(c1, 2, '摘挂后同 id click 分发恢复(handler 跨 LOD 摘挂存活)');
    raw.trigger('click', { geometry: { id: g2.id } });
    assert.equal(c2, 1, '他 marker 不受影响');
  } finally {
    restore();
  }
});

test('createMarker(MultiMarker):同一 cb 注册到两个 marker → off/remove 按 id 精确解绑(不误伤)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const m1 = view.createMarker({ position: { lng: 120.16, lat: 30.28 } });
    const m2 = view.createMarker({ position: { lng: 120.17, lat: 30.29 } });
    const raw = m1.raw;
    const g1 = raw.geometries[0];
    const g2 = raw.geometries[1];
    // 同一 cb 注册到两个 marker(调用方复用回调的合法场景):
    // 旧实现 multiClickHandlers 以 cb 为键 → 后注册覆盖先注册 → off 解绑错位
    let clicks = 0;
    const shared = () => clicks++;
    m1.on('click', shared);
    m2.on('click', shared);
    raw.trigger('click', { geometry: { id: g1.id } });
    raw.trigger('click', { geometry: { id: g2.id } });
    assert.equal(clicks, 2, '两个 marker 各触发一次(共享 cb 双绑定)');

    // off(cb) 只解本 marker 的绑定,他 marker 不受影响
    m1.off('click', shared);
    raw.trigger('click', { geometry: { id: g1.id } });
    raw.trigger('click', { geometry: { id: g2.id } });
    assert.equal(clicks, 3, 'm1 解绑后仅 m2 触发(按 id 精确解绑)');

    // remove 同理:摘除 m2 的绑定,不残留
    m2.remove();
    raw.trigger('click', { geometry: { id: g2.id } });
    assert.equal(clicks, 3, 'remove 后 m2 不再触发');
    // 重复注册同 (cb, id) 去重(防 on 两次双触发)
    const m3 = view.createMarker({ position: { lng: 3, lat: 4 } });
    const g3 = raw.geometries[1];
    m3.on('click', shared);
    m3.on('click', shared);
    raw.trigger('click', { geometry: { id: g3.id } });
    assert.equal(clicks, 4, '同 (cb,id) 重复 on 只触发一次(去重)');
  } finally {
    restore();
  }
});

test('createMarker(MultiMarker):remove 后 setVisible 置空 no-op(防僵尸重挂)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const m1 = view.createMarker({ position: { lng: 120.16, lat: 30.28 } });
    const m2 = view.createMarker({ position: { lng: 120.17, lat: 30.29 } });
    const raw = m1.raw;
    m1.remove();
    assert.equal(raw.geometries.length, 1, 'm1 已摘除');
    // 已 remove 的 wrapper 再 setVisible(true):不得把已注销 geometry 重新挂回
    m1.setVisible(true);
    assert.equal(raw.geometries.length, 1, 'remove 后 setVisible no-op(不复活僵尸 marker)');
    assert.equal(raw.geometries[0].id, 'dm-mk-2', '实例上仅剩 m2');
    // 再创建新 marker 不受影响
    const m3 = view.createMarker({ position: { lng: 3, lat: 4 } });
    assert.equal(raw.geometries.length, 2, '新 marker 正常挂载');
    assert.equal(raw.geometries[1].id, 'dm-mk-3', 'id 递增不冲突');
  } finally {
    restore();
  }
});

// ------------------------------------------------------------
// ws-c(2026-08-22,bug 3/4):icon 候选链 + 锚点公式集成
// - bug 4「腾讯 poi 不带 icon」:logoUrl(favicon.im 实测无 CORS 头)预检失败
//   → faviconCandidatesFromUrl(careerUrl) 候选链(icon.horse 实测 ACAO:* 合规)
//   首个通过预检者作 icon.src;全败 → emoji 徽章;候选也记忆化(失败不重试)
// - bug 3「腾讯 poi 坐标偏移」:锚点 = -契约 offset(与 AMap/Baidu 逐像素一致),
//   状态尺寸零漂移(anchor 与 icon 尺寸无关)
// ------------------------------------------------------------

/** Image mock(与 icon-preflight.test.mjs 同款):failUrls → onerror,否则 onload。 */
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

const settle = () => new Promise((r) => setTimeout(r, 0));

/** 招聘 POI(logoUrl / careerUrl 可控)。 */
function makeRecruitPoi(id, logoUrl, careerUrl) {
  return makePoi(id, `公司${id}`, 120.1 + id.length * 0.01, 30.2, {
    company: { id: `c-${id}`, name: `公司${id}`, logo: '🏢', logoUrl, careerUrl },
  });
}

/** 假 tencent view:记录 createMarker opts,返回契约包装(与 icon-preflight.test.mjs 同款)。 */
function makeTencentView() {
  const calls = [];
  const view = {
    engine: { id: 'tencent' },
    isDestroyed: () => false,
    createMarker: (opts) => {
      calls.push(opts);
      return {
        on: () => {},
        setPosition: () => {},
        setZIndex: () => {},
        setVisible: () => {},
        remove: () => {},
      };
    },
  };
  return { view, calls };
}

test('resolveTMapIconSrc:纯函数——本地直通;unknown → fallback + 候选预检清单;候选去重', () => {
  const badge = 'data:image/svg+xml,%3Csvg%3Ebadge';
  const [faviconIm, iconHorse] = faviconCandidatesFromUrl('https://example.com/careers');
  // logoUrl 本地(data URL)→ 直通,零预检
  assert.deepEqual(resolveTMapIconSrc('data:image/svg+xml,%3Csvg%3Elogo', undefined, badge), {
    src: 'data:image/svg+xml,%3Csvg%3Elogo',
    toPreflight: [],
  });
  // 无 logoUrl → fallback(徽章),零预检
  assert.deepEqual(resolveTMapIconSrc(undefined, 'https://example.com/careers', badge), {
    src: badge,
    toPreflight: [],
  });
  // logoUrl unknown → fallback + 预检清单(logoUrl 与全部候选,一次重建升级到位)
  assert.equal(resolveTMapIconSrc(faviconIm, 'https://example.com/careers', badge).src, badge, 'unknown → fallback + 预检清单');
  const r = resolveTMapIconSrc(faviconIm, 'https://example.com/careers', badge);
  assert.ok(r.toPreflight.includes(faviconIm) && r.toPreflight.includes(iconHorse), 'unknown 候选入预检清单(favicon.im + icon.horse)');
  // 候选 === logoUrl 去重:same URL 不重复入清单
  const r2 = resolveTMapIconSrc(faviconIm, 'https://example.com/careers', badge);
  assert.equal(r2.toPreflight.filter((u) => u === faviconIm).length, 1, '候选与 logoUrl 相同 → 跳过不重复');
});

test('TMap icon 候选链:logoUrl 预检失败 → icon.horse 候选作 src(去重跳过同 URL)', async () => {
  const [faviconIm, iconHorse] = faviconCandidatesFromUrl('https://example.com/careers');
  const image = installImageMock({ failUrls: [faviconIm] }); // favicon.im 无 CORS 头 → 恒败
  try {
    // 先决:logoUrl(favicon.im)失败;icon.horse(实测 ACAO:* 合规)成功
    preflightRemoteIcon(faviconIm);
    await settle();
    assert.equal(remoteIconStatus(faviconIm), 'fail');
    preflightRemoteIcon(iconHorse);
    await settle();
    assert.equal(remoteIconStatus(iconHorse), 'ok');

    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', faviconIm, 'https://example.com/careers')]);
    assert.equal(
      calls[0].icon.src,
      iconHorse,
      'logoUrl 失败 → 候选链首个通过预检者(icon.horse)作 icon.src(公司 logo 显示)',
    );
    assert.deepEqual(calls[0].icon.size, [40, 40], '徽章 40×40 与 AMap 同视觉');
    assert.equal(image.calls.filter((i) => i.src === faviconIm).length, 1, '候选去重:同 URL 不重复预检');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('TMap icon 候选链:候选未预检 → 徽章降级 + logoUrl 与候选后台预检(下次重建升级真 logo)', async () => {
  const image = installImageMock({ failUrls: [faviconCandidatesFromUrl('https://example.com/careers')[0]] });
  try {
    const [faviconIm, iconHorse] = faviconCandidatesFromUrl('https://example.com/careers');
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', faviconIm, 'https://example.com/careers')]);
    assert.ok(String(calls[0].icon.src).startsWith('data:image/svg+xml'), '未定 → 徽章 dataURL 降级');
    assert.equal(image.calls.length, 2, 'logoUrl + 候选都后台预检(升级路径一次重建到位)');
    assert.deepEqual(image.calls.map((i) => i.src), [faviconIm, iconHorse]);
    await settle();
    assert.equal(remoteIconStatus(faviconIm), 'fail');
    assert.equal(remoteIconStatus(iconHorse), 'ok', 'icon.horse 预检成功(CORS 合规)');

    // 升级路径:新增同 URL 新 POI(LOD 重建形态)→ icon.horse 真 logo
    c.setPOIs([makeRecruitPoi('p1', faviconIm, 'https://example.com/careers'), makeRecruitPoi('p2', faviconIm, 'https://example.com/careers')]);
    assert.equal(calls[1].icon.src, iconHorse, '重建的新 marker 走候选链升级为真 logo');
    assert.equal(image.calls.length, 2, '失败记忆化 + ok 记忆化:不重复预检');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('TMap icon 候选链:logoUrl 已预检 ok → 直通真 src,不试候选', async () => {
  const image = installImageMock();
  try {
    const [faviconIm] = faviconCandidatesFromUrl('https://example.com/careers');
    preflightRemoteIcon(faviconIm);
    await settle();
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', faviconIm, 'https://example.com/careers')]);
    assert.equal(calls[0].icon.src, faviconIm, 'ok → 真 logo 直通');
    assert.equal(image.calls.length, 1, '候选不预检(logoUrl ok 即止)');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('TMap icon 候选链:全部失败 → emoji 徽章;失败记忆化不重试', async () => {
  const [faviconIm, iconHorse] = faviconCandidatesFromUrl('https://example.com/careers');
  const image = installImageMock({ failUrls: [faviconIm, iconHorse] });
  try {
    preflightRemoteIcon(faviconIm);
    preflightRemoteIcon(iconHorse);
    await settle();
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', faviconIm, 'https://example.com/careers'), makeRecruitPoi('p2', faviconIm, 'https://example.com/careers')]);
    assert.ok(String(calls[0].icon.src).startsWith('data:image/svg+xml'), '全败 → emoji 徽章');
    assert.ok(String(calls[1].icon.src).startsWith('data:image/svg+xml'));
    assert.equal(image.calls.length, 2, '失败记忆化:同会话不重试');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('TMap icon 候选链:无 careerUrl/无候选 → 徽章降级 + 仅 logoUrl 预检(ws-e 行为保持)', async () => {
  const image = installImageMock();
  try {
    const [faviconIm] = faviconCandidatesFromUrl('https://example.com/careers');
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', faviconIm, undefined)]);
    assert.ok(String(calls[0].icon.src).startsWith('data:image/svg+xml'), 'unknown → 徽章');
    assert.equal(image.calls.length, 1, '仅 logoUrl 预检');
    assert.equal(image.calls[0].src, faviconIm);
    c.destroy();
  } finally {
    image.restore();
  }
});

test('TMap icon:Domain POI 走图钉 dataURL icon(32×40)+ 基准底尖 offset(本地零预检)', async () => {
  const image = installImageMock();
  try {
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeDomainPoi('d1', '西湖', 120.1, 30.2)]);
    const icon = calls[0].icon;
    assert.ok(icon, 'Domain POI 在 TMap 下也走契约 icon(图钉,与 AMap 同视觉)');
    assert.ok(String(icon.src).startsWith('data:image/svg+xml'), '图钉 dataURL SVG(本地 CORS-clean)');
    assert.deepEqual(icon.size, [32, 40], '32×40 与 AMap 图钉同规格');
    assert.deepEqual(calls[0].offset, [-16, -40], '基准底尖 offset');
    assert.equal(image.calls.length, 0, 'dataURL 零预检');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('控制器×引擎集成:徽章/图钉/聚合 anchor 钉死契约点(20,20)/(16,40)/(27,27)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, restore } = installTMapDouble();
  try {
    delete ns.Marker;
    ns.MultiMarker = MockMultiMarker;
    const view = await createView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([
      makeRecruitPoi('p1', undefined, undefined), // 招聘徽章:emoji 徽章 dataURL 40×40,offset [-20,-20]
      makeDomainPoi('d1', '西湖', 120.15, 30.25), // 图钉 dataURL 32×40,offset [-16,-40]
    ]);
    const raw = c.getMarkerByPOIId('p1'); // 共享 MultiMarker 实例(wrapper.raw)
    const badgeStyleId = raw.geometries[0].styleId;
    const pinStyleId = raw.geometries[1].styleId;
    assert.notEqual(badgeStyleId, pinStyleId, '不同签名(尺寸/offset)→ 独立 styleId');
    assert.deepEqual(
      { ...raw.styles[badgeStyleId].opts.anchor },
      { x: 20, y: 20 },
      '徽章 40×40 offset[-20,-20] → anchor (20,20) 中心钉地理点(疑点 a/c)',
    );
    assert.deepEqual(
      { ...raw.styles[pinStyleId].opts.anchor },
      { x: 16, y: 40 },
      '图钉 32×40 offset[-16,-40] → anchor (16,40) 底尖钉地理点(疑点 b)',
    );
    // 聚合徽章(zoom≤8):createCityClusterMarker 同款参数 → 中心锚点
    const badge = createCityClusterMarker(view, { city: '杭州', count: 12, lng: 120.15, lat: 30.27 });
    assert.ok(badge, '聚合徽章创建成功');
    const clusterGeo = raw.geometries[raw.geometries.length - 1];
    assert.deepEqual(
      { ...raw.styles[clusterGeo.styleId].opts.anchor },
      { x: 27, y: 27 },
      '聚合 54×54 offset[-27,-27] → anchor (27,27) 中心钉地理点',
    );
    c.destroy();
    badge.remove();
  } finally {
    restore();
  }
});
