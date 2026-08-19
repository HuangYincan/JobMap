// ============================================================
// AMap v2 最小可测 mock — 复刻真实浏览器关键语义:
// - Marker({ map }) 构造函数即把自身注册进 map 的 overlay 表
// - setMap(null) 从 overlay 表摘除(等价 AMap v2 removeOverlay)
// - getAllOverlays('marker') 返回全部 marker overlay
// - loadAMap 两种就绪模式:
//   immediate=true  → window.AMap 已存在,构造控制器后微任务即 flush
//   immediate=false → AMap 脚本加载挂起,测试手动 amapReady() 触发 flush
//   (模拟 map 创建与 AMap 脚本就绪的异步竞态)
// ============================================================

import { resetAMapLoader } from '../../src/lib/amap-api.ts';

export class MockMarker {
  constructor(opts) {
    this.opts = opts || {};
    this.id = this.opts.id || `mock-marker-${++MockMarker.seq}`;
    this._map = null;
    this._listeners = {};
    this.position = this.opts.position || null;
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

  getPosition() {
    return this.position;
  }

  setPosition(pos) {
    this.position = pos;
  }

  on(evt, fn) {
    (this._listeners[evt] ||= []).push(fn);
  }

  trigger(evt, payload) {
    for (const fn of this._listeners[evt] || []) fn(payload);
  }

  setzIndex() {}
  setIcon() {}
  setContent() {}
  setOffset() {}
  setLabel() {}
}
MockMarker.seq = 0;

export class MockMap {
  constructor() {
    this._overlays = new Map();
    this._controls = [];
    this.destroyed = false;
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
