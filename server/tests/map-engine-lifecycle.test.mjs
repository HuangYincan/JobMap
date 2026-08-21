// ============================================================
// 三引擎 marker 生命周期贯通测试(ws-5 验收项 1)
//
// 同一套断言驱动 amap / tencent / baidu 三个引擎适配器走完整生命周期:
//   createMarker → setZIndex → setVisible → on/off → remove
// 并用 engine-mock 断言三引擎语义一致(契约 MapMarker 的引擎差异由适配层吸收)。
//
// 同时验证 map-shell 聚合徽章清理(ws-5 修复)依赖的 raw 摘除能力分派:
//   if (typeof raw.setMap === 'function') raw.setMap(null);
//   else if (typeof raw.remove === 'function') raw.remove();
// 各厂商官方移除方式:
//   - AMap / TMap(glMarker/MultiMarker):setMap(null)(无统一 remove)
//   - BMapGL:remove()(无 setMap —— 旧徽章清理只调 setMap(null) 静默 no-op 泄漏根因)
// 断言:三引擎下该分派都能把 marker 真正摘离地图(overlay 注册表同步清空)。
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AMAP_ENGINE_IMPL } from '../src/lib/map-engine/amap/amap-engine.ts';
import { TENCENT_ENGINE } from '../src/lib/map-engine/tencent/tencent-engine.ts';
import { createBaiduEngine } from '../src/lib/map-engine/baidu/baidu-engine.ts';

const GCJ = { lng: 116.397428, lat: 39.90923 };

// ---------------------------------------------------------------------------
// 共享厂商双面:一个 RawMap / RawMarker 覆盖三家适配器调用的全部 vendor 方法,
// 同时记录每次调用(zIndex / visible / 事件注册 / 摘除),供统一断言。
// ---------------------------------------------------------------------------

class RawMap {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.state = {
      center: opts.center ?? [120.15, 30.27],
      zoom: opts.zoom ?? 13,
      pitch: opts.pitch ?? 0,
      rotation: opts.rotation ?? 0,
    };
    this.listeners = new Map();
    this.overlays = new Set();
    this.destroyed = false;
    // 腾讯 createView 等待 idle 就绪(TMap 异步初始化);amap/baidu 不消费,无害
    setTimeout(() => this.trigger('idle'), 5);
  }

  // 事件(amap on/off;tencent on/off;baidu addEventListener/removeEventListener)
  on(event, cb) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }

  off(event, cb) {
    if (!cb) {
      this.listeners.delete(event);
      return this;
    }
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, list.filter((f) => f !== cb));
    return this;
  }

  trigger(event, payload) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }

  addEventListener(event, cb) {
    return this.on(event, cb);
  }

  removeEventListener(event, cb) {
    return this.off(event, cb);
  }

  // overlay 注册表(baidu addOverlay/removeOverlay;amap add)
  addOverlay(o) {
    this.overlays.add(o);
    // baidu 形态:适配层 addOverlay 时 raw 不自知地图 → 回链,让 remove/setMap
    // 能同步清理注册表(与真实 BMapGL Marker.remove 从地图移除同语义)
    if (o && typeof o === 'object') o.map = this;
  }

  removeOverlay(o) {
    this.overlays.delete(o);
  }

  add(o) {
    this.overlays.add(o);
  }

  // 相机(amap / tencent / baidu 取子集)
  getCenter() {
    const c = this.state.center;
    const lng = Array.isArray(c) ? c[0] : c.lng ?? 0;
    const lat = Array.isArray(c) ? c[1] : c.lat ?? 0;
    return { lng, lat, getLng: () => lng, getLat: () => lat };
  }

  getZoom() {
    return this.state.zoom;
  }

  getPitch() {
    return this.state.pitch;
  }

  getRotation() {
    return this.state.rotation;
  }

  getBounds() {
    return null;
  }

  setCenter(c) {
    this.state.center = c;
  }

  setZoom(z) {
    this.state.zoom = z;
  }

  setPitch(p) {
    this.state.pitch = p;
  }

  setRotation(r) {
    this.state.rotation = r;
  }

  setBounds() {}

  setZoomAndCenter(z, c) {
    this.state.zoom = z;
    this.state.center = c;
  }

  setMapStyle(s) {
    this.mapStyle = s;
  }

  // baidu 相机形态
  centerAndZoom(point, zoom) {
    this.state.center = point;
    this.state.zoom = zoom;
  }

  setTilt(p) {
    this.state.pitch = p;
  }

  setHeading(r) {
    this.state.rotation = r;
  }

  panTo(p) {
    this.state.center = p;
  }

  setMapType(t) {
    this.mapType = t;
  }

  // tencent 控件防御(getControl/removeControl/setShowControl/getContainer)
  getControl() {
    return null;
  }

  removeControl() {}

  setShowControl(v) {
    this.showControl = v;
  }

  getContainer() {
    return this.container;
  }

  destroy() {
    this.destroyed = true;
  }
}

