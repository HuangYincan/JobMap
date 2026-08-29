// ============================================================
// 图标 CORS 预检测试(ws-e,fix/icon-cors-preflight;ws-f,fix/icon-preflight-silent)
//
// 覆盖:
// - 纯模块(icon-preflight.ts):data 直通 / 远程 unknown / 预检成功 ok /
//   失败(CORS 拒绝·不可解码)fail / 幂等(缓存命中不重试·pending 去重)/
//   data URI 不预检 / isRemoteIconUrl 闸 / reset 测试钩子;
// - ws-f Image 预检路径:new Image() + crossOrigin='anonymous' +
//   referrerPolicy='no-referrer' 断言;onload=ok / onerror=fail;
// - ws-f sessionStorage 失败持久化:失败 URL 防抖合并写入(单次 setItem)、
//   reset 后从 sessionStorage 读回 fail、已知失败 URL 零新预检;
//   隐私模式(get/set throw)与损坏内容(JSON 解析失败)静默降级不抛;
// - map-markers TMap icon 构造(控制器级,假 tencent view):
//   未验证 → 徽章 dataURL + 后台预检触发;ok → fetch 字节内联进徽章 SVG
//   (ws-k:SVG-as-image 不抓远程子资源,必须内联);fail → 徽章且不重试;
//   成功升级路径(下次重建真 logo);data URL / 缺 logo → 徽章或直通零预检;
//   AMap 与 TMap 同走 GL icon(dataURL 徽章;LabelMarker 纹理须 CORS-clean)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ICON_PREFLIGHT_FAIL_RAW_MAX,
  ICON_PREFLIGHT_FAIL_LIST_MAX,
  ICON_PREFLIGHT_URL_MAX,
  isRemoteIconUrl,
  preflightRemoteIcon,
  remoteIconStatus,
  resetIconPreflightCache,
} from '../src/lib/map-engine/icon-preflight.ts';
import { createPOIMarkerController, resetRemoteIconDataUriCache } from '../src/lib/map-markers.ts';
import { makePoi } from './fixtures/amap-mock.mjs';

const REMOTE = 'https://favicon.im/example.com';
const OTHER = 'https://icon.horse/icon/example.com';
const THIRD = 'https://favicon.im/third.com';

// ---- Image mock 基建 ------------------------------------------------------
//
// 模拟浏览器图片加载:failUrls 命中 → onerror(无 CORS 头 / 网络失败 /
// 不可解码);否则 onload。加载在 queueMicrotask 异步触发(贴近真实网络)。
// deferredUrls 命中 → 不自动触发,测试手动调 onload/onerror(pending 去重用)。

