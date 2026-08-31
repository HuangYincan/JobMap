// ============================================================
// switchMapEngine 编排测试(ws-f;ws-3 安全切换重构)
//
// 引擎由参数注入(DI),全 mock、不真发网络。断言:
// - 编排顺序:to.load → from.destroy → to.createView(「先就绪、后销毁」,
//   脚本加载最耗时阶段旧 view 全程存活;失败路径回滚重建旧引擎视图)
// - state/style 回放:createView 收到捕获的相机状态与目标样式
// - POI/可见/选中/高亮回放:控制器在**新 view** 上重建(createView 之后)
// - style 降级:目标引擎对不支持样式回退 normal + console.warn(引擎语义,
//   编排透传不崩溃)
// - 同引擎守卫:created:false,不销毁不重建
// - 未配置引擎:不销毁旧 view,直接抛错
// - from=null(首次切换)/无回放数据:不创建控制器,新 view 零 marker
// - 失败回滚:目标 createView 抛错 → 旧引擎视图重建(rolledBack + error);
//   回滚也失败 → 抛错(容器无视图,调用方清 ref 暴露重试)
// - 取消 signal:load 阶段置位 → 放弃且旧 view 零触碰;createView 阶段置位
//   → 已建视图销毁;重入取代(两次切换,后发置前发 signal → 后发赢)
// ============================================================

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { switchMapEngine } from '../src/lib/map-engine/switch.ts';
import { TENCENT_ENGINE } from '../src/lib/map-engine/tencent/tencent-engine.ts';

/** 控制器 Domain 图钉需要厂商命名空间(Icon/Size/Pixel 逃生舱) */
const NS = {
  Icon: class Icon {},
  Size: class Size {},
  Pixel: class Pixel {},
};

/** 捕获视图侧事件的共享日志(makeMockView/makeMockEngine 都往里推) */
const events = [];

let seq = 0;

/**
 * mock MapView:记录 destroy/createMarker 事件;marker 带 show/hide/zIndex 探针
 * (POIMarkerController 观察点:可见集 → shown,选中/高亮 → zIndex)。
 * @param {object} engine 所属引擎
 * @param {{ id?: string, events?: string[], style?: string|null,
 *   detachVisibility?: boolean }} opts
 *   detachVisibility=true 模拟 TMap MultiMarker 摘挂语义:setVisible 隐藏 =
 *   从图层摘除(attached=false),显示 = 重新挂载 —— 与 AMap show/hide 同契约
 *   不同语义,用于回放双向对称性断言(ws-b bug 4)。
 */
function makeMockView(engine, { id, events: log = events, style: viewStyle = null, detachVisibility = false } = {}) {
  const view = {
    id: id ?? `view-${++seq}`,
    engine,
    destroyed: false,
    style: viewStyle,
    markers: [],
    getState() {
      // 与调用方快照同值:只保证契约路径可走(再捕获与兜底结果一致)
      return STATE;
    },
    destroy() {
      this.destroyed = true;
      log.push(`destroy:${this.id}`);
    },
    createMarker(markerOpts) {
      const marker = {
        opts: markerOpts,
        shown: true,
        attached: true,
        zIndex: null,
        on() {},
        off() {},
        setzIndex(z) {
          this.zIndex = z;
        },
        setIcon() {},
        setPosition() {},
        setContent() {},
        setLabel() {},
        setOffset() {},
        setMap() {},
        show() {
          this.shown = true;
        },
        hide() {
          this.shown = false;
        },
      };
      view.markers.push(marker);
      log.push(`marker:${view.id}`);
      // ws-2 控制器契约化:mock 必须返回 MapMarker 包装形态(方法转发到探针 marker,
      // 控制器只经契约调 wrapper——setZIndex/setVisible/on/remove,不直调裸实例)
      return {
        raw: marker,
        setPosition: (p) => marker.setPosition([p.lng, p.lat]),
        setContent: (html) => marker.setContent(html),
        setZIndex: (z) => marker.setzIndex(z),
        setVisible: (v) => {
          if (detachVisibility) {
            // TMap MultiMarker 摘挂语义:隐藏 = 从共享实例摘除(attached=false),
            // 显示 = 重新挂载;shown 与 attached 同源
            marker.shown = Boolean(v);
            marker.attached = Boolean(v);
            return;
          }
          (v ? marker.show() : marker.hide());
        },
        on: (event, cb) => marker.on(event, cb),
        off: (event, cb) => marker.off(event, cb),
        remove: () => {
          marker.attached = false;
          marker.setMap(null);
        },
      };
    },
  };
  view.raw = view; // 逃生舱(=自身,与 engine-mock 同语义)
  return view;
}

