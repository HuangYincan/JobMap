// ============================================================
// 腾讯地图引擎样式/控件测试 — setStyle(卫星/深色)+ 水印隐藏 + 比例尺(ws-b)
// SDK v1.8.0.2 源码核实(2026-08-22,map.qq.com/api/gljs?v=1.exp 实包):
// - 暗色 = Map 选项 mapStyleId(STYLE_ID 常量 {DEFAULT:0,DARK:1,LIGHT:2,GAME:3},
//   'DARK' → 矢量暗色底图层 Tencent.Normal.Dark);baseMap **无 styleType 字段**
//   (旧注释「styleType:'dark' 存在」有误);
// - 公共命名空间装配表(Yd)无 control/Control/ScaleControl → 比例尺走自绘降级
//   (SDK 内部同款类名 tmap-scale-control/line/text + Oo/Eo 公式 + 米/公里文案);
// - 水印 DOM:img[src*="logo_def.png"] + div.logo-text(©2026 Tencent 文字),
//   hideControlDom 对 copyright/logo/attribution 类名 display:none。
// ============================================================

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TENCENT_ENGINE } from '../src/lib/map-engine/tencent/tencent-engine.ts';
import {
  installEngineMock,
  MockView,
  MockMarker,
  MockCircle,
  MockMultiMarker,
} from './fixtures/engine-mock.mjs';

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

/** 捕获 console.info 调用(自绘比例尺降级说明一次性日志) */
function captureInfo() {
  const orig = console.info;
  const calls = [];
  console.info = (...args) => calls.push(args);
  return {
    calls,
    restore() {
      console.info = orig;
    },
  };
}

/**
 * 假 DOM:document.createElement + 地图容器(querySelectorAll 按 [class*="x"]
 * 子串 / 裸标签匹配,足够断言 hideControlDom 与自绘比例尺的类名语义)。
 * 所有元素共享同一注册表 —— 引擎 hideControlDom 与比例尺挂载都可见。
 */
function makeFakeDom() {
  const elements = [];
  const makeEl = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      style: {},
      textContent: '',
      children: [],
      parentNode: null,
      appendChild(child) {
        child.parentNode = el;
        el.children.push(child);
      },
      removeChild(child) {
        const i = el.children.indexOf(child);
        if (i >= 0) el.children.splice(i, 1);
        child.parentNode = null;
      },
    };
    elements.push(el);
    return el;
  };
  const container = makeEl('div');
  container.querySelectorAll = (sel) => {
    const classSubs = [...sel.matchAll(/class\*="([^"]+)"/g)].map((m) => m[1]);
    const bareTags = sel
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[a-zA-Z]+$/.test(s));
    return elements.filter(
      (el) =>
        classSubs.some((sub) => el.className.includes(sub)) ||
        bareTags.some((t) => el.tagName === t.toUpperCase()),
    );
  };
  const doc = { createElement: (tag) => makeEl(tag) };
  return { elements, container, doc };
}

/**
 * 样式/控件面厂商双面:忠实 TMap v1.8.0.2 方法面(getCenter/getZoom/getScale/
 * setBaseMap/setMapStyleId/getContainer/控件 API)+ 假 DOM。默认**不装**
 * control 命名空间(真实 v1.exp 无,ws-b 核实);双路径测试自行安装。
 */