function installImageMock({ failUrls = [], deferredUrls = [] } = {}) {
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
      if (deferredUrls.includes(url)) return;
      queueMicrotask(() => {
        if (failUrls.includes(url)) {
          if (typeof this.onerror === 'function') {
            this.onerror(new Error('image load failed'));
          }
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

// ---- sessionStorage mock 基建 ---------------------------------------------
//
// 内存版 sessionStorage;throwOnGet/throwOnSet 模拟隐私模式禁用。

function installSessionStorageMock({ throwOnGet = false, throwOnSet = false } = {}) {
  const original = globalThis.sessionStorage;
  const store = new Map();
  const opLog = { sets: 0 };
  globalThis.sessionStorage = {
    getItem: (k) => {
      if (throwOnGet) throw new DOMException('blocked by privacy mode', 'SecurityError');
      return store.has(k) ? store.get(k) : null;
    },
    setItem: (k, v) => {
      opLog.sets += 1;
      if (throwOnSet) throw new DOMException('blocked by privacy mode', 'SecurityError');
      store.set(k, v);
    },
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i],
    get length() {
      return store.size;
    },
  };
  return { store, opLog, restore: () => (globalThis.sessionStorage = original) };
}

const FAIL_KEY = 'domain-map:icon-preflight-fail';
const readFailList = (store) => JSON.parse(store.get(FAIL_KEY));

const settle = () => new Promise((r) => setTimeout(r, 0));

/** 1×1 红色 PNG(ws-k 远程图标内联 fetch mock 的响应字节)。 */
const PNG_BYTES = new Uint8Array(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
    .split('')
    .map((c) => c.charCodeAt(0))
);
const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** fetch mock(ws-k 内联升级):任意 URL → 1×1 PNG;failUrls → 404。 */
function installFetchMock({ failUrls = [] } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (failUrls.includes(String(url))) {
      return new Response('not found', { status: 404 });
    }
    return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test.beforeEach(() => {
  resetIconPreflightCache();
  // Node ≥22 暴露实验性全局 sessionStorage(真实存储,模块 flush 可能残留)→
  // 清掉失败清单,保证测试相互隔离(隐私模式等不可用时忽略)。
  try {
    globalThis.sessionStorage?.removeItem(FAIL_KEY);
  } catch {
    // 忽略:sessionStorage 不可用时无需清理
  }
});

test.afterEach(() => {
  resetIconPreflightCache();
  resetRemoteIconDataUriCache();
});

// ---- 纯模块:状态机 --------------------------------------------------------

test('remoteIconStatus:data URI 恒 data;未预检远程恒 unknown', () => {
  assert.equal(remoteIconStatus('data:image/svg+xml,%3Csvg%3E'), 'data');
  assert.equal(remoteIconStatus('data:image/png;base64,AAAA'), 'data');
  assert.equal(remoteIconStatus(REMOTE), 'unknown');
  assert.equal(remoteIconStatus('https://a.example/logo.png'), 'unknown');
});

test('isRemoteIconUrl:仅 http(s) 为远程;data/相对/blob 恒 false', () => {
  assert.equal(isRemoteIconUrl('https://favicon.im/x'), true);
  assert.equal(isRemoteIconUrl('http://favicon.im/x'), true);
  assert.equal(isRemoteIconUrl('data:image/svg+xml,abc'), false);
  assert.equal(isRemoteIconUrl('/local/logo.png'), false);
  assert.equal(isRemoteIconUrl('pin.svg'), false);
  assert.equal(isRemoteIconUrl('blob:http://localhost:3000/uuid'), false);
});

test('preflightRemoteIcon:图像可解码(onload)→ ok;Image 以匿名 CORS 加载', async () => {
  const image = installImageMock();
  try {
    preflightRemoteIcon(REMOTE);
    assert.equal(remoteIconStatus(REMOTE), 'unknown', '预检未决期间仍 unknown');
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok', 'onload → ok');
    assert.equal(image.calls.length, 1);
    assert.equal(image.calls[0].src, REMOTE, '预检加载目标 URL');
    assert.equal(image.calls[0].crossOrigin, 'anonymous', 'CORS 匿名加载(与纹理加载同源)');
    assert.equal(image.calls[0].referrerPolicy, 'no-referrer', '不发 referrer');
  } finally {
    image.restore();
  }
});

test('preflightRemoteIcon:CORS 拒绝/网络失败(onerror)→ fail(记忆化)', async () => {
  const image = installImageMock({ failUrls: [REMOTE] });
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail', '无 ACAO 头 → onerror → fail');
  } finally {
    image.restore();
  }
});

test('preflightRemoteIcon:404/不可解码(onerror)→ fail', async () => {
  const image = installImageMock({ failUrls: [REMOTE] });
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail', '错误页/坏图像 → onerror → fail');
  } finally {
    image.restore();
  }
});

test('幂等:已缓存(fail)不重试;pending 期间去重不重复发起', async () => {
  const image = installImageMock({ deferredUrls: [REMOTE] });
  try {
    preflightRemoteIcon(REMOTE);
    assert.equal(image.calls.length, 1);
    preflightRemoteIcon(REMOTE);
    preflightRemoteIcon(REMOTE);
    assert.equal(image.calls.length, 1, 'pending 期间重复调用不发起新预检');
    image.calls[0].onerror(new Error('network down'));
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail');
    preflightRemoteIcon(REMOTE);
    assert.equal(image.calls.length, 1, 'fail 记忆化:同会话不重试');
    preflightRemoteIcon(OTHER);
    await settle();
    assert.equal(remoteIconStatus(OTHER), 'ok', '另一 URL 独立状态(不受 REMOTE fail 影响)');
  } finally {
    image.restore();
  }
});

test('preflightRemoteIcon:data URI 与 ok 缓存不预检;无全局 Image 时 no-op', async () => {
  const image = installImageMock();
  try {
    preflightRemoteIcon('data:image/svg+xml,abc');
    preflightRemoteIcon('data:image/png;base64,AAAA');
    await settle();
    assert.equal(image.calls.length, 0, 'data URI 恒不预检');
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok');
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(image.calls.length, 1, 'ok 已缓存 → 不重试');
  } finally {
    image.restore();
  }
  const original = globalThis.Image;
  delete globalThis.Image;
  try {
    resetIconPreflightCache();
    preflightRemoteIcon(OTHER);
    assert.equal(remoteIconStatus(OTHER), 'unknown', '无 Image 环境 no-op,保持 unknown 不抛');
  } finally {
    globalThis.Image = original;
  }
});

test('resetIconPreflightCache:清空缓存与 pending', async () => {
  const image = installImageMock();
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok');
    resetIconPreflightCache();
    assert.equal(remoteIconStatus(REMOTE), 'unknown', '重置后回到未预检');
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok', '重置后允许重新预检');
  } finally {
    image.restore();
  }
});

// ---- ws-f:sessionStorage 失败持久化 ----------------------------------------

test('sessionStorage:失败 URL 防抖写入;reset 后状态从 sessionStorage 读回 fail', async () => {
  const image = installImageMock({ failUrls: [REMOTE] });
  const ss = installSessionStorageMock();
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(ss.store.has(FAIL_KEY), true, '失败已持久化');
    assert.deepEqual(readFailList(ss.store), [REMOTE], '失败清单含该 URL');
    // 模块级缓存清空后,查询回退 sessionStorage → 仍 fail
    resetIconPreflightCache();
    assert.equal(remoteIconStatus(REMOTE), 'fail', '内存未命中 → sessionStorage 回退 fail');
    // 已知失败 URL 不再发起新预检
    preflightRemoteIcon(REMOTE);
    assert.equal(image.calls.length, 1, 'sessionStorage 已知失败 → 零新预检');
    assert.equal(remoteIconStatus(REMOTE), 'fail');
  } finally {
    image.restore();
    ss.restore();
  }
});

