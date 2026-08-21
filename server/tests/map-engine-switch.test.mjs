// ============================================================
// switchMapEngine 编排测试(ws-f)— 引擎切换纯函数
//
// 引擎由参数注入(DI),全 mock、不真发网络。断言:
// - 编排顺序:from.destroy → to.load → to.createView(旧 view 先销毁)
// - state/style 回放:createView 收到捕获的相机状态与目标样式
// - POI/可见/选中/高亮回放:控制器在**新 view** 上重建(createView 之后)
// - style 降级:目标引擎对不支持样式回退 normal + console.warn(引擎语义,
//   编排透传不崩溃)
// - 同引擎守卫:created:false,不销毁不重建
// - 未配置引擎:不销毁旧 view,直接抛错
// - from=null(首次切换)/无回放数据:不创建控制器,新 view 零 marker
// ============================================================

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { switchMapEngine } from '../src/lib/map-engine/switch.ts';

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
 */
function makeMockView(engine, { id, events: log = events, style: viewStyle = null } = {}) {
  const view = {
    id: id ?? `view-${++seq}`,
    engine,
    destroyed: false,
    style: viewStyle,
    markers: [],
    destroy() {
      this.destroyed = true;
      log.push(`destroy:${this.id}`);
    },
    createMarker(markerOpts) {
      const marker = {
        opts: markerOpts,
        shown: true,
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
      return { raw: marker };
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

test('编排顺序:from.destroy 先于 to.load/createView;返回新 view + created:true', async () => {
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
  // 顺序不可交换:destroy → load → createView
  assert.deepEqual(events, ['destroy:from', 'load:tencent', 'createView:tencent']);
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

  // 控制器重建顺序:destroy → load → createView → marker 回放
  assert.deepEqual(events.slice(0, 3), ['destroy:from', 'load:tencent', 'createView:tencent']);
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