/**
 * mock MapEngine(DI 注入):load/createView 只记日志不真发网络。
 * @param {string} id 引擎 id(amap/tencent/baidu)
 * @param {{ events?: string[], overrides?: object }} opts
 */
function makeMockEngine(id, { events: log = events, overrides = {} } = {}) {
  const engine = {
    id,
    label: `engine-${id}`,
    namespace: 'NS',
    coordSystem: 'gcj02',
    keyVar: 'NEXT_PUBLIC_AMAP_KEY',
    isConfigured: () => true,
    isLoaded: () => false,
    async load() {
      log.push(`load:${id}`);
    },
    async createView(opts) {
      log.push(`createView:${id}`);
      return makeMockView(engine, { style: opts.style });
    },
    search: {
      searchPOI: async () => [],
      fetchSuggestions: async () => [],
      getCurrentPosition: async () => null,
      geocodeAddress: async () => null,
    },
    ...overrides,
  };
  return engine;
}

/** Domain POI 工厂(kind: 'domain' 走图标路径,需 NS 命名空间) */
function makePOI(id, index = 0) {
  return {
    id,
    name: `POI ${id}`,
    kind: 'domain',
    mode: 'domain',
    source: 'amap',
    category: '测试',
    location: { lng: 120.1 + index * 0.01, lat: 30.2 + index * 0.01 },
  };
}

const container = { tagName: 'DIV', style: {} };
const STATE = { center: { lng: 121.47, lat: 31.23 }, zoom: 11, pitch: 45, rotation: 30 };

afterEach(() => {
  events.length = 0;
  delete globalThis.window;
});

test('编排顺序:to.load 先于 from.destroy/createView(先就绪后销毁);返回新 view + created:true', async () => {
  globalThis.window = { NS };
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const to = makeMockEngine('tencent');

  const result = await switchMapEngine({
    from,
    to,
    container,
    state: STATE,
    style: 'normal',
  });

  assert.equal(result.created, true);
  assert.equal(result.view.engine, to);
  assert.notEqual(result.view, from);
  assert.equal(from.destroyed, true, '旧 view 必须已销毁');
  // 顺序不可交换:load(最耗时,旧 view 存活)→ destroy → createView
  assert.deepEqual(events, ['load:tencent', 'destroy:from', 'createView:tencent']);
});

test('state/style 回放:createView 收到捕获的相机状态与目标样式', async () => {
  globalThis.window = { NS };
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const to = makeMockEngine('tencent');
  const captured = {};
  to.createView = async (opts) => {
    Object.assign(captured, opts);
    events.push('createView:tencent');
    return makeMockView(to);
  };

  await switchMapEngine({
    from,
    to,
    container,
    state: STATE,
    style: 'satellite',
  });

  assert.deepEqual(captured, {
    container,
    center: STATE.center,
    zoom: STATE.zoom,
    pitch: STATE.pitch,
    rotation: STATE.rotation,
    style: 'satellite',
  });
});

