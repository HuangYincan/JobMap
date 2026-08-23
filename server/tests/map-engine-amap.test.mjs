// ============================================================
// AMap 引擎适配器测试(ws-c)— 构造参数/样式映射/卫星层/事件/比例尺/
// createMarker(offset 元组→Pixel)/createCircle/scale control/search 转发
//
// 用本地命名空间 mock 直接观察 AMap.Map/Marker/Circle/Scale/TileLayer
// 构造参数与调用序列,断言适配层与 map-shell 旧直连行为逐项一致。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// amap-api.loadAMap 的 key/securityCode 前置(测试无真实 key,只走脚本就绪路径)
process.env.NEXT_PUBLIC_AMAP_KEY = 'test-key';
process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE = 'test-code';

import { GEOCODE_CACHE_MAX, resetGeocodeCache } from '../src/lib/amap-api.ts';
import { registerAmapEngine } from '../src/lib/map-engine/amap/amap-engine.ts';
import { AMAP_ENGINE, resolveEngine } from '../src/lib/map-engine/engine-registry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// 本地命名空间 mock(window.AMap 直装;loadAMap 走「已就绪」短路,不注入脚本)
// ---------------------------------------------------------------------------

function makeNs() {
  const ns = { instances: {} };

  class FakeMap {
    constructor(container, opts) {
      this.container = container;
      this.opts = opts;
      this.state = {
        zoom: opts.zoom,
        center: opts.center,
        rotation: opts.rotation ?? 0,
        pitch: opts.pitch ?? 0,
      };
      this.listeners = {};
      this.controls = [];
      this.added = [];
      this.destroyed = false;
      ns.instances.map = this;
    }
    on(e, cb) {
      (this.listeners[e] ||= []).push(cb);
    }
    off(e, cb) {
      this.listeners[e] = (this.listeners[e] || []).filter((f) => f !== cb);
    }
    trigger(e, payload) {
      for (const cb of this.listeners[e] || []) cb(payload);
    }
    getCenter() {
      return { getLng: () => this.state.center[0], getLat: () => this.state.center[1] };
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
      return this._bounds ?? null;
    }
    setCenter(c, immediate, duration) {
      this.state.center = [c[0], c[1]];
      this.lastSetCenter = { c, immediate, duration };
    }
    setZoom(z, immediate, duration) {
      this.state.zoom = z;
      this.lastSetZoom = { z, immediate, duration };
    }
    setPitch(p, immediate, duration) {
      this.state.pitch = p;
      this.lastSetPitch = { p, immediate, duration };
    }
    setRotation(r, immediate, duration) {
      this.state.rotation = r;
      this.lastSetRotation = { r, immediate, duration };
    }
    setBounds(b) {
      this.lastSetBounds = b;
    }
    setZoomAndCenter(z, c, immediate, duration) {
      this.state.zoom = z;
      this.state.center = [c[0], c[1]];
      this.lastSetZoomAndCenter = { z, c, immediate, duration };
    }
    setMapStyle(s) {
      this.lastMapStyle = s;
    }
    addControl(c) {
      this.controls.push(c);
    }
    removeControl(c) {
      this.controls = this.controls.filter((x) => x !== c);
    }
    add(o) {
      this.added.push(o);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  ns.Map = FakeMap;

  class FakePixel {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
  }
  ns.Pixel = FakePixel;

  class FakeSize {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
  }
  ns.Size = FakeSize;

  class FakeIcon {
    constructor(opts) {
      this.opts = opts;
      ns.instances.icons ||= [];
      ns.instances.icons.push(this);
    }
  }
  ns.Icon = FakeIcon;

  class FakeBounds {
    constructor(sw, ne) {
      this.sw = sw;
      this.ne = ne;
    }
  }
  ns.Bounds = FakeBounds;

  class FakeMarker {
    constructor(opts) {
      this.opts = opts;
      this.listeners = {};
      this._map = opts.map;
      this.position = opts.position;
      this.content = opts.content ?? null;
      this._visible = true;
      this.lastZIndex = undefined;
      this.icon = null;
      ns.instances.markers ||= [];
      ns.instances.markers.push(this);
    }
    on(e, cb) {
      (this.listeners[e] ||= []).push(cb);
    }
    off(e, cb) {
      this.listeners[e] = (this.listeners[e] || []).filter((f) => f !== cb);
    }
    setPosition(p) {
      this.position = p;
    }
    setContent(html) {
      this.content = html;
    }
    setzIndex(z) {
      this.lastZIndex = z;
    }
    show() {
      this._visible = true;
    }
    hide() {
      this._visible = false;
    }
    setIcon(icon) {
      this.icon = icon;
    }
    setMap(m) {
      this._map = m;
    }
    getMap() {
      return this._map;
    }
    trigger(e, payload) {
      for (const cb of this.listeners[e] || []) cb(payload);
    }
  }
  ns.Marker = FakeMarker;

  class FakeCircle {
    constructor(opts) {
      this.opts = opts;
      this._map = null;
      ns.instances.circles ||= [];
      ns.instances.circles.push(this);
    }
    setMap(m) {
      this._map = m;
    }
    getMap() {
      return this._map;
    }
  }
  ns.Circle = FakeCircle;

  class FakeScale {
    constructor(opts) {
      this.opts = opts;
      ns.instances.scales ||= [];
      ns.instances.scales.push(this);
    }
  }
  ns.Scale = FakeScale;

  class FakeSatellite {
    constructor(opts) {
      this.opts = opts;
      this._visible = true;
      ns.instances.satellite = this;
    }
    show() {
      this._visible = true;
    }
    hide() {
      this._visible = false;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  ns.TileLayer = { Satellite: FakeSatellite };

  ns.plugin = (names, cb) => {
    ns.instances.pluginCalls ||= [];
    ns.instances.pluginCalls.push(names);
    queueMicrotask(cb);
  };

  // ---- 搜索转发(PlaceSearch/AutoComplete/Geolocation/Geocoder)----
  class FakePlaceSearch {
    constructor(opts) {
      this.opts = opts;
      ns.instances.placeSearch = this;
    }
    search(kw, done) {
      ns.instances.searchCalls ||= [];
      ns.instances.searchCalls.push({ kw, mode: 'search' });
      done('complete', { poiList: { pois: [], count: 0 } });
    }
    searchNearBy(kw, center, radius, done) {
      ns.instances.searchCalls ||= [];
      ns.instances.searchCalls.push({ kw, center, radius, mode: 'nearby' });
      done('complete', { poiList: { pois: [], count: 0 } });
    }
    on() {}
  }
  ns.PlaceSearch = FakePlaceSearch;

  class FakeAutoComplete {
    constructor(opts) {
      this.opts = opts;
      ns.instances.auto = this;
    }
    search(kw, done) {
      ns.instances.autoCalls ||= [];
      ns.instances.autoCalls.push(kw);
      done('complete', { tips: [] });
    }
    on() {}
  }
  ns.AutoComplete = FakeAutoComplete;

  class FakeGeolocation {
    constructor(opts) {
      this.opts = opts;
      ns.instances.geo = this;
    }
    getCurrentPosition(done) {
      ns.instances.geoCalls ||= 0;
      ns.instances.geoCalls += 1;
      done('complete', {
        position: { getLng: () => 120.1, getLat: () => 30.2 },
        accuracy: 100,
        isConverted: false,
        formattedAddress: '杭州',
        info: 'ok',
      });
    }
  }
  ns.Geolocation = FakeGeolocation;

  class FakeGeocoder {
    constructor(opts) {
      this.opts = opts;
      ns.instances.geocoder = this;
    }
    getLocation(addr, done) {
      ns.instances.geocoderCalls ||= [];
      ns.instances.geocoderCalls.push(addr);
      done('complete', { geocodes: [{ location: { getLng: () => 121, getLat: () => 31 } }] });
    }
  }
  ns.Geocoder = FakeGeocoder;

  return ns;
}

/** 直装命名空间(window.AMap 已就绪 → loadAMap 微任务即 resolve,不注入脚本) */
function installNs() {
  const ns = makeNs();
  globalThis.window = { AMap: ns };
  return ns;
}

test.afterEach(() => {
  delete globalThis.window;
});

/** 便捷:注册 + load + createView */
async function createView(ns, style = 'normal') {
  const engine = registerAmapEngine();
  await engine.load();
  return engine.createView({
    container: { fake: 'container' },
    center: { lng: 120.15, lat: 30.27 },
    zoom: 13,
    style,
  });
}

// ---------------------------------------------------------------------------
// 注册与描述
// ---------------------------------------------------------------------------

test('注册:registerAmapEngine 原地装配注册表骨架,描述字段与契约一致', () => {
  const engine = registerAmapEngine();
  assert.equal(engine, AMAP_ENGINE, '与注册表同一对象(engine-registry 保持厂商无关)');
  assert.equal(engine.id, 'amap');
  assert.equal(engine.label, '高德地图');
  assert.equal(engine.namespace, 'AMap');
  assert.equal(engine.coordSystem, 'gcj02');
  assert.equal(engine.keyVar, 'NEXT_PUBLIC_AMAP_KEY');
  assert.equal(resolveEngine('amap'), AMAP_ENGINE, 'resolveEngine 返回装配后的引擎');
});

test('load/isLoaded:复用 amap-api.loadAMap(window.AMap 就绪即成功,幂等)', async () => {
  installNs();
  const engine = registerAmapEngine();
  await engine.load();
  assert.equal(engine.isLoaded(), true);
  await engine.load(); // 幂等:重复调用共享同一就绪态
});

// ---------------------------------------------------------------------------
// createView 构造参数(迁移 map-shell L527-542)
// ---------------------------------------------------------------------------

test('createView:迁移 map-shell 旧构造参数(viewMode/pitch/showLabel/mapStyle/rotateEnable)', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const map = ns.instances.map;
  assert.ok(map, 'AMap.Map 已构造');
  assert.equal(map.opts.viewMode, '3D');
  assert.equal(map.opts.pitch, 0);
  assert.equal(map.opts.showLabel, true);
  assert.equal(map.opts.mapStyle, 'amap://styles/normal');
  assert.equal(map.opts.rotateEnable, false, '禁用默认的右键旋转');
  assert.deepEqual(map.opts.center, [120.15, 30.27]);
  assert.equal(map.opts.zoom, 13);
  view.destroy();
  assert.equal(map.destroyed, true, 'destroy 转 map.destroy()');
  assert.equal(view.isDestroyed(), true);
});

// ---------------------------------------------------------------------------
// setStyle 映射表 + 卫星瓦片层
// ---------------------------------------------------------------------------

test('setStyle:normal→amap://styles/normal,whitesmoke→amap://styles/whitesmoke', async () => {
  const ns = installNs();
  const view = await createView(ns, 'whitesmoke');
  const map = ns.instances.map;
  assert.equal(map.opts.mapStyle, 'amap://styles/whitesmoke', 'createView 初始样式映射');
  view.setStyle('normal');
  assert.equal(map.lastMapStyle, 'amap://styles/normal');
  view.setStyle('whitesmoke');
  assert.equal(map.lastMapStyle, 'amap://styles/whitesmoke');
  view.destroy();
});

test('setStyle:satellite → normal 底图 + AMap.TileLayer.Satellite 瓦片层(show/hide)', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const map = ns.instances.map;
  view.setStyle('satellite');
  assert.equal(map.lastMapStyle, 'amap://styles/normal', '卫星 = normal 底图 + 瓦片层(旧 L653-654 语义)');
  const sat = ns.instances.satellite;
  assert.ok(sat, 'Satellite 层已创建');
  assert.equal(sat.opts.map, map, '瓦片层绑定到地图(旧 new TileLayer.Satellite({ map }) 用法)');
  assert.equal(sat._visible, true, '卫星样式显示瓦片层');
  view.setStyle('whitesmoke');
  assert.equal(sat._visible, false, '非卫星样式隐藏瓦片层');
  assert.equal(map.lastMapStyle, 'amap://styles/whitesmoke');
  view.destroy();
  assert.equal(sat.destroyed, true, 'destroy 销毁瓦片层(旧 cleanup L765-768 语义)');
});

// ---------------------------------------------------------------------------
// 视图方法
// ---------------------------------------------------------------------------

test('createMarker:offset 元组→AMap.Pixel,position→tuple,绑定地图 + onClick', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  let clicked = 0;
  const wrapper = view.createMarker({
    position: { lng: 120.1, lat: 30.2 },
    offset: [-9, -9],
    zIndex: 130,
    content: '<div>x</div>',
    onClick: () => {
      clicked += 1;
    },
  });
  const raw = ns.instances.markers[0];
  assert.ok(raw.opts.offset instanceof ns.Pixel, 'offset 元组转 AMap.Pixel');
  assert.equal(raw.opts.offset.x, -9);
  assert.equal(raw.opts.offset.y, -9);
  assert.deepEqual(raw.opts.position, [120.1, 30.2]);
  assert.equal(raw.opts.map, ns.instances.map, '构造即绑定到地图');
  assert.equal(raw.opts.zIndex, 130);
  assert.equal(raw.opts.content, '<div>x</div>');
  raw.trigger('click');
  assert.equal(clicked, 1, 'onClick 经 marker click 事件');
  wrapper.setPosition({ lng: 121, lat: 31 });
  assert.deepEqual(raw.position, [121, 31]);
  wrapper.setContent('<div>y</div>');
  assert.equal(raw.content, '<div>y</div>');
  wrapper.remove();
  assert.equal(raw.getMap(), null, 'remove 转 setMap(null)');
  view.destroy();
});

test('createMarker:duck-type 透传 AMap 专属选项(cursor/bubble,契约未含)', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  view.createMarker({
    position: { lng: 120.1, lat: 30.2 },
    cursor: 'ew-resize',
    bubble: false,
  });
  const raw = ns.instances.markers[0];
  assert.equal(raw.opts.cursor, 'ew-resize');
  assert.equal(raw.opts.bubble, false);
  view.destroy();
});