test('sessionStorage:多次失败合并为单次 setItem(防抖);后续失败与既有清单合并', async () => {
  const FOURTH = 'https://favicon.im/fourth.com';
  const image = installImageMock({ failUrls: [REMOTE, OTHER, THIRD, FOURTH] });
  const ss = installSessionStorageMock();
  try {
    preflightRemoteIcon(REMOTE);
    preflightRemoteIcon(OTHER);
    preflightRemoteIcon(THIRD);
    await settle();
    assert.equal(ss.opLog.sets, 1, '同一宏任务内多次失败 → 单次写入');
    const list = readFailList(ss.store);
    assert.equal(list.length, 3, '三个失败 URL 一次合并写入');
    for (const u of [REMOTE, OTHER, THIRD]) assert.ok(list.includes(u), `清单含 ${u}`);
    // 下一波失败(新宏任务)→ 与既有清单合并,不覆盖
    preflightRemoteIcon(FOURTH);
    await settle();
    assert.equal(ss.opLog.sets, 2, '新一波失败 → 第二次写入');
    assert.equal(readFailList(ss.store).length, 4, '合并写入,不丢既有条目');
  } finally {
    image.restore();
    ss.restore();
  }
});

test('sessionStorage:隐私模式(get/set throw)→ 静默降级,内存记忆照常,绝不抛错', async () => {
  const image = installImageMock({ failUrls: [REMOTE] });
  const ss = installSessionStorageMock({ throwOnGet: true, throwOnSet: true });
  try {
    preflightRemoteIcon(REMOTE); // 读(knownFail)+ 写(rememberFail)均被拒 → 不抛
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail', '内存记忆不依赖 sessionStorage');
    assert.equal(ss.opLog.sets, 0, '写入被拒 → 放弃持久化');
    // 新 URL 查询也不因读取失败抛错
    assert.equal(remoteIconStatus('https://favicon.im/unseen.com'), 'unknown');
  } finally {
    image.restore();
    ss.restore();
  }
});