test('控制器回放:POI 集/可见集/选中/高亮在 createView 之后于新 view 重建', async () => {
  globalThis.window = { NS };
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const to = makeMockEngine('tencent');
  const pois = [makePOI('p1', 0), makePOI('p2', 1), makePOI('p3', 2)];
  const visibleIds = new Set(['p1', 'p2']);

  const result = await switchMapEngine({
    from,
    to,
    container,
    state: STATE,
    style: 'normal',
    pois,
    visibleIds,
    selectedId: 'p1',
    highlightedId: 'p3',
  });

  const view = result.view;
  assert.equal(view.markers.length, 3, '3 个 POI → 3 个 marker(控制器已重建)');

  // 控制器重建顺序:load → destroy → createView → marker 回放
  assert.deepEqual(events.slice(0, 3), ['load:tencent', 'destroy:from', 'createView:tencent']);
  const createViewIdx = events.indexOf('createView:tencent');
  const firstMarkerIdx = events.findIndex((e) => e.startsWith('marker:'));
  assert.ok(firstMarkerIdx > createViewIdx, 'marker 回放必须发生在 createView 之后');

  // 可见集:实例保留,只 show/hide(p1/p2 可见,p3 隐藏)
  assert.equal(view.markers[0].shown, true);
  assert.equal(view.markers[1].shown, true);
  assert.equal(view.markers[2].shown, false);
  // 选中 p1 → zIndex 100;高亮 p3 → zIndex 80;普通 p2 → 10
  assert.equal(view.markers[0].zIndex, 100);
  assert.equal(view.markers[1].zIndex, 10);
  assert.equal(view.markers[2].zIndex, 80);
});

test('visiblePOIs 缺省 visibleIds 时派生可见集', async () => {
  globalThis.window = { NS };
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const to = makeMockEngine('tencent');
  const pois = [makePOI('p1', 0), makePOI('p2', 1)];

  const result = await switchMapEngine({
    from,
    to,
    container,
    state: STATE,
    style: 'normal',
    pois,
    visiblePOIs: [pois[0]],
  });

  assert.equal(result.view.markers.length, 2);
  assert.equal(result.view.markers[0].shown, true);
  assert.equal(result.view.markers[1].shown, false, '不在 visiblePOIs → 隐藏');
});

test('style 降级:目标引擎对不支持样式回退 normal + console.warn(编排透传不崩溃)', async () => {
  globalThis.window = { NS };
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const to = makeMockEngine('baidu');
  // baidu 语义:createView 对 whitesmoke 回退 normal + warn
  to.createView = async (opts) => {
    events.push('createView:baidu');
    if (opts.style === 'whitesmoke') {
      console.warn('[map-engine] baidu 不支持底图样式 whitesmoke,回退 normal');
      return makeMockView(to, { style: 'normal' });
    }
    return makeMockView(to, { style: opts.style });
  };
  const warns = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const result = await switchMapEngine({
      from,
      to,
      container,
      state: STATE,
      style: 'whitesmoke',
    });

    assert.equal(result.created, true);
    assert.equal(result.view.style, 'normal', '引擎侧降级落地到新 view');
    assert.equal(warns.length, 1);
    assert.match(warns[0], /回退 normal/);
  } finally {
    console.warn = originalWarn;
  }
});

test('同引擎守卫:to.id === from.engine.id → created:false,不销毁不重建', async () => {
  const engine = makeMockEngine('amap');
  const from = makeMockView(engine, { id: 'from' });

  const result = await switchMapEngine({
    from,
    to: engine,
    container,
    state: STATE,
    style: 'normal',
  });

  assert.equal(result.created, false);
  assert.equal(result.view, from, '原视图原样返回');
  assert.equal(from.destroyed, false);
  assert.deepEqual(events, [], 'load/createView 零调用');
});

test('未配置引擎:抛错且不销毁旧 view(load/createView 零调用)', async () => {
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const to = makeMockEngine('tencent', {
    overrides: { isConfigured: () => false },
  });

  await assert.rejects(
    switchMapEngine({ from, to, container, state: STATE, style: 'normal' }),
    /目标引擎 tencent 未配置/,
  );
  assert.equal(from.destroyed, false, '未配置引擎绝不能先销毁旧 view');
  assert.deepEqual(events, []);
});