test('createMarker:icon 规格 → AMap.Icon(size/image/imageSize) + setIcon', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  view.createMarker({
    position: { lng: 120.1, lat: 30.2 },
    icon: { src: 'data:image/svg+xml;utf8,<svg/>', size: [22, 30] },
  });
  const raw = ns.instances.markers[0];
  const icon = raw.icon;
  assert.ok(icon instanceof ns.Icon, 'setIcon 收到 AMap.Icon 实例');
  assert.equal(icon.opts.image, 'data:image/svg+xml;utf8,<svg/>', 'image = icon.src');
  assert.ok(icon.opts.size instanceof ns.Size, 'size 转 AMap.Size');
  assert.equal(icon.opts.size.width, 22);
  assert.equal(icon.opts.size.height, 30);
  assert.equal(icon.opts.imageSize, icon.opts.size, 'data URI SVG:imageSize = size(与旧 buildIcon 同款)');
  view.destroy();
});

test('createMarker:icon 无 size → 仅 image(AMap 用图片自然尺寸)', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  view.createMarker({ position: { lng: 120.1, lat: 30.2 }, icon: { src: 'x.png' } });
  const icon = ns.instances.markers[0].icon;
  assert.equal(icon.opts.image, 'x.png');
  assert.equal(icon.opts.size, undefined, '无 size 不注入 size/imageSize');
  view.destroy();
});

