// ============================================================
// AMap v2 最小可测 mock — 复刻真实浏览器关键语义:
// - Marker({ map }) 构造函数即把自身注册进 map 的 overlay 表
// - setMap(null) 从 overlay 表摘除(等价 AMap v2 removeOverlay)
// - getAllOverlays('marker') 返回全部 marker overlay
// - MockMap duck-type 成 MapView(ws-c):createMarker/createCircle
//   构造即注册 + engine 命名空间 + 逃生舱 raw=自身——marker 控制器
//   测试与适配器测试共用,不再需要 loadAMap 异步门
// - loadAMap 两种就绪模式:
//   immediate=true  → window.AMap 已存在
//   immediate=false → AMap 脚本加载挂起,测试手动 amapReady() 触发
// ============================================================

import { resetAMapLoader } from '../../src/lib/amap-api.ts';

export class MockMarker {
  constructor(opts) {
    this.opts = opts || {};
    this.id = this.opts.id || `mock-marker-${++MockMarker.seq}`;
    this._map = null;
    this._listeners = {};
    this.position = this.opts.position || null;
    this._visible = true; // b2:可见性状态(show/hide)
    if (this.opts.map) {
      this.setMap(this.opts.map);
    }
  }

  setMap(map) {
    if (this._map === map) return;
    if (this._map) this._map._overlays.delete(this.id);
    this._map = map;
    if (map) map._overlays.set(this.id, this);
  }

  getMap() {
    return this._map;
  }

  /** 模拟厂商侧外部移除(等价 AMap setMap(null) / removeOverlay):从地图
   * overlay 表摘除、getMap() 归 null——控制器 sync() 探测「被外部删除」的
   * 测试手段(不经控制器 remove 路径)。 */
  mockDetach() {
    this.setMap(null);
  }

  getPosition() {
    return this.position;
  }

  setPosition(pos) {
    this.position = pos;
  }

  show() {
    this._visible = true;
  }

  hide() {
    this._visible = false;
  }

  isVisible() {
    return this._visible;
  }

  on(evt, fn) {
    (this._listeners[evt] ||= []).push(fn);
  }

  trigger(evt, payload) {
    for (const fn of this._listeners[evt] || []) fn(payload);
  }

  setzIndex(z) {
    this.zIndex = z;
  }
  setContent(html) {
    this.content = html;
  }
  // AMap 专属方法:控制器契约化后不应再直调裸实例——抛错作回归绊线
  setIcon() {
    throw new Error('AMap-only setIcon 不应被控制器直调(契约已禁用,见 map-markers.ts)');
  }
  setOffset() {
    throw new Error('AMap-only setOffset 不应被控制器直调(契约已禁用,见 map-markers.ts)');
  }
  setLabel() {}
}
MockMarker.seq = 0;

export class MockCircle {
  constructor(opts) {
    this.opts = opts || {};
    this.id = this.opts.id || `mock-circle-${++MockCircle.seq}`;
    this._map = null;
    this._radius = this.opts.radius || 0;
  }

  setMap(map) {
    if (this._map === map) return;
    if (this._map) this._map._overlays.delete(this.id);
    this._map = map;
    if (map) map._overlays.set(this.id, this);
  }

  getMap() {
    return this._map;
  }

  setCenter() {}
  setRadius(r) {
    this._radius = r;
  }
  getRadius() {
    return this._radius;
  }
}
MockCircle.seq = 0;

export class MockMap {
  constructor() {
    this._overlays = new Map();
    this._controls = [];
    this.destroyed = false;
    // duck-type 成 MapView(ws-c):engine 命名空间 + 逃生舱 raw = 自身
    this.engine = { namespace: 'AMap', id: 'amap' };
    this.raw = this;
  }

  destroy() {
    this.destroyed = true;
  }

  addOverlay(overlay) {
    this._overlays.set(overlay.id, overlay);
  }

  removeOverlay(overlay) {
    this._overlays.delete(overlay.id);
  }

  getAllOverlays(type) {
    const all = Array.from(this._overlays.values());
    if (!type) return all;
    return all.filter((o) => (type === 'marker' ? o instanceof MockMarker : o.constructor.name === type));
  }