test('from=null(首次切换):直接 load/createView;无回放数据不创建控制器', async () => {
  globalThis.window = { NS };
  const to = makeMockEngine('amap');

  const result = await switchMapEngine({
    from: null,
    to,
    container,
    state: STATE,
    style: 'normal',
  });

  assert.equal(result.created, true);
  assert.deepEqual(events, ['load:amap', 'createView:amap']);
  assert.equal(result.view.markers.length, 0, '无回放数据 → 零 marker(交给 usePOIMap)');
});

// ---------------------------------------------------------------------------
// ws-3:失败回滚 / 取消 signal / 重入取代
// ---------------------------------------------------------------------------

test('失败回滚:目标 createView 抛错 → 重建旧引擎视图(rolledBack:true + error + POI 回放)', async () => {
  globalThis.window = { NS };
  const amapEngine = makeMockEngine('amap');
  const from = makeMockView(amapEngine, { id: 'from' });
  const to = makeMockEngine('tencent', {
    overrides: {
      createView: async () => {
        events.push('createView:tencent');
        throw new Error('TMap init 失败(模拟)');
      },
    },
  });

  const result = await switchMapEngine({
    from,
    to,
    container,
    state: STATE,
    style: 'normal',
    pois: [makePOI('p1', 0)],
  });

  assert.equal(result.created, false);
  assert.equal(result.rolledBack, true, '回滚成功标记');
  assert.equal(result.view.engine, amapEngine, '回滚视图来自旧引擎');
  assert.equal(result.view.destroyed, false);
  assert.equal(result.view.markers.length, 1, '回滚视图同样回放 POI 控制器');
  assert.match(result.error?.message ?? '', /TMap init 失败/);
  // 顺序:load → destroy → createView(失败)→ 回滚 createView(旧引擎)→ 回放
  assert.deepEqual(events.slice(0, 4), [
    'load:tencent',
    'destroy:from',
    'createView:tencent',
    'createView:amap',
  ]);
  assert.equal(events.length, 5, '回滚视图同样回放 POI 控制器');
  assert.match(events[4], /^marker:/);
});

test('失败回滚:目标 load 抛错 → 旧 view 不销毁,rolledBack 保留(不上抛)', async () => {
  globalThis.window = { NS };
  const amapEngine = makeMockEngine('amap');
  const from = makeMockView(amapEngine, { id: 'from' });
  const to = makeMockEngine('tencent', {
    overrides: {
      load: async () => {
        events.push('load:tencent');
        throw new Error('[map-engine] baidu load 失败(script-blocked-by-client):BMapGL script failed to load');
      },
    },
  });

  const result = await switchMapEngine({
    from,
    to,
    container,
    state: STATE,
    style: 'normal',
  });

  assert.equal(result.created, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.view, from, 'load 失败时旧 view 原样保留');
  assert.equal(from.destroyed, false, '尚未 destroy,不得拆掉可用底图');
  assert.match(result.error?.message ?? '', /script-blocked-by-client/);
  assert.deepEqual(events, ['load:tencent']);
});

test('失败回滚:回滚也失败 → 抛错(容器无视图,调用方清 ref 暴露重试)', async () => {
  globalThis.window = { NS };
  const amapEngine = makeMockEngine('amap', {
    overrides: {
      createView: async () => {
        events.push('createView:amap');
        throw new Error('AMap 重建也失败(模拟)');
      },
    },
  });
  const from = makeMockView(amapEngine, { id: 'from' });
  const to = makeMockEngine('tencent', {
    overrides: {
      createView: async () => {
        events.push('createView:tencent');
        throw new Error('TMap init 失败(模拟)');
      },
    },
  });

  await assert.rejects(
    switchMapEngine({ from, to, container, state: STATE, style: 'normal' }),
    /引擎切换失败:目标 tencent createView 失败,回滚 amap 视图也失败: TMap init 失败\(模拟\)/,
  );
  assert.deepEqual(events, ['load:tencent', 'destroy:from', 'createView:tencent', 'createView:amap']);
});

