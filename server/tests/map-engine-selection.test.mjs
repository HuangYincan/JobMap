// ============================================================
// 引擎注册/选择测试 — MapEngine 内核
// env 组合(全配/单配/零配)下 resolveEngine 优先级;
// preference 优先 / 未配置回落 / 零配返回 null;SSR 守卫。
// ============================================================

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMAP_ENGINE,
  TENCENT_ENGINE,
  BAIDU_ENGINE,
  ENGINE_PRIORITY,
  getConfiguredEngines,
  getEngine,
  resolveEngine,
} from '../src/lib/map-engine/engine-registry.ts';
import {
  readEnginePreference,
  writeEnginePreference,
} from '../src/lib/map-engine/engine-preference.ts';
import { installEngineMock, MockCircle, MockMarker } from './fixtures/engine-mock.mjs';

const ENV_KEYS = {
  amap: 'NEXT_PUBLIC_AMAP_KEY',
  tencent: 'NEXT_PUBLIC_TENCENT_JSAPI_KEY',
  baidu: 'NEXT_PUBLIC_BAIDU_AK',
};

/** 按掩码设置引擎 env(只写/只删,不打印 key 值) */
function setEngineEnv(mask) {
  for (const [id, key] of Object.entries(ENV_KEYS)) {
    if (mask[id]) process.env[key] = 'test-key';
    else delete process.env[key];
  }
}

/** 内存版 localStorage(引擎偏好测试用) */
function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

afterEach(() => {
  for (const key of Object.values(ENV_KEYS)) delete process.env[key];
  delete globalThis.window;
});

test('三引擎描述:label/namespace/coordSystem/keyVar 与契约一致,优先级固定', () => {
  assert.equal(AMAP_ENGINE.label, '高德地图');
  assert.equal(AMAP_ENGINE.namespace, 'AMap');
  assert.equal(AMAP_ENGINE.coordSystem, 'gcj02');
  assert.equal(AMAP_ENGINE.keyVar, 'NEXT_PUBLIC_AMAP_KEY');

  assert.equal(TENCENT_ENGINE.label, '腾讯地图');
  assert.equal(TENCENT_ENGINE.namespace, 'TMap');
  assert.equal(TENCENT_ENGINE.coordSystem, 'gcj02');
  assert.equal(TENCENT_ENGINE.keyVar, 'NEXT_PUBLIC_TENCENT_JSAPI_KEY');

  assert.equal(BAIDU_ENGINE.label, '百度地图');
  assert.equal(BAIDU_ENGINE.namespace, 'BMapGL');
  assert.equal(BAIDU_ENGINE.coordSystem, 'bd09');
  assert.equal(BAIDU_ENGINE.keyVar, 'NEXT_PUBLIC_BAIDU_AK');

  assert.deepEqual(ENGINE_PRIORITY, ['amap', 'tencent', 'baidu']);
});

test('isConfigured 跟随 env 掩码(运行时读 process.env)', () => {
  setEngineEnv({ amap: true });
  assert.equal(AMAP_ENGINE.isConfigured(), true);
  assert.equal(TENCENT_ENGINE.isConfigured(), false);
  assert.equal(BAIDU_ENGINE.isConfigured(), false);

  setEngineEnv({ tencent: true, baidu: true });
  assert.equal(AMAP_ENGINE.isConfigured(), false);
  assert.equal(TENCENT_ENGINE.isConfigured(), true);
  assert.equal(BAIDU_ENGINE.isConfigured(), true);
});

test('全配:按优先级过滤,resolveEngine 取第一个,preferred 生效', () => {
  setEngineEnv({ amap: true, tencent: true, baidu: true });
  assert.deepEqual(
    getConfiguredEngines().map((e) => e.id),
    ['amap', 'tencent', 'baidu'],
  );
  assert.equal(resolveEngine()?.id, 'amap');
  assert.equal(resolveEngine('tencent')?.id, 'tencent');
  assert.equal(resolveEngine('baidu')?.id, 'baidu');
});

test('单配:只有 tencent,任何 preferred 都回落唯一已配置引擎', () => {
  setEngineEnv({ tencent: true });
  assert.deepEqual(
    getConfiguredEngines().map((e) => e.id),
    ['tencent'],
  );
  assert.equal(resolveEngine()?.id, 'tencent');
  assert.equal(resolveEngine('amap')?.id, 'tencent');
  assert.equal(resolveEngine('baidu')?.id, 'tencent');
});

test('零配:返回 null(调用方回退 CSS fallback 地图)', () => {
  setEngineEnv({});
  assert.deepEqual(getConfiguredEngines(), []);
  assert.equal(resolveEngine(), null);
  assert.equal(resolveEngine('amap'), null);
  assert.equal(resolveEngine('baidu'), null);
});

test('preference 优先:全配时偏好 tencent → resolveEngine() 取 tencent', () => {
  setEngineEnv({ amap: true, tencent: true, baidu: true });
  globalThis.window = { localStorage: makeStorage({ 'domain-map:engine': 'tencent' }) };
  assert.equal(readEnginePreference(), 'tencent');
  assert.equal(resolveEngine()?.id, 'tencent');
  // 显式 preferred 覆盖偏好
  assert.equal(resolveEngine('baidu')?.id, 'baidu');
});