function installTMapStyleDouble() {
  const inst = installEngineMock('TMap', { coordSystem: 'gcj02' });
  const { ns } = inst;
  const { elements, container, doc } = makeFakeDom();

  ns.LatLng = class TMapLatLng {
    constructor(lat, lng) {
      this.lat = lat;
      this.lng = lng;
    }
  };
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

  // 真实 TMap.Map(container, options) 双参签名;模拟异步初始化(idle 就绪)
  ns.Map = class TMapMapView extends MockView {
    constructor(container, opts = {}) {
      super({ ...opts, container });
      this.container = container;
      this.scale = 1;
      setTimeout(() => this.trigger('idle'), 10);
    }
  };

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
    getScale() {
      return this.scale ?? 1;
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

  const originals = new Map();
  for (const [cls, patches] of [
    [MockView, viewPatches],
    [MockMarker, {}],
    [MockCircle, {}],
    [MockMultiMarker, {}],
  ]) {
    for (const [name, fn] of Object.entries(patches)) {
      originals.set(`${cls.name}:${name}`, { cls, name, had: Object.hasOwn(cls.prototype, name) });
      cls.prototype[name] = fn;
    }
  }

  return {
    ns,
    elements,
    container,
    doc,
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
async function createView(container, overrides = {}) {
  return TENCENT_ENGINE.createView({
    container,
    center: { lng: 120.15, lat: 30.27 },
    zoom: 12,
    pitch: 30,
    rotation: 45,
    style: 'normal',
    ...overrides,
  });
}

afterEach(() => {
  setKey(undefined);
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.navigator;
  delete globalThis.fetch;
});

// ------------------------------------------------------------
// 样式:卫星 / 深色
// ------------------------------------------------------------

test('setStyle:satellite→raster、normal→vector、whitesmoke→mapStyleId DARK 暗色(ws-b SDK 核实)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { container, restore } = installTMapStyleDouble();
  const warn = captureWarn();
  try {
    const view = await createView(container, { style: 'satellite' });
    assert.deepEqual(view.raw.opts.baseMap, { type: 'raster' }, '构造期 satellite → 栅格底图');

    view.setStyle('satellite');
    assert.deepEqual(view.raw.baseMap, { type: 'raster' });
    assert.equal(view.raw.mapStyleId, 'DEFAULT', '卫星不携带暗色(复位标识)');

    // UI「深色」按钮 / 系统深色偏好的 value 即 whitesmoke:不再回退 normal,
    // 映射为暗色矢量底图(mapStyleId 'DARK',SDK STYLE_ID 常量)
    view.setStyle('whitesmoke');
    assert.deepEqual(view.raw.baseMap, { type: 'vector' }, '暗色 = vector 底图');
    assert.equal(view.raw.mapStyleId, 'DARK', 'whitesmoke → mapStyleId DARK(暗色底图层)');

    view.setStyle('normal');
    assert.equal(view.raw.mapStyleId, 'DEFAULT', '切回标准复位暗色');
    assert.equal(warn.calls.length, 0, '三样式全部支持,无告警');
  } finally {
    warn.restore();
    restore();
  }
});

test('createView:初始样式 whitesmoke → 构造选项透传 mapStyleId DARK(构造期即暗色)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { container, restore } = installTMapStyleDouble();
  try {
    const view = await createView(container, { style: 'whitesmoke' });
    assert.equal(view.raw.opts.mapStyleId, 'DARK', '构造期透传暗色 mapStyleId');
    assert.deepEqual(view.raw.opts.baseMap, { type: 'vector' });

    const normal = await createView(container, { style: 'normal' });
    assert.equal(normal.raw.opts.mapStyleId, undefined, 'normal 不透传 mapStyleId(SDK 默认)');

    const sat = await createView(container, { style: 'satellite' });
    assert.equal(sat.raw.opts.mapStyleId, undefined, 'satellite 不透传 mapStyleId(栅格底图)');
  } finally {
    restore();
  }
});

test('setStyle:whitesmoke 且 SDK 无 setMapStyleId → 降级 normal + console.warn(不假装实现)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { container, restore } = installTMapStyleDouble();
  const warn = captureWarn();
  try {
    const view = await createView(container);
    MockView.prototype.setMapStyleId = undefined; // 老 SDK 形态无 setMapStyleId
    view.setStyle('whitesmoke');
    assert.deepEqual(view.raw.baseMap, { type: 'vector' });
    assert.equal(warn.calls.length, 1, '无 setMapStyleId 必须可观测告警');
    assert.match(String(warn.calls[0][0]), /降级 normal/);
  } finally {
    warn.restore();
    restore();
  }
});

// ------------------------------------------------------------
// 比例尺:命名空间双路径 + 自绘降级
// ------------------------------------------------------------

test('addControl:scale → 命名空间双路径(control/Control)存在时仍走 SDK 构造(bottomRight)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { ns, container, elements, restore } = installTMapStyleDouble();
  try {
    ns.control = {
      ScaleControl: class ScaleControl {
        constructor(opts) {
          this.opts = opts;
        }
      },
    };
    const view = await createView(container);
    const result = view.addControl('scale');
    assert.equal(result, null, 'SDK 路径成功时返回 null(与旧契约一致,map-shell duck-type 跳过)');
    assert.ok(view.raw.control instanceof ns.control.ScaleControl);
    assert.deepEqual(view.raw.control.opts, { position: 'bottomRight' });
    assert.ok(
      !elements.some((el) => el.className === 'tmap-scale-control'),
      'SDK 路径下不挂自绘比例尺 DOM',
    );
  } finally {
    restore();
  }
});