test('from=null 且目标 createView 失败:无旧视图可回滚 → 抛错', async () => {
  globalThis.window = { NS };
  const to = makeMockEngine('tencent', {
    overrides: {
      createView: async () => {
        events.push('createView:tencent');
        throw new Error('TMap init 失败(模拟)');
      },
    },
  });

  await assert.rejects(
    switchMapEngine({ from: null, to, container, state: STATE, style: 'normal' }),
    /无旧视图可回滚/,
  );
  assert.deepEqual(events, ['load:tencent', 'createView:tencent']);
});

test('取消 signal:load 阶段置位 → 放弃,旧 view 零触碰(aborted 返回)', async () => {
  globalThis.window = { NS };
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const to = makeMockEngine('tencent');
  const signal = { aborted: false };
  to.load = async () => {
    events.push('load:tencent');
    signal.aborted = true; // 更新意图在 load 期间到达
  };

  const result = await switchMapEngine({
    from,
    to,
    container,
    state: STATE,
    style: 'normal',
    signal,
  });

  assert.equal(result.aborted, true);
  assert.equal(result.view, null);
  assert.equal(from.destroyed, false, 'load 阶段取消:旧 view 保留');
  assert.deepEqual(events, ['load:tencent']);
});

test('取消 signal:createView 在飞期间置位 → 已建视图销毁(aborted 返回)', async () => {
  globalThis.window = { NS };
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const to = makeMockEngine('tencent');
  const signal = { aborted: false };
  let createdView;
  to.createView = async () => {
    events.push('createView:tencent');
    signal.aborted = true; // 更新意图在 createView 在飞期间到达
    const v = makeMockView(to, { id: 'created' });
    createdView = v;
    return v;
  };

  const result = await switchMapEngine({
    from,
    to,
    container,
    state: STATE,
    style: 'normal',
    signal,
  });

  assert.equal(result.aborted, true);
  assert.equal(result.view, null);
  assert.equal(createdView.destroyed, true, '已建视图必须销毁(容器由更新意图接管)');
  assert.equal(from.destroyed, true, '旧 view 已销毁');
  assert.deepEqual(events, ['load:tencent', 'destroy:from', 'createView:tencent', 'destroy:created']);
});

test('重入取代:后发意图置前发 signal → 前发让路,后发赢(两次切换不丢第二击)', async () => {
  globalThis.window = { NS };
  const from = makeMockView(makeMockEngine('amap'), { id: 'from' });
  const toA = makeMockEngine('tencent');
  const toB = makeMockEngine('baidu');
  // A 的 load 挂起(慢脚本加载):期间 B 发起(置 A 的 signal)
  let releaseLoad;
  toA.load = () => new Promise((resolve) => {
    events.push('load:tencent');
    releaseLoad = resolve;
  });
  const signalA = { aborted: false };

  const pA = switchMapEngine({
    from,
    to: toA,
    container,
    state: STATE,
    style: 'normal',
    signal: signalA,
  });
  // 更新意图 B 到达:让路 A(「最新意图优先」的早期让路)
  signalA.aborted = true;
  releaseLoad();

  const resultA = await pA;
  assert.equal(resultA.aborted, true, '前发切换让路');
  assert.equal(resultA.view, null);
  assert.equal(from.destroyed, false, 'A 未触碰旧 view');

  // B 正常落地
  const resultB = await switchMapEngine({
    from,
    to: toB,
    container,
    state: STATE,
    style: 'normal',
  });
  assert.equal(resultB.created, true, '后发切换赢');
  assert.equal(resultB.view.engine, toB);
  assert.equal(from.destroyed, true, 'B 才销毁旧 view');
  assert.deepEqual(events, ['load:tencent', 'load:baidu', 'destroy:from', 'createView:baidu']);
});