test('sessionStorage:损坏内容(JSON 解析失败)→ 按无记忆处理不抛', async () => {
  const image = installImageMock();
  const ss = installSessionStorageMock();
  ss.store.set(FAIL_KEY, '{not valid json!!');
  try {
    assert.equal(remoteIconStatus(REMOTE), 'unknown', '损坏内容 → 无记忆,不抛');
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok', '损坏内容不阻断正常预检');
    assert.equal(ss.opLog.sets, 0, '无失败 → 不触发写入,损坏内容原样留存(下次仍按无记忆处理)');
  } finally {
    image.restore();
    ss.restore();
  }
});

test('sessionStorage:非数组内容按空清单处理,不抛', () => {
  const ss = installSessionStorageMock();
  ss.store.set(FAIL_KEY, '{"a":1}');
  try {
    assert.equal(remoteIconStatus(REMOTE), 'unknown');
  } finally {
    ss.restore();
  }
});

// ---- map-markers TMap icon 构造(控制器级)----------------------------------

/** 假 tencent view:记录 createMarker 收到的 opts,返回契约包装。 */
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

/** GL view:同时记录 createMarker 与契约 setIcon(AMap LabelMarker / TMap MultiMarker 点选换肤路径)。 */
function makeGlView(engineId = 'amap') {
  const creates = [];
  const icons = [];
  const view = {
    engine: { id: engineId },
    isDestroyed: () => false,
    createMarker: (opts) => {
      creates.push(opts);
      if (opts.icon) icons.push(opts.icon);
      return {
        on: () => {},
        setPosition: () => {},
        setZIndex: () => {},
        setVisible: () => {},
        setContent: () => {},
        setIcon: (icon) => {
          icons.push(icon);
        },
        remove: () => {},
      };
    },
  };
  return { view, creates, icons };
}