test('createMarker 契约方法:setZIndex→setzIndex(小写)/setVisible→show·hide/on·off 事件', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const marker = view.createMarker({ position: { lng: 120.1, lat: 30.2 } });
  const raw = ns.instances.markers[0];

  marker.setZIndex(55);
  assert.equal(raw.lastZIndex, 55, 'AMap 小写 setzIndex 由适配层吸收');
  marker.setZIndex(100);
  assert.equal(raw.lastZIndex, 100);

  marker.setVisible(false);
  assert.equal(raw._visible, false, 'setVisible(false) → hide()');
  marker.setVisible(true);
  assert.equal(raw._visible, true, 'setVisible(true) → show()');

  let clicks = 0;
  const cb = () => clicks++;
  marker.on('click', cb);
  assert.equal(raw.listeners.click.length, 1, 'on → raw.on');
  raw.trigger('click');
  assert.equal(clicks, 1);
  marker.off('click', cb);
  assert.equal(raw.listeners.click.length, 0, 'off(cb) → raw.off 精确解绑');
  raw.trigger('click');
  assert.equal(clicks, 1, '解绑后不再触发');
  view.destroy();
});

test('createMarker 契约方法:厂商方法缺失 → warn 降级不抛', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const marker = view.createMarker({ position: { lng: 120.1, lat: 30.2 } });
  const raw = ns.instances.markers.at(-1);
  // 方法在原型上:实例 delete 无效 → 从原型摘除(厂商缺失模拟),测后还原
  const proto = Object.getPrototypeOf(raw);
  const orig = {
    setzIndex: proto.setzIndex,
    show: proto.show,
    hide: proto.hide,
    setVisible: proto.setVisible,
  };
  delete proto.setzIndex;
  delete proto.show;
  delete proto.hide;
  delete proto.setVisible;
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args);
  try {
    assert.doesNotThrow(() => marker.setZIndex(10), 'setzIndex 缺失不得抛');
    assert.doesNotThrow(() => marker.setVisible(false), 'show/hide/setVisible 全缺失不得抛');
  } finally {
    proto.setzIndex = orig.setzIndex;
    proto.show = orig.show;
    proto.hide = orig.hide;
    proto.setVisible = orig.setVisible;
    console.warn = origWarn;
  }
  assert.ok(warns.length >= 2, '缺失方法必须 console.warn(可观测)');
  view.destroy();
});