// ---------------------------------------------------------------------------
// ws-b(2026-08-22):bug 2 滚轮平滑 + bug 4 切回高德 POI 消失
// ---------------------------------------------------------------------------

// ------------------------------------------------------------
// bug 2:TMap 滚轮平滑 —— 构造选项核实与显式启用
// SDK v1.8.0.2 实包(/tmp/tmap-gljs.js,2.2MB)核实:
// - **smoothWheelZoom 选项不存在**(全包 0 处命中;Leaflet 2D 适配层
//   zy.mergeOptions({scrollWheelZoom:!0,...}) 是另一地图路径,与 GL 无关);
// - 滚轮平滑是 **SDK 内建行为**:Map 选项 `scrollable`(MAP_3D/MAP_2D 默认均
//   true,运行期 setScrollable(bool) 切换)启用滚轮处理器;输入分类 wheel
//   (鼠标滚轮)→ zoomTo({duration:200, smoothEasing:!0, delayEndEvents:100})
//   平滑动画;trackpad(触控板/像素增量)→ duration:0 即时应答(SDK 设计);
// - 显式传 scrollable:true = 自文档化 + 防御未来 SDK 默认值漂移。
// ------------------------------------------------------------

/** 最小 TMap 命名空间 double:捕获 Map 构造 options(createView 路径足够) */
function installTMapConstructorDouble() {
  const captured = { opts: null };
  const container = {
    tagName: 'DIV',
    style: {},
    querySelectorAll: () => [],
  };
  class FakeMap {
    constructor(containerEl, opts = {}) {
      captured.opts = opts;
      this.container = containerEl;
      this.listeners = new Map();
      // 模拟异步初始化:idle 就绪(createView 的 waitForMapReady 依赖)
      setTimeout(() => this.trigger('idle'), 5);
    }
    on(event, cb) {
      const list = this.listeners.get(event) ?? [];
      list.push(cb);
      this.listeners.set(event, list);
      return () => this.off(event, cb);
    }
    off(event, cb) {
      const list = this.listeners.get(event) ?? [];
      this.listeners.set(event, list.filter((f) => f !== cb));
    }
    trigger(event, payload) {
      for (const cb of this.listeners.get(event) ?? []) cb(payload);
    }
    getContainer() {
      return this.container;
    }
    getControl() {
      return null;
    }
    removeControl() {}
    setShowControl() {}
    destroy() {}
  }
  globalThis.TMap = {
    Map: FakeMap,
    LatLng: class TMapLatLng {
      constructor(lat, lng) {
        this.lat = lat;
        this.lng = lng;
      }
    },
    search: {
      searchPOI: async () => [],
      fetchSuggestions: async () => [],
      getCurrentPosition: async () => null,
      geocodeAddress: async () => null,
    },
  };
  globalThis.window = globalThis;
  return { captured, container };
}

const TENCENT_KEY = 'NEXT_PUBLIC_TENCENT_JSAPI_KEY';

test('bug2 滚轮平滑:TMap 构造显式 scrollable:true(SDK 无 smoothWheelZoom 选项,内建 200ms 平滑)', async () => {
  const { captured, container } = installTMapConstructorDouble();
  process.env[TENCENT_KEY] = 'test-key';
  try {
    const view = await TENCENT_ENGINE.createView({
      container,
      center: { lng: 120.15, lat: 30.27 },
      zoom: 12,
      pitch: 30,
      rotation: 45,
      style: 'normal',
    });
    assert.equal(captured.opts.scrollable, true, '滚轮显式启用(自文档化 + 防默认漂移)');
    assert.equal(captured.opts.showControl, false, '默认控件禁用语义不变');
    assert.equal(captured.opts.zoom, 12);
    assert.equal(captured.opts.pitch, 30);
    assert.equal(captured.opts.rotation, 45);
    assert.deepEqual(captured.opts.baseMap, { type: 'vector', features: ['base', 'building3d', 'label', 'arrow'] }, '矢量底图排除 point POI 图标层(ws-j 混合块根因)');
    // 断言构造选项里没有不存在的 smoothWheelZoom(文档化 SDK 核实:选项不存在,
    // 不传幻觉键——平滑由内建滚轮处理器承担)
    assert.equal('smoothWheelZoom' in captured.opts, false);
    view.destroy();
  } finally {
    delete process.env[TENCENT_KEY];
    delete globalThis.window;
    delete globalThis.TMap;
  }
});