  /** MapView.createMarker(ws-c):构造即注册到本视图 overlay 表,返回 MapMarker 契约包装
   *  (raw = MockMarker;setZIndex/setVisible/on/off/remove 全契约方法,并记录调用次数
   *  到 marker.contractCalls 供测试断言——三引擎适配层对同一契约语义一致) */
  createMarker(opts) {
    const marker = new MockMarker({ ...opts, map: this });
    const calls = { setPosition: 0, setContent: 0, setZIndex: 0, setVisible: 0, on: 0, off: 0, remove: 0 };
    marker.contractCalls = calls;
    return {
      raw: marker,
      setPosition: (p) => {
        calls.setPosition += 1;
        marker.setPosition([p.lng, p.lat]);
      },
      setContent: (html) => {
        calls.setContent += 1;
        marker.setContent(html);
      },
      setZIndex: (z) => {
        calls.setZIndex += 1;
        marker.setzIndex(z);
      },
      setVisible: (v) => {
        calls.setVisible += 1;
        if (v) marker.show();
        else marker.hide();
      },
      on: (event, cb) => {
        calls.on += 1;
        marker.on(event, cb);
      },
      off: (event, cb) => {
        calls.off += 1;
        marker.off(event, cb);
      },
      remove: () => {
        calls.remove += 1;
        marker.setMap(null);
      },
      // 挂载探测(契约 isAttached):getMap() 非 null = 仍挂地图(外部 mockDetach
      // 后为 false → 控制器 sync() 检测到「被外部删除」并重建)
      isAttached: () => marker.getMap() !== null,
    };
  }

  /** MapView.createCircle(ws-c):构造即注册到本视图 overlay 表 */
  createCircle(opts) {
    const circle = new MockCircle(opts);
    circle.setMap(this);
    return { raw: circle, remove: () => circle.setMap(null) };
  }

  addControl() {}
  removeControl() {}
  setZoomAndCenter() {}
  setFitView() {}
  getCenter() {
    return { getLng: () => 120.15, getLat: () => 30.27 };
  }
  getBounds() {
    return null;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

export class MockIcon {
  constructor(opts) {
    this.opts = opts;
  }
}

export class MockPixel {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

export class MockSize {
  constructor(w, h) {
    this.w = w;
    this.h = h;
  }
}

/** 组装完整 AMap 命名空间。 */
export function makeAMapNamespace() {
  return {
    Marker: MockMarker,
    Icon: MockIcon,
    Pixel: MockPixel,
    Size: MockSize,
  };
}

/**
 * 安装浏览器环境 mock(供 amap-api.loadAMap 判定 isBrowser)。
 *
 * 注意:amap-api 引用的是全局 document(不是 window.document),所以这里
 * 必须把 documentMock 挂到 globalThis 上,否则非 immediate 模式的
 * loadAMap 会抛 ReferenceError 而静默 reject(控制器 .catch 吞掉 →
 * flush 永不发生 → 异步竞态测试全部假阳性)。
 *
 * @param opts.immediate 为 true 时 window.AMap 立即可用(loadAMap 微任务 resolve);
 *   为 false 时挂起:amap-api 创建 script 元素并等待 onload,测试通过
 *   amapReady() 手动触发(需 NEXT_PUBLIC_AMAP_KEY / SECURITY_CODE 环境变量)。
 */
export function installAMapMock({ immediate = true } = {}) {
  resetAMapLoader();

  let lastScript = null;
  const documentMock = {
    getElementById: () => null,
    createElement: (tag) => {
      if (tag !== 'script') return { style: {} };
      lastScript = {
        style: {},
        id: '',
        src: '',
        async: false,
        onload: null,
        onerror: null,
        addEventListener() {},
        remove() {},
      };
      return lastScript;
    },
    head: { appendChild() {} },
  };

  const win = {
    document: documentMock,
    _AMapSecurityConfig: {},
  };
  if (immediate) {
    win.AMap = makeAMapNamespace();
  }
  globalThis.window = win;
  globalThis.document = documentMock;

  return {
    ns: win.AMap || null,
    /** 模拟脚本加载完成:挂载 AMap 并触发 onload → loadAMap resolve。 */
    amapReady: () => {
      if (!win.AMap) win.AMap = makeAMapNamespace();
      if (lastScript?.onload) lastScript.onload();
    },
    /** 模拟脚本加载失败。 */
    amapError: () => {
      if (lastScript?.onerror) lastScript.onerror();
    },
  };
}

/** 卸载 mock,恢复干净环境(同时重置 amap-api 的 loadPromise 缓存)。 */
export function uninstallAMapMock() {
  resetAMapLoader();
  delete globalThis.window;
  delete globalThis.document;
}

/** 构造招聘 POI(与 types.ts RecruitmentPOI 形状一致)。 */
export function makePoi(id, name, lng, lat, extra = {}) {
  return {
    id,
    kind: 'recruitment',
    mode: 'work',
    name,
    location: { lng, lat },
    company: { id: `c-${id}`, name, logo: '🏢' },
    ...extra,
  };
}

/** 构造 Domain POI(与 types.ts DomainPOI 形状一致)。 */
export function makeDomainPoi(id, name, lng, lat, extra = {}) {
  return {
    id,
    kind: 'domain',
    mode: 'domain',
    name,
    location: { lng, lat },
    category: '测试',
    ...extra,
  };
}