test('createCircle:距离圈同款参数(stroke/fill/opacity/bubble/zIndex),构造即 add', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const circle = view.createCircle({
    center: { lng: 120.1, lat: 30.2 },
    radius: 5000,
    color: '#007AFF',
  });
  const raw = ns.instances.circles[0];
  assert.deepEqual(raw.opts.center, [120.1, 30.2]);
  assert.equal(raw.opts.radius, 5000);
  assert.equal(raw.opts.strokeColor, '#007AFF');
  assert.equal(raw.opts.strokeOpacity, 0.85);
  assert.equal(raw.opts.strokeWeight, 2);
  assert.equal(raw.opts.fillColor, '#007AFF');
  assert.equal(raw.opts.fillOpacity, 0.08);
  assert.equal(raw.opts.bubble, true);
  assert.equal(raw.opts.zIndex, 20);
  assert.ok(ns.instances.map.added.includes(raw), '构造即 add 到地图(旧 map.add 语义)');
  circle.remove();
  assert.equal(raw.getMap(), null);
  view.destroy();
});

test('addControl scale:位置/偏移透传,插件就绪后创建,重复调用重建', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const pending = view.addControl('scale', { position: 'LT', offset: [12, 22] });
  assert.ok(pending instanceof Promise, '插件异步 → Promise');
  const control = await pending;
  assert.ok(control, '插件就绪后 resolve 控件');
  assert.equal(ns.instances.scales.length, 1);
  assert.equal(ns.instances.scales[0].opts.position, 'LT');
  assert.deepEqual(ns.instances.scales[0].opts.offset, [12, 22]);
  assert.ok(ns.instances.map.controls.includes(control), '已 addControl');
  // 重复调用(resize 断点切换):摘除旧控件按新参数重建
  const pending2 = view.addControl('scale', { position: 'LB', offset: [90, 25] });
  const control2 = await pending2;
  assert.equal(ns.instances.scales.length, 2);
  assert.ok(!ns.instances.map.controls.includes(control), '旧控件已摘除');
  assert.ok(ns.instances.map.controls.includes(control2), '新控件已 add');
  view.destroy();
});