// ------------------------------------------------------------
// bug 4:切回高德 POI 消失 —— 回放双向对称性 + 可见性语义映射
//
// 核查结论(switch.ts replay 链):replayController 引擎无关、双向同代码路径
// (POI 集 → 可见集 → 选中 → 高亮,与 usePOIMap.applySync 同口径);可见性
// 语义映射(AMap show/hide vs TMap MultiMarker add/remove 摘挂)经 MapMarker
// 契约 setVisible 收敛,回放不感知厂商差异。以下断言:
// 1. A→T 与 T→A 两个方向以相同回放数据切换,最终 marker 状态完全一致
//    (数量/可见/选中/高亮);
// 2. TMap 摘挂语义:隐藏 marker attached=false(不在图层,天然不可点击),
//    显示 marker 重新挂载 —— 与 AMap show/hide 同契约不同实现;
// 3. work 风格 LOD 可见集(部分可见)在双向回放后精确恢复,零漂移。
// ------------------------------------------------------------

test('bug4 双向回放对称性:A→T 与 T→A 相同回放 → 最终 marker 状态一致(含 TMap 摘挂语义)', async () => {
  globalThis.window = { NS };
  const pois = [makePOI('p1', 0), makePOI('p2', 1), makePOI('p3', 2), makePOI('p4', 3)];
  // work 风格 LOD 可见集:公司 pin 按 zoom tier 部分可见
  const visibleIds = new Set(['p1', 'p3']);
  const replay = { pois, visibleIds, selectedId: 'p2', highlightedId: 'p4' };

  const amapEngine = makeMockEngine('amap');
  const fromA = makeMockView(amapEngine, { id: 'from-amap' });
  // 目标腾讯视图用摘挂语义(忠实 TMap MultiMarker setVisible = add/remove)
  const tencentEngine = makeMockEngine('tencent', {
    overrides: {
      createView: async (opts) => {
        events.push('createView:tencent');
        return makeMockView(tencentEngine, { style: opts.style, detachVisibility: true });
      },
    },
  });
  const r1 = await switchMapEngine({
    from: fromA,
    to: tencentEngine,
    container,
    state: STATE,
    style: 'normal',
    ...replay,
  });

  // T→A 方向:旧视图 = 摘挂语义(带隐藏 marker),目标 = AMap(show/hide)
  const fromT = makeMockView(tencentEngine, { id: 'from-tencent', detachVisibility: true });
  const amapEngine2 = makeMockEngine('amap');
  const r2 = await switchMapEngine({
    from: fromT,
    to: amapEngine2,
    container,
    state: STATE,
    style: 'normal',
    ...replay,
  });

  for (const [label, r] of [['A→T', r1], ['T→A', r2]]) {
    const view = r.view;
    assert.equal(r.created, true, `${label}:切换落地`);
    assert.equal(view.markers.length, 4, `${label}:POI 集完整回放`);
    // 可见集恢复(p1/p3 可见,p2/p4 隐藏)
    assert.equal(view.markers[0].shown, true, `${label}:p1 可见`);
    assert.equal(view.markers[1].shown, false, `${label}:p2 隐藏(LOD)`);
    assert.equal(view.markers[2].shown, true, `${label}:p3 可见`);
    assert.equal(view.markers[3].shown, false, `${label}:p4 隐藏(LOD)`);
    // 选中 p2 → zIndex 100;高亮 p4 → zIndex 80;普通 → 10
    assert.equal(view.markers[0].zIndex, 10, `${label}:p1 普通层级`);
    assert.equal(view.markers[1].zIndex, 100, `${label}:p2 选中层级`);
    assert.equal(view.markers[2].zIndex, 10, `${label}:p3 普通层级`);
    assert.equal(view.markers[3].zIndex, 80, `${label}:p4 高亮层级`);
  }

  // TMap 摘挂语义落实:隐藏 marker 已从图层摘除(attached=false,不可点击),
  // 显示 marker 挂载(attached=true)—— 可见性语义映射在回放后精确恢复
  assert.equal(r1.view.markers[0].attached, true);
  assert.equal(r1.view.markers[1].attached, false, 'TMap 隐藏 = 摘除(不在图层)');
  assert.equal(r1.view.markers[2].attached, true);
  assert.equal(r1.view.markers[3].attached, false);
  // 切回高德:同一 visibleIds 经 show/hide 语义落地,结果一致(无语义丢失)
  assert.equal(r2.view.markers[1].attached, true, 'AMap show/hide:实例保留仅隐藏');
  assert.equal(r2.view.markers[1].shown, false);
});