class RawMarker {
  constructor(a, b) {
    // baidu 形态:new Marker(Point, opts);amap/tencent 形态:new Marker(opts)
    const isPointShape = !!(a && typeof a === 'object' && a.lng !== undefined && a.lat !== undefined);
    const opts = isPointShape ? (b ?? {}) : (a ?? {});
    this.opts = opts;
    this.position = opts.position ?? (isPointShape ? a : null);
    this.map = opts.map ?? null;
    this.zIndex = opts.zIndex ?? 0;
    this.visible = true;
    this.removed = false;
    this.listeners = new Map();
    if (this.map?.addOverlay) this.map.addOverlay(this);
  }

  setPosition(p) {
    this.position = p;
  }

  setContent(html) {
    this.content = html;
  }

  // amap 官方小写 setzIndex
  setzIndex(z) {
    this.zIndex = z;
  }

  // TMap / BMapGL 官方大写 setZIndex
  setZIndex(z) {
    this.zIndex = z;
  }

  // amap / baidu 官方 show()/hide();TMap 官方 setVisible
  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  setVisible(v) {
    this.visible = Boolean(v);
  }

  on(event, cb) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  off(event, cb) {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, list.filter((f) => f !== cb));
  }

  addEventListener(event, cb) {
    this.on(event, cb);
  }

  removeEventListener(event, cb) {
    this.off(event, cb);
  }

  trigger(event, payload) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }

  // AMap / TMap 官方移除;同时从 overlay 注册表摘除
  setMap(map) {
    this.map?.overlays?.delete?.(this);
    this.map = map;
    if (map?.addOverlay) map.addOverlay(this);
  }

  getMap() {
    return this.map;
  }

  // BMapGL 官方移除(从地图移除覆盖物)
  remove() {
    this.removed = true;
    this.map?.overlays?.delete?.(this);
    this.map = null;
  }
}

class RawPoint {
  constructor(lng, lat) {
    this.lng = lng;
    this.lat = lat;
  }
}