test('setBounds:内部构造 AMap.Bounds;flyTo:setZoomAndCenter(600ms) 与 setCenter 兜底', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const map = ns.instances.map;
  view.setBounds({ west: 119.9, south: 30.1, east: 120.4, north: 30.5 });
  assert.ok(map.lastSetBounds instanceof ns.Bounds, '内部构造 AMap.Bounds');
  assert.deepEqual(map.lastSetBounds.sw, [119.9, 30.1]);
  assert.deepEqual(map.lastSetBounds.ne, [120.4, 30.5]);
  view.flyTo({ center: { lng: 121, lat: 31 }, zoom: 11 });
  assert.deepEqual(map.lastSetZoomAndCenter, { z: 11, c: [121, 31], immediate: false, duration: 600 });
  view.flyTo({ center: { lng: 122, lat: 32 } });
  assert.deepEqual(map.state.center, [122, 32], '无 zoom → setCenter');
  const state = view.getState();
  assert.equal(state.center.lng, 122);
  assert.equal(state.zoom, 11);
  view.destroy();
  assert.equal(view.isDestroyed(), true);
});

test('setPitch/setRotation/setZoom:animateMs 映射 AMap 动画参数', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const map = ns.instances.map;
  view.setPitch(45);
  assert.deepEqual(map.lastSetPitch, { p: 45, immediate: undefined, duration: undefined });
  view.setRotation(90, 300);
  assert.deepEqual(map.lastSetRotation, { r: 90, immediate: false, duration: 300 });
  view.setZoom(15, 500);
  assert.deepEqual(map.lastSetZoom, { z: 15, immediate: false, duration: 500 });
  view.destroy();
});

test('on:注册返回解绑;触发后回调,解绑后不再触发', async () => {
  const ns = installNs();
  const view = await createView(ns, 'normal');
  const map = ns.instances.map;
  let calls = 0;
  const off = view.on('moveend', () => {
    calls += 1;
  });
  map.trigger('moveend');
  assert.equal(calls, 1);
  off();
  map.trigger('moveend');
  assert.equal(calls, 1, '解绑后不再触发');
  view.destroy();
});