test('bug4 无可见集回放:visibleIds 缺省 = 全部显示(双向一致,不误藏 marker)', async () => {
  globalThis.window = { NS };
  const pois = [makePOI('p1', 0), makePOI('p2', 1)];
  const amapEngine = makeMockEngine('amap');
  const tencentEngine = makeMockEngine('tencent', {
    overrides: {
      createView: async (opts) => {
        events.push('createView:tencent');
        return makeMockView(tencentEngine, { style: opts.style, detachVisibility: true });
      },
    },
  });
  const fromA = makeMockView(amapEngine, { id: 'from-amap' });
  const r1 = await switchMapEngine({ from: fromA, to: tencentEngine, container, state: STATE, style: 'normal', pois });
  assert.equal(r1.view.markers[0].shown, true);
  assert.equal(r1.view.markers[0].attached, true);
  assert.equal(r1.view.markers[1].shown, true);

  const fromT = makeMockView(tencentEngine, { id: 'from-tencent', detachVisibility: true });
  const amapEngine2 = makeMockEngine('amap');
  const r2 = await switchMapEngine({ from: fromT, to: amapEngine2, container, state: STATE, style: 'normal', pois });
  assert.equal(r2.view.markers[0].shown, true);
  assert.equal(r2.view.markers[1].shown, true);
});

// ------------------------------------------------------------
// bug 4:work 视口重建触发 —— 引擎切换后视口监听必须随新 view 重绑
// (use-work-viewport 原只随 mapReady 绑定一次 → 切换后新 view 无
// moveend/zoomend 监听,domain 视口刷新/挂载对齐静默失效;ws-b 修复为
// 经引擎总线订阅活跃 view,监听按 view 实例重绑)
// ------------------------------------------------------------

test('bug4 work 视口重建触发:use-work-viewport 监听按引擎视图重绑(总线订阅 + effect 依赖)', () => {
  const src = readFileSync(new URL('../src/hooks/use-work-viewport.ts', import.meta.url), 'utf8');
  // 引擎总线订阅:活跃 view 变化 → 重渲染 → 重绑
  assert.match(src, /subscribeEngineBus/);
  assert.match(src, /setEngineView\(value\?\.view/);
  // 视口监听 effect 依赖新 view(切换后重绑 moveend/zoomend)
  assert.match(src, /map\.on\("moveend", onViewChange\)/);
  assert.match(src, /\}, \[mapReady, engineView\]\);/);
  // 挂载对齐判定同样随引擎视图重跑
  assert.match(src, /\}, \[mapReady, geoSettled, mode, engineView\]\);/);
  // 无总线(useMapEngine 未挂载)时退化为原 mapReady 一次性绑定,不硬依赖
  assert.match(src, /无总线/);
});