test('preference 未配置回落:偏好 tencent 但未配置 → 取优先级第一个已配置', () => {
  setEngineEnv({ amap: true });
  globalThis.window = { localStorage: makeStorage({ 'domain-map:engine': 'tencent' }) };
  assert.equal(resolveEngine()?.id, 'amap');
});

test('preference 无效值:按未设置处理,回落优先级第一个', () => {
  setEngineEnv({ amap: true, tencent: true });
  globalThis.window = { localStorage: makeStorage({ 'domain-map:engine': 'garbage' }) };
  assert.equal(readEnginePreference(), null);
  assert.equal(resolveEngine()?.id, 'amap');
});

test('writeEnginePreference 写读往返;SSR 守卫(无 window)读 null、写 no-op', () => {
  // 非浏览器环境:读 null,写不抛
  delete globalThis.window;
  assert.equal(readEnginePreference(), null);
  assert.doesNotThrow(() => writeEnginePreference('amap'));

  // 浏览器环境:写读往返
  globalThis.window = { localStorage: makeStorage() };
  writeEnginePreference('baidu');
  assert.equal(readEnginePreference(), 'baidu');
  writeEnginePreference('tencent');
  assert.equal(readEnginePreference(), 'tencent');
});

test('getEngine 按 id 取引擎;未知 id 抛错', () => {
  assert.equal(getEngine('amap'), AMAP_ENGINE);
  assert.equal(getEngine('tencent'), TENCENT_ENGINE);
  assert.equal(getEngine('baidu'), BAIDU_ENGINE);
  assert.throws(() => getEngine('garmin'), /unknown engine id/);
});

test('骨架门禁:load/createView/search 未实现即调用 → 明确报错(ws-c/d/e 落地)', async () => {
  setEngineEnv({ amap: true });
  await assert.rejects(AMAP_ENGINE.load(), /未实现.*ws-c/);
  await assert.rejects(TENCENT_ENGINE.load(), /未实现.*ws-d/);
  await assert.rejects(BAIDU_ENGINE.load(), /未实现.*ws-e/);
  await assert.rejects(AMAP_ENGINE.createView({} ), /未实现.*ws-c/);
  await assert.rejects(AMAP_ENGINE.search.searchPOI({ keyword: 'x' }), /未实现.*ws-c/);
  await assert.rejects(BAIDU_ENGINE.search.geocodeAddress('x'), /未实现.*ws-e/);
});

test('isLoaded:window 无厂商 namespace 时为 false,安装后为 true', () => {
  setEngineEnv({ tencent: true });
  delete globalThis.window;
  assert.equal(TENCENT_ENGINE.isLoaded(), false);
  globalThis.window = {};
  assert.equal(TENCENT_ENGINE.isLoaded(), false);
  const { ns, uninstall } = installEngineMock('TMap', { coordSystem: 'gcj02' });
  try {
    globalThis.window = { TMap: ns };
    assert.equal(TENCENT_ENGINE.isLoaded(), true);
  } finally {
    uninstall();
  }
});

test('engine-mock 工厂:可安装到任意 namespace,视图/marker/circle/事件语义可用', () => {
  const { ns, uninstall } = installEngineMock('TMap', { coordSystem: 'gcj02' });
  try {
    assert.equal(globalThis.TMap, ns);
    const view = new ns.Map({ center: { lng: 116.39, lat: 39.9 }, zoom: 12 });
    assert.deepEqual(view.getState(), {
      center: { lng: 116.39, lat: 39.9 },
      zoom: 12,
      pitch: 0,
      rotation: 0,
    });
    assert.equal(view.getBounds(), null);
    assert.equal(view.isDestroyed(), false);

    const marker = view.createMarker({ position: { lng: 116.4, lat: 39.91 }, content: '<b>x</b>' });
    assert.ok(marker instanceof MockMarker);
    marker.setPosition({ lng: 1, lat: 2 });
    assert.deepEqual(marker.getPosition(), { lng: 1, lat: 2 });
    marker.setContent('y');
    assert.equal(marker.getContent(), 'y');
    marker.remove();
    assert.equal(marker.removed, true);

    const circle = view.createCircle({ center: { lng: 1, lat: 2 }, radius: 500, color: '#007AFF' });
    assert.ok(circle instanceof MockCircle);
    circle.remove();
    assert.equal(circle.removed, true);

    view.setStyle('satellite');
    assert.equal(view.style, 'satellite');
    view.setZoom(15);
    assert.equal(view.getState().zoom, 15);
    view.flyTo({ center: { lng: 121.47, lat: 31.23 }, zoom: 11 });
    assert.deepEqual(view.getState().center, { lng: 121.47, lat: 31.23 });

    // on 返回解绑函数:解绑后不再触发
    let clicks = 0;
    const off = view.on('click', () => clicks++);
    view.trigger('click');
    off();
    view.trigger('click');
    assert.equal(clicks, 1);

    view.addControl('scale');
    assert.equal(view.control, 'scale');
    view.destroy();
    assert.equal(view.isDestroyed(), true);

    // search stub 全返回安全值
    assert.deepEqual(await ns.search.searchPOI({ keyword: 'x' }), []);
    assert.equal(await ns.search.getCurrentPosition(), null);
  } finally {
    uninstall();
    assert.equal(globalThis.TMap, undefined);
  }
});