// ---------------------------------------------------------------------------
// search 转发(amap-api 现有能力,行为零改动)
// ---------------------------------------------------------------------------

test('search 转发:searchPOI(周边/分页)/fetchSuggestions/getCurrentPosition/geocodeAddress', async () => {
  const ns = installNs();
  const engine = registerAmapEngine();
  await engine.load();
  // 先建视图(Geolocation 绑定最近地图;与 map-shell 挂载顺序一致)
  const view = await engine.createView({
    container: { fake: 'container' },
    center: { lng: 120.15, lat: 30.27 },
    zoom: 13,
    style: 'normal',
  });

  const pois = await engine.search.searchPOI({
    keyword: '咖啡',
    center: { lng: 120.1, lat: 30.2 },
    radius: 3000,
    limit: 25,
    page: 2,
  });
  assert.deepEqual(pois, [], '空结果返回 []');
  const call = ns.instances.searchCalls[0];
  assert.equal(call.mode, 'nearby', '有 center → 周边搜索');
  assert.deepEqual(call.center, [120.1, 30.2]);
  assert.equal(call.radius, 3000);
  const ps = ns.instances.placeSearch;
  assert.equal(ps.opts.pageSize, 25, 'limit → pageSize');
  assert.equal(ps.opts.pageIndex, 2, 'page duck-type 透传(视口兜底分页)');

  const tips = await engine.search.fetchSuggestions('西湖', '杭州');
  assert.deepEqual(tips, []);
  assert.deepEqual(ns.instances.autoCalls, ['西湖']);

  const pos = await engine.search.getCurrentPosition();
  assert.deepEqual(pos, { lng: 120.1, lat: 30.2 }, '转发 amap-api getCurrentPosition(绑定最近视图地图)');

  const geo = await engine.search.geocodeAddress('文一西路');
  assert.deepEqual(geo, { lng: 121, lat: 31, address: '文一西路' });
  assert.deepEqual(ns.instances.geocoderCalls, ['文一西路']);

  view.destroy();
});

test('search 转发:searchPOI 无 center → 关键词搜索', async () => {
  const ns = installNs();
  const engine = registerAmapEngine();
  await engine.load();
  await engine.search.searchPOI({ keyword: '天安门', city: '北京' });
  const call = ns.instances.searchCalls[0];
  assert.equal(call.mode, 'search');
  assert.equal(call.kw, '天安门');
  assert.equal(ns.instances.placeSearch.opts.city, '北京');
});

test('geocodeAddress 缓存有界并保留最近使用项', async () => {
  const ns = installNs();
  const engine = registerAmapEngine();
  await engine.load();
  resetGeocodeCache();

  const addresses = Array.from({ length: GEOCODE_CACHE_MAX + 1 }, (_, i) => `地址-${i}`);
  for (const address of addresses) await engine.search.geocodeAddress(address);
  assert.equal(ns.instances.geocoderCalls.length, GEOCODE_CACHE_MAX + 1);

  // 触碰最旧项后，下一次淘汰的是第二旧项，而不是最近使用的最旧项。
  await engine.search.geocodeAddress(addresses[0]);
  assert.equal(ns.instances.geocoderCalls.at(-1), addresses[0]);
  await engine.search.geocodeAddress(`地址-${GEOCODE_CACHE_MAX}`);

  const callsBeforeHits = ns.instances.geocoderCalls.length;
  assert.deepEqual(await engine.search.geocodeAddress(addresses[0]), {
    lng: 121,
    lat: 31,
    address: addresses[0],
  });
  assert.deepEqual(await engine.search.geocodeAddress(addresses[1]), {
    lng: 121,
    lat: 31,
    address: addresses[1],
  });
  assert.equal(ns.instances.geocoderCalls.length, callsBeforeHits + 1);
  assert.equal(ns.instances.geocoderCalls.at(-1), addresses[1]);
  resetGeocodeCache();
});

// ---------------------------------------------------------------------------
// map-shell 契约(迁移收口)
// ---------------------------------------------------------------------------

test('map-shell 契约:迁移后无 window.AMap 直引用(new window.AMap / window.AMap. 均不得出现)', () => {
  const shell = src('components/map-shell.tsx');
  assert.doesNotMatch(shell, /window\.AMap/, '8 处 window.AMap 直引用全部迁移');
  assert.doesNotMatch(shell, /new window\.AMap/, '构造已由 engine.createView 承载');
});
