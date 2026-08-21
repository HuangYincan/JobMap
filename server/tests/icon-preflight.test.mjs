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
//   未验证 → 徽章 dataURL + 后台预检触发;ok → 真 src;fail → 徽章且不重试;
//   成功升级路径(下次重建真 logo);data URL / 缺 logo → 徽章或直通零预检;
//   AMap 引擎零变化(不设 icon)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRemoteIconUrl,
  preflightRemoteIcon,
  remoteIconStatus,
  resetIconPreflightCache,
} from '../src/lib/map-engine/icon-preflight.ts';
import { createPOIMarkerController } from '../src/lib/map-markers.ts';
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

test('TMap icon:预检成功 → 真 logo src;升级路径(下次重建自然升级)', async () => {
  const image = installImageMock();
  try {
    // 先预检成功
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok');
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', REMOTE)]);
    assert.equal(calls[0].icon.src, REMOTE, '已预检 ok → 真 logo 直通');
    assert.equal(image.calls.length, 1, 'ok 缓存命中,不重复预检');
    // 升级路径:LOD 重建新增同 URL 新 POI → 真 logo
    c.setPOIs([makeRecruitPoi('p1', REMOTE), makeRecruitPoi('p2', REMOTE)]);
    assert.equal(calls[1].icon.src, REMOTE, '重建的新 marker 拿到 ok 状态 → 真 logo');
    assert.equal(image.calls.length, 1);
    c.destroy();
  } finally {
    image.restore();
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

test('TMap icon:AMap 引擎零变化(不设 icon,content 徽章路径不变)', async () => {
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
    assert.equal(calls[0].icon, undefined, 'AMap 不设 icon(HTML content 徽章路径)');
    assert.ok(String(calls[0].content).includes('dm-badge'), 'content 徽章仍在');
    assert.equal(image.calls.length, 0, 'AMap 路径不触发预检');
    c.destroy();
  } finally {
    image.restore();
  }
});