function decodeIconSvg(src) {
  return decodeURIComponent(String(src).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
}

function assertLogoBadge(src, label) {
  const svg = decodeIconSvg(src);
  assert.ok(svg.includes(`href="${PNG_DATA_URI}"`), `${label}:须保留内联真 logo`);
  assert.ok(!svg.includes('>🏢<'), `${label}:不得退回 emoji 徽章`);
}

/** 招聘 POI(company.logoUrl 可控)。 */
function makeRecruitPoi(id, logoUrl) {
  return makePoi(id, `公司${id}`, 120.1, 30.2, {
    company: { id: `c-${id}`, name: `公司${id}`, logo: '🏢', logoUrl },
  });
}

test('TMap icon:远程未验证 → 徽章 dataURL 降级 + 后台 Image 匿名预检触发', async () => {
  const image = installImageMock();
  try {
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', REMOTE)]);
    const icon = calls[0].icon;
    assert.ok(icon, 'TMap 公司 POI 走契约 icon 路径');
    assert.ok(String(icon.src).startsWith('data:image/svg+xml'), `未验证 → 徽章 dataURL(实际:${String(icon.src).slice(0, 40)}…)`);
    assert.notEqual(icon.src, REMOTE, '远程未验证绝不直接作纹理 src');
    assert.deepEqual(icon.size, [40, 40], '徽章 40×40 与 AMap 同视觉');
    assert.equal(image.calls.length, 1, '未验证 → 触发后台预检');
    assert.equal(image.calls[0].src, REMOTE);
    assert.equal(image.calls[0].crossOrigin, 'anonymous', '预检走匿名 CORS Image');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('TMap icon:预检成功 → 真 logo(字节内联进徽章 SVG,ws-k);升级路径(下次重建自然升级)', async () => {
  const image = installImageMock();
  const fetchMock = installFetchMock();
  try {
    // 先预检成功
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok');
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', REMOTE)]);
    // 内联未就绪(字节未 fetch)→ 先挂 emoji 徽章(绝不裸 URL 作纹理)
    assert.ok(String(calls[0].icon.src).startsWith('data:image/svg+xml'), '内联未就绪 → emoji 徽章(不裸传 URL,ws-k)');
    assert.equal(image.calls.length, 1, 'ok 缓存命中,不重复预检');
    await settle();
    // fetch 完成 → 原地重建升级:徽章包裹 base64 dataURI
    assert.equal(fetchMock.calls.length, 1, '远程字节 fetch 1 次(CORS 可读)');
    const svg1 = decodeURIComponent(String(calls[1].icon.src).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    assert.ok(svg1.includes(`href="${PNG_DATA_URI}"`), 'fetch 字节 base64 内联进徽章 SVG(真 logo 进入白底边框徽章)');
    assert.ok(svg1.includes('fill="#ffffff"') && svg1.includes('stroke-width="2"'), '白底 + 边框保留(升级不丢徽章形态)');
    // 升级路径:LOD 重建新增同 URL 新 POI → 缓存命中,同步徽章包裹真 logo
    c.setPOIs([makeRecruitPoi('p1', REMOTE), makeRecruitPoi('p2', REMOTE)]);
    const svg2 = decodeURIComponent(String(calls[2].icon.src).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    assert.ok(svg2.includes(`href="${PNG_DATA_URI}"`), '重建的新 marker 缓存命中 → 同步徽章包裹真 logo');
    assert.equal(fetchMock.calls.length, 1, '缓存记忆化:同 URL 零重复 fetch');
    assert.equal(image.calls.length, 1);
    c.destroy();
  } finally {
    image.restore();
    fetchMock.restore();
  }
});

test('TMap icon:预检失败 → 徽章降级且失败记忆化不重试', async () => {
  const image = installImageMock({ failUrls: [REMOTE] });
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail');
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    // 同 URL 两个 POI(fail 记忆化:第二个也不重试)
    c.setPOIs([makeRecruitPoi('p1', REMOTE), makeRecruitPoi('p2', REMOTE)]);
    assert.ok(String(calls[0].icon.src).startsWith('data:image/svg+xml'), 'fail → 徽章');
    assert.ok(String(calls[1].icon.src).startsWith('data:image/svg+xml'), 'fail → 徽章');
    assert.equal(image.calls.length, 1, 'fail 记忆化:同会话不重试');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('TMap icon:data URL logo / 缺 logo → 本地直通零预检', async () => {
  const image = installImageMock();
  try {
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    const dataLogo = 'data:image/svg+xml,%3Csvg%3Elogo';
    c.setPOIs([
      makeRecruitPoi('p1', dataLogo), // data URL → 原样
      makeRecruitPoi('p2', undefined), // 缺 logo → 徽章
    ]);
    assert.equal(calls[0].icon.src, dataLogo, 'data URL logo 原样直通');
    assert.ok(String(calls[1].icon.src).startsWith('data:image/svg+xml'), '缺 logo → 徽章');
    assert.equal(image.calls.length, 0, '本地形态零预检');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('GL icon:AMap 与 TMap 同走 dataURL 徽章(不把未验证远程 URL 当纹理)', async () => {
  const image = installImageMock();
  try {
    const calls = [];
    const view = {
      engine: { id: 'amap' },
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
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', REMOTE)]);
    assert.ok(calls[0].icon, 'AMap 公司 POI 走契约 icon(LabelMarker WebGL)');
    assert.ok(String(calls[0].icon.src).startsWith('data:image/svg+xml'), '未验证 → 徽章 dataURL');
    assert.notEqual(calls[0].icon.src, REMOTE, '远程未验证绝不直接作纹理 src');
    assert.ok(String(calls[0].content).includes('dm-badge'), 'content 仍传(HTML 降级)');
    assert.equal(image.calls.length, 1, 'AMap 路径同样触发预检');
    c.destroy();
  } finally {
    image.restore();
  }
});

test('GL icon:点选已升级真 logo 的公司不得退回 emoji(AMap/TMap)', async () => {
  const image = installImageMock();
  const fetchMock = installFetchMock();
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    for (const engineId of ['amap', 'tencent']) {
      const { view, icons } = makeGlView(engineId);
      const c = createPOIMarkerController(view, {});
      c.setPOIs([makeRecruitPoi('p1', REMOTE)]);
      await settle();
      const upgraded = icons.at(-1);
      assertLogoBadge(upgraded.src, `${engineId} 升级后`);
      const beforeSelect = icons.length;
      c.select('p1');
      assert.ok(icons.length > beforeSelect, `${engineId} 点选走 setIcon`);
      const selected = icons.at(-1);
      assertLogoBadge(selected.src, `${engineId} 点选后`);
      assert.ok(
        decodeIconSvg(selected.src).includes('opacity="0.45"'),
        `${engineId} 点选后须带 selected 外圈`,
      );
      c.destroy();
    }
  } finally {
    image.restore();
    fetchMock.restore();
  }
});

test('GL icon:点选时内联缓存已清空仍不得把真 logo 盖成 emoji', async () => {
  const image = installImageMock();
  const fetchMock = installFetchMock();
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    const { view, icons } = makeGlView('amap');
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', REMOTE)]);
    await settle();
    assertLogoBadge(icons.at(-1).src, '升级后');
    resetRemoteIconDataUriCache();
    c.select('p1');
    assertLogoBadge(icons.at(-1).src, '缓存清空后点选');
    c.destroy();
  } finally {
    image.restore();
    fetchMock.restore();
  }
});

test('sessionStorage 失败清单有界,超限保留最近失败', async () => {
  const oldUrls = Array.from(
    { length: ICON_PREFLIGHT_FAIL_LIST_MAX + 50 },
    (_, i) => `https://icons.test/old-${i}.png`,
  );
  const recentUrls = [
    'https://icons.test/new-a.png',
    'https://icons.test/new-b.png',
    'https://icons.test/new-c.png',
  ];
  const storage = installSessionStorageMock();
  storage.store.set(FAIL_KEY, JSON.stringify(oldUrls));
  const image = installImageMock({ failUrls: recentUrls });

  try {
    for (const url of recentUrls) preflightRemoteIcon(url);
    await settle();

    const failures = readFailList(storage.store);
    assert.equal(failures.length, ICON_PREFLIGHT_FAIL_LIST_MAX);
    assert.ok(!failures.includes(oldUrls[0]), '最旧失败被裁剪');
    for (const url of recentUrls) {
      assert.ok(failures.includes(url), '最近失败仍在清单中');
      assert.equal(remoteIconStatus(url), 'fail');
    }
  } finally {
    image.restore();
    storage.restore();
  }
});

test('读取超长持久化失败清单时先裁剪', () => {
  const oldUrls = Array.from(
    { length: ICON_PREFLIGHT_FAIL_LIST_MAX + 1 },
    (_, i) => `https://icons.test/read-${i}.png`,
  );
  const storage = installSessionStorageMock();
  storage.store.set(FAIL_KEY, JSON.stringify(oldUrls));

  try {
    resetIconPreflightCache();
    assert.equal(remoteIconStatus(oldUrls.at(-1)), 'fail');
    assert.equal(remoteIconStatus(oldUrls[0]), 'unknown');
  } finally {
    storage.restore();
  }
});

test('超长远程 URL 不进入预检或持久失败清单', async () => {
  const longUrl = `https://icons.test/${'x'.repeat(ICON_PREFLIGHT_URL_MAX)}`;
  assert.equal(longUrl.length > ICON_PREFLIGHT_URL_MAX, true);
  assert.equal(isRemoteIconUrl(longUrl), false);

  resetIconPreflightCache();
  const image = installImageMock();
  try {
    preflightRemoteIcon(longUrl);
    assert.equal(image.calls.length, 0, '无效超长 URL 不创建预检请求');
    assert.equal(remoteIconStatus(longUrl), 'unknown');
    await settle();
  } finally {
    image.restore();
  }
});

test('超大 sessionStorage 原文按损坏处理并被有效失败清单替换', async () => {
  const storage = installSessionStorageMock();
  storage.store.set(FAIL_KEY, 'x'.repeat(ICON_PREFLIGHT_FAIL_RAW_MAX + 1));
  const image = installImageMock({ failUrls: [REMOTE] });

  try {
    resetIconPreflightCache();
    assert.equal(remoteIconStatus(REMOTE), 'unknown');
    preflightRemoteIcon(REMOTE);
    await settle();

    assert.deepEqual(readFailList(storage.store), [REMOTE]);
    assert.equal(remoteIconStatus(REMOTE), 'fail');
  } finally {
    image.restore();
    storage.restore();
  }
});

test('持久化清单中的非 http(s) 字符串被过滤', () => {
  const storage = installSessionStorageMock();
  storage.store.set(FAIL_KEY, JSON.stringify(['javascript:alert(1)', '/local.png', REMOTE]));

  try {
    resetIconPreflightCache();
    assert.equal(remoteIconStatus('javascript:alert(1)'), 'unknown');
    assert.equal(remoteIconStatus('/local.png'), 'unknown');
    assert.equal(remoteIconStatus(REMOTE), 'fail');
  } finally {
    storage.restore();
  }
});