class RawPixel {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

class RawSize {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}

class RawLatLng {
  constructor(lat, lng) {
    this.lat = lat;
    this.lng = lng;
  }
}

// ---------------------------------------------------------------------------
// 引擎上下文装配:env key + window 别名 + 命名空间,返回 { engine, ns, restore }
// ---------------------------------------------------------------------------

const ENGINE_KEY = {
  amap: ['NEXT_PUBLIC_AMAP_KEY', 'NEXT_PUBLIC_AMAP_SECURITY_CODE'],
  tencent: ['NEXT_PUBLIC_TENCENT_JSAPI_KEY'],
  baidu: ['NEXT_PUBLIC_BAIDU_AK'],
};

function makeContext(name) {
  const prevEnv = {};
  for (const k of ENGINE_KEY[name]) {
    prevEnv[k] = process.env[k];
    process.env[k] = 'test-key';
  }
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const prevWindow = globalThis.window;
  globalThis.window = globalThis;

  const ns = {
    Map: RawMap,
    Marker: RawMarker,
  };
  if (name === 'amap') {
    ns.Pixel = RawPixel;
    ns.Size = RawSize;
  }
  if (name === 'tencent') {
    ns.LatLng = RawLatLng;
  }
  if (name === 'baidu') {
    ns.Point = RawPoint;
    ns.Size = RawSize;
    globalThis.BMAPGL_NORMAL_MAP = 'BMAPGL_NORMAL_MAP';
    globalThis.BMAPGL_SATELLITE_MAP = 'BMAPGL_SATELLITE_MAP';
  }
  globalThis[name === 'amap' ? 'AMap' : name === 'tencent' ? 'TMap' : 'BMapGL'] = ns;

  return {
    ns,
    engine:
      name === 'amap' ? AMAP_ENGINE_IMPL : name === 'tencent' ? TENCENT_ENGINE : createBaiduEngine(),
    restore() {
      for (const k of ENGINE_KEY[name]) {
        if (prevEnv[k] === undefined) delete process.env[k];
        else process.env[k] = prevEnv[k];
      }
      if (hadWindow) globalThis.window = prevWindow;
      else delete globalThis.window;
      delete globalThis[name === 'amap' ? 'AMap' : name === 'tencent' ? 'TMap' : 'BMapGL'];
      delete globalThis.BMAPGL_NORMAL_MAP;
      delete globalThis.BMAPGL_SATELLITE_MAP;
    },
  };
}

/** map-shell 聚合徽章清理的分派逻辑(ws-5)镜像——本测试的断言对象 */
function detachRaw(marker) {
  if (typeof marker.setMap === 'function') marker.setMap(null);
  else if (typeof marker.remove === 'function') marker.remove();
}

// ---------------------------------------------------------------------------
// 贯通测试:三引擎同一生命周期 + raw 摘除能力分派
// ---------------------------------------------------------------------------

const ENGINES = ['amap', 'tencent', 'baidu'];

for (const name of ENGINES) {
  test(`marker 生命周期贯通(${name}):创建 → setZIndex → setVisible → on/off → remove,三引擎语义一致`, async () => {
    const ctx = makeContext(name);
    try {
      const view = await ctx.engine.createView({
        container: { nodeType: 1, querySelectorAll: () => [] },
        center: GCJ,
        zoom: 11,
        style: 'normal',
      });
      const rawMap = view.raw;
      assert.ok(rawMap instanceof RawMap, `${name}: createView 返回包装视图`);

      let clicks = 0;
      const wrapper = view.createMarker({
        position: GCJ,
        content: '<div style="width:64px;height:64px">15</div>',
        offset: [-32, -32],
        zIndex: 50,
        onClick: () => {
          clicks += 1;
        },
      });
      const raw = wrapper.raw;
      assert.ok(raw instanceof RawMarker, `${name}: createMarker 返回契约包装(raw = 厂商实例)`);
      assert.ok(rawMap.overlays.has(raw), `${name}: 构造即挂到地图 overlay 注册表`);

      // setZIndex(契约统一大小写:amap setzIndex / TMap·BMapGL setZIndex)
      wrapper.setZIndex(60);
      assert.equal(raw.zIndex, 60, `${name}: setZIndex 直达厂商实例`);

      // setVisible(契约统一:amap·baidu show/hide / tencent setVisible)
      wrapper.setVisible(false);
      assert.equal(raw.visible, false, `${name}: setVisible(false) 隐藏`);
      wrapper.setVisible(true);
      assert.equal(raw.visible, true, `${name}: setVisible(true) 显示`);

      // on/off(契约统一:amap·tencent on/off / baidu addEventListener)
      const extraCb = () => {
        clicks += 1;
      };
      wrapper.on('click', extraCb);
      raw.trigger('click');
      assert.equal(clicks, 2, `${name}: on 注册后点击回调触发(constructor onClick + on)`);
      wrapper.off('click', extraCb);
      raw.trigger('click');
      assert.equal(clicks, 3, `${name}: off(cb) 只解绑该回调`);

      // ---- raw 摘除能力分派(ws-5 徽章清理核心)----
      if (name === 'baidu') {
        // BMapGL 无 setMap:旧清理(只调 setMap(null))静默 no-op → 徽章泄漏根因
        assert.equal(typeof raw.setMap, 'function', false, `${name}: BMapGL raw 无 setMap(旧代码 no-op 根因)`);
      } else {
        // AMap/TMap glMarker:官方移除 = setMap(null)
        assert.equal(typeof raw.setMap, 'function', true, `${name}: raw 有 setMap(官方移除)`);
      }
      detachRaw(raw);
      assert.equal(raw.map, null, `${name}: 分派后 marker 脱离地图`);
      assert.equal(rawMap.overlays.has(raw), false, `${name}: overlay 注册表同步摘除(无泄漏)`);

      // 契约 remove 幂等同效(与分派同语义,再摘一次不报错)
      wrapper.remove();
      assert.equal(raw.map, null, `${name}: 契约 remove 幂等`);
      assert.equal(rawMap.overlays.has(raw), false, `${name}: 契约 remove 后注册表仍干净`);
    } finally {
      ctx.restore();
    }
  });
}

// ---------------------------------------------------------------------------
// 徽章形态回归:createCityClusterMarker 同款选项(offset/zIndex/bubble)经
// 三引擎 createMarker 透传后,ws-5 分派都能摘除(跨 zoom 分桶不泄漏)。
// ---------------------------------------------------------------------------

for (const name of ENGINES) {
  test(`徽章形态摘除(${name}):offset/zIndex/bubble 透传 + 分派摘除(ws-5 回归)`, async () => {
    const ctx = makeContext(name);
    try {
      const view = await ctx.engine.createView({
        container: { nodeType: 1, querySelectorAll: () => [] },
        center: GCJ,
        zoom: 7,
        style: 'normal',
      });
      const rawMap = view.raw;
      let drill = 0;
      const wrapper = view.createMarker({
        position: { lng: 120.15, lat: 30.27 },
        offset: [-32, -32],
        zIndex: 50,
        content: '<div>杭州</div>',
        bubble: false, // 徽章点击不冒泡(duck-type,amap 透传)
        onClick: () => {
          drill += 1;
        },
      });
      const raw = wrapper.raw;
      assert.ok(rawMap.overlays.has(raw), `${name}: 徽章构造即挂图`);
      if (name === 'amap') {
        assert.equal(raw.opts.bubble, false, 'amap: bubble duck-type 透传');
        assert.ok(raw.opts.offset instanceof RawPixel, 'amap: offset 元组 → AMap.Pixel');
      }
      if (name === 'tencent') {
        assert.deepEqual({ ...raw.opts.offset }, { x: -32, y: -32 }, 'tencent: offset → {x,y} 对象');
        assert.ok(raw.opts.position instanceof RawLatLng, 'tencent: LatLng 纬度在前');
      }
      if (name === 'baidu') {
        assert.ok(raw.opts.zIndex, 50, 'baidu: zIndex 透传');
      }
      raw.trigger('click');
      assert.equal(drill, 1, `${name}: 徽章 onClick 接线`);
      // 跨 zoom 分桶重建前的整批摘除:分派逐个摘
      detachRaw(raw);
      assert.equal(raw.map, null, `${name}: 徽章分派摘除`);
      assert.equal(rawMap.overlays.has(raw), false, `${name}: 徽章不残留 overlay 注册表`);
    } finally {
      ctx.restore();
    }
  });
}