test('addControl:scale → 无公共 ScaleControl 时自绘比例尺(SDK 同款类名/公式/事件自动更新)', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { container, elements, doc, restore } = installTMapStyleDouble();
  globalThis.document = doc;
  const info = captureInfo();
  try {
    const view = await createView(container, { zoom: 15, center: { lng: 120.15, lat: 30.28 } });
    const pending = view.addControl('scale', { position: 'RB', offset: [14, 8] });
    assert.ok(pending, '返回 Promise(与 AMap 引擎同 duck-type,map-shell 可 hide/show)');
    const control = await pending;
    assert.ok(control, '自绘比例尺控件对象');

    // DOM 结构:SDK 内部控件同款类名
    const bar = elements.find((el) => el.className === 'tmap-scale-control');
    assert.ok(bar, '比例尺容器已创建');
    const line = bar.children.find((c) => c.className === 'tmap-scale-line');
    const textEl = bar.children.find((c) => c.className === 'tmap-scale-text');
    assert.ok(line && textEl, '比例尺条 + 文字元素');

    // 位置/偏移:opts 与 AMap 引擎同语义(RB → 右下)
    assert.equal(bar.style.right, '14px');
    assert.equal(bar.style.bottom, '8px');

    // 初始渲染:SDK Oo 公式 156543.04/scale·cos(lat·π/180)/2^zoom,Eo[15]=200 米
    const mpp = (156543.04 * Math.cos((30.28 * Math.PI) / 180)) / Math.pow(2, 15);
    assert.equal(line.style.width, `${Math.max(12, Math.round(200 / mpp) - 10)}px`);
    assert.equal(textEl.textContent, '200 米');

    // 自动更新:zoom 13 → Eo[13]=1000 → "1 公里"(随 zoom 事件刷新,与高德一致)
    view.raw.state.zoom = 13;
    view.raw.trigger('zoom_changed');
    assert.equal(textEl.textContent, '1 公里');
    assert.equal(view.raw.listeners.has('scale_changed'), true, 'scale_changed 已监听(捏合缩放更新)');

    // 降级说明一次性日志(可观测,不刷屏)
    assert.equal(info.calls.length, 1);
    assert.match(String(info.calls[0][0]), /自绘比例尺/);

    // hide/show 契约(移动端抽屉全开时隐藏)
    control.hide();
    assert.equal(bar.style.display, 'none');
    control.show();
    assert.equal(bar.style.display, '');

    // destroy:摘除 DOM + 解绑事件
    view.destroy();
    assert.equal(container.children.includes(bar), false, 'destroy 后比例尺 DOM 摘除');
    assert.equal(
      view.raw.listeners.get('zoom_changed')?.length ?? 0,
      0,
      'destroy 后事件解绑(监听列表清空)',
    );
  } finally {
    info.restore();
    delete globalThis.document;
    restore();
  }
});

test('addControl:scale → 重复调用(resize 重建路径)摘除旧 DOM,不产生双比例尺', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { container, doc, restore } = installTMapStyleDouble();
  globalThis.document = doc;
  try {
    const view = await createView(container);
    await view.addControl('scale', { position: 'LB', offset: [90, 25] });
    await view.addControl('scale', { position: 'LT', offset: [12, 22] });
    // 双比例尺判定按容器 children(注册表含已摘除元素的历史创建)
    const bars = container.children.filter((el) => el.className === 'tmap-scale-control');
    assert.equal(bars.length, 1, '重建只保留一个比例尺');
    assert.equal(bars[0].style.left, '12px');
    assert.equal(bars[0].style.top, '22px');
  } finally {
    delete globalThis.document;
    restore();
  }
});

// ------------------------------------------------------------
// 水印隐藏(hideControlDom DOM 类名断言)
// ------------------------------------------------------------

test('水印隐藏:copyright/logo/attribution 类名 display:none,自有样式(.dm-cluster)不受影响', async () => {
  setKey('test-key');
  globalThis.window = globalThis;
  const { container, doc, restore } = installTMapStyleDouble();
  try {
    // 预置水印 DOM(用户真机 2026-08-22 + SDK v1.8.0.2 源码类名):
    // logo 控件 = img[src*="logo_def.png"] + div.logo-text(©2026 Tencent 文字)
    const logoImg = doc.createElement('img');
    logoImg.className = 'tencent-map-ctrl-logo';
    const logoText = doc.createElement('div');
    logoText.className = 'logo-text';
    const copyright = doc.createElement('div');
    copyright.className = 'tencent-map-copyright';
    const zoomCtrl = doc.createElement('div');
    zoomCtrl.className = 'tencent-map-ctrl-zoom';
    // 自有样式:不在 copyright/logo/attribution 命中之列,必须保留可见
    const cluster = doc.createElement('div');
    cluster.className = 'dm-cluster';
    const marker = doc.createElement('div');
    marker.className = 'dm-poi-marker';

    await createView(container); // createView 内 waitForMapReady → hideControlDom

    assert.equal(logoImg.style.display, 'none', 'logo 图片(img logo_def.png 所在控件)隐藏');
    assert.equal(logoText.style.display, 'none', 'logo-text(©2026 Tencent 文字)隐藏');
    assert.equal(copyright.style.display, 'none', 'copyright 控件隐藏');
    assert.equal(zoomCtrl.style.display, 'none', '交互控件(zoom)照旧隐藏');
    assert.equal(logoText.style.pointerEvents, 'none', '隐藏同时解除点击拦截');
    assert.equal(cluster.style.display, undefined, '自有样式 .dm-cluster 不受影响');
    assert.equal(marker.style.display, undefined, '自有样式 .dm-poi-marker 不受影响');
  } finally {
    restore();
  }
});
