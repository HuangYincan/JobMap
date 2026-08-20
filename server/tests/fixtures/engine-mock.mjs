// ============================================================
// 通用引擎 mock 工厂 — 可安装到任意厂商命名空间(TMap / BMapGL / AMap)
//
// 供 map-engine 内核测试与后续 ws-d(腾讯)/ ws-e(百度)引擎实现测试使用。
// installEngineMock(namespace, { coordSystem }) 返回:
// - MockView:getState/getBounds/isDestroyed/setCenter/setZoom/setPitch/
//   setRotation/setBounds/flyTo/setStyle/on(返回解绑)/createMarker/
//   createCircle/addControl/destroy + raw(逃生舱=自身)
// - MockMarker:setPosition/setContent/remove
// - MockCircle:remove
// - search stub(全返回空/失败安全值)
// 并挂到 globalThis[namespace];返回 uninstall() 摘除。
// ============================================================

export class MockMarker {
  constructor(opts = {}) {
    this.opts = opts;
    this.position = opts.position ?? null;
    this.content = opts.content ?? null;
    this.removed = false;
  }

  setPosition(p) {
    this.position = p;
  }

  getPosition() {
    return this.position;
  }

  setContent(html) {
    this.content = html;
  }

  getContent() {
    return this.content;
  }

  remove() {
    this.removed = true;
  }
}

export class MockCircle {
  constructor(opts = {}) {
    this.opts = opts;
    this.removed = false;
  }

  remove() {
    this.removed = true;
  }
}

export class MockView {
  constructor(opts = {}) {
    this.opts = opts;
    this.state = {
      center: { ...(opts.center ?? { lng: 120.15, lat: 30.27 }) },
      zoom: opts.zoom ?? 13,
      pitch: opts.pitch ?? 0,
      rotation: opts.rotation ?? 0,
    };
    this.bounds = null;
    this.style = opts.style ?? 'normal';
    this.destroyed = false;
    this.listeners = new Map();
    this.markers = [];
    this.circles = [];
    this.control = null;
    this.raw = this; // 逃生舱:mock 自身即 raw 实例
  }

  getState() {
    return { ...this.state };
  }

  getBounds() {
    return this.bounds;
  }

  isDestroyed() {
    return this.destroyed;
  }

  setCenter(center, animateMs) {
    this.state.center = { lng: center.lng, lat: center.lat };
    return this;
  }

  setZoom(zoom, animateMs) {
    this.state.zoom = zoom;
    return this;
  }

  setPitch(pitch, animateMs) {
    this.state.pitch = pitch;
    return this;
  }

  setRotation(rotation, animateMs) {
    this.state.rotation = rotation;
    return this;
  }

  setBounds(bounds) {
    this.bounds = bounds;
    return this;
  }

  flyTo(opts = {}) {
    if (opts.center) this.state.center = { lng: opts.center.lng, lat: opts.center.lat };
    if (opts.zoom !== undefined) this.state.zoom = opts.zoom;
    return this;
  }

  setStyle(style) {
    this.style = style;
    return this;
  }

  on(event, cb) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return () => {
      const l = this.listeners.get(event) ?? [];
      this.listeners.set(event, l.filter((f) => f !== cb));
    };
  }

  trigger(event, payload) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }

  createMarker(opts) {
    const marker = new MockMarker(opts);
    this.markers.push(marker);
    return marker;
  }

  createCircle(opts) {
    const circle = new MockCircle(opts);
    this.circles.push(circle);
    return circle;
  }

  addControl(kind) {
    this.control = kind;
  }

  destroy() {
    this.destroyed = true;
  }
}

const makeSearchStub = () => ({
  searchPOI: async () => [],
  fetchSuggestions: async () => [],
  getCurrentPosition: async () => null,
  geocodeAddress: async () => null,
});

/**
 * 安装引擎 mock 到任意 namespace。
 * @param namespace 厂商命名空间名('TMap' / 'BMapGL' / 'AMap')
 * @param options.coordSystem 坐标系('gcj02' | 'bd09'),默认 'gcj02'
 * @returns { namespace, coordSystem, ns, uninstall }
 */
export function installEngineMock(namespace, { coordSystem = 'gcj02' } = {}) {
  const ns = {
    Map: MockView,
    Marker: MockMarker,
    Circle: MockCircle,
    search: makeSearchStub(),
  };
  globalThis[namespace] = ns;
  return {
    namespace,
    coordSystem,
    ns,
    uninstall() {
      delete globalThis[namespace];
    },
  };
}
