// ============================================================
// 图标 CORS 预检测试(ws-e,fix/icon-cors-preflight)
//
// 覆盖:
// - 纯模块(icon-preflight.ts):data 直通 / 远程 unknown / 预检成功 ok /
//   失败(CORS 拒绝·非 2xx)fail / 幂等(缓存命中不重试·pending 去重)/
//   data URI 不预检 / isRemoteIconUrl 闸 / reset 测试钩子;
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

// ---- fetch mock 基建 ------------------------------------------------------

function installFetchMock(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts, calls.length);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test.beforeEach(() => {
  resetIconPreflightCache();
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

test('preflightRemoteIcon:2xx → ok,状态可查', async () => {
  const mock = installFetchMock(async () => new Response('', { status: 200 }));
  try {
    preflightRemoteIcon(REMOTE);
    assert.equal(remoteIconStatus(REMOTE), 'unknown', '预检未决期间仍 unknown');
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok', '2xx → ok');
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, REMOTE);
    assert.deepEqual(mock.calls[0].opts, { mode: 'cors' }, 'CORS 预检 mode');
  } finally {
    mock.restore();
  }
});

test('preflightRemoteIcon:CORS 拒绝/网络失败 → fail(记忆化)', async () => {
  const mock = installFetchMock(async () => {
    throw new TypeError('Failed to fetch: CORS header missing');
  });
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail', '无 ACAO 头 → fetch reject → fail');
  } finally {
    mock.restore();
  }
});

test('preflightRemoteIcon:非 2xx(404)→ fail', async () => {
  const mock = installFetchMock(async () => new Response('not found', { status: 404 }));
  try {
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail');
  } finally {
    mock.restore();
  }
});

test('幂等:已缓存(fail)不重试;pending 期间去重不重复发起', async () => {
  // fail 记忆化:同一 URL 再次预检 → 零新 fetch;OTHER 独立状态(2xx → ok)
  let rejectFetch;
  const mock = installFetchMock(
    (url) =>
      url === REMOTE
        ? new Promise((_res, rej) => (rejectFetch = rej))
        : Promise.resolve(new Response('', { status: 200 }))
  );
  try {
    preflightRemoteIcon(REMOTE);
    assert.equal(mock.calls.length, 1);
    preflightRemoteIcon(REMOTE);
    preflightRemoteIcon(REMOTE);
    assert.equal(mock.calls.length, 1, 'pending 期间重复调用不发起新预检');
    rejectFetch(new TypeError('network down'));
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail');
    preflightRemoteIcon(REMOTE);
    assert.equal(mock.calls.length, 1, 'fail 记忆化:同会话不重试');
    preflightRemoteIcon(OTHER);
    await settle();
    assert.equal(remoteIconStatus(OTHER), 'ok', '另一 URL 独立状态(不受 REMOTE fail 影响)');
  } finally {
    mock.restore();
  }
});

test('preflightRemoteIcon:data URI 与 ok 缓存不发起 fetch;无全局 fetch 时 no-op', async () => {
  const mock = installFetchMock(async () => new Response('', { status: 200 }));
  try {
    preflightRemoteIcon('data:image/svg+xml,abc');
    preflightRemoteIcon('data:image/png;base64,AAAA');
    await settle();
    assert.equal(mock.calls.length, 0, 'data URI 恒不预检');
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok');
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(mock.calls.length, 1, 'ok 已缓存 → 不重试');
  } finally {
    mock.restore();
  }
  const original = globalThis.fetch;
  delete globalThis.fetch;
  try {
    resetIconPreflightCache();
    preflightRemoteIcon(OTHER);
    assert.equal(remoteIconStatus(OTHER), 'unknown', '无 fetch 环境 no-op,保持 unknown 不抛');
  } finally {
    globalThis.fetch = original;
  }
});

test('resetIconPreflightCache:清空缓存与 pending', async () => {
  const mock = installFetchMock(async () => new Response('', { status: 200 }));
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
    mock.restore();
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

test('TMap icon:远程未验证 → 徽章 dataURL 降级 + 后台预检触发(mode cors)', async () => {
  const mock = installFetchMock(async () => new Response('', { status: 200 }));
  try {
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', REMOTE)]);
    const icon = calls[0].icon;
    assert.ok(icon, 'TMap 公司 POI 走契约 icon 路径');
    assert.ok(String(icon.src).startsWith('data:image/svg+xml'), `未验证 → 徽章 dataURL(实际:${String(icon.src).slice(0, 40)}…)`);
    assert.notEqual(icon.src, REMOTE, '远程未验证绝不直接作纹理 src');
    assert.deepEqual(icon.size, [40, 40], '徽章 40×40 与 AMap 同视觉');
    assert.equal(mock.calls.length, 1, '未验证 → 触发后台预检');
    assert.equal(mock.calls[0].url, REMOTE);
    assert.deepEqual(mock.calls[0].opts, { mode: 'cors' });
    c.destroy();
  } finally {
    mock.restore();
  }
});

test('TMap icon:预检成功 → 真 logo src;升级路径(下次重建自然升级)', async () => {
  const mock = installFetchMock(async () => new Response('', { status: 200 }));
  try {
    // 先预检成功
    preflightRemoteIcon(REMOTE);
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'ok');
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    c.setPOIs([makeRecruitPoi('p1', REMOTE)]);
    assert.equal(calls[0].icon.src, REMOTE, '已预检 ok → 真 logo 直通');
    assert.equal(mock.calls.length, 1, 'ok 缓存命中,不重复预检');
    // 升级路径:LOD 重建新增同 URL 新 POI → 真 logo
    c.setPOIs([makeRecruitPoi('p1', REMOTE), makeRecruitPoi('p2', REMOTE)]);
    assert.equal(calls[1].icon.src, REMOTE, '重建的新 marker 拿到 ok 状态 → 真 logo');
    assert.equal(mock.calls.length, 1);
    c.destroy();
  } finally {
    mock.restore();
  }
});

test('TMap icon:预检失败 → 徽章降级且失败记忆化不重试', async () => {
  let rejectFetch;
  const mock = installFetchMock(
    () => new Promise((_res, rej) => (rejectFetch = rej))
  );
  try {
    preflightRemoteIcon(REMOTE);
    rejectFetch(new TypeError('CORS blocked'));
    await settle();
    assert.equal(remoteIconStatus(REMOTE), 'fail');
    const { view, calls } = makeTencentView();
    const c = createPOIMarkerController(view, {});
    // 同 URL 两个 POI(fail 记忆化:第二个也不重试)
    c.setPOIs([makeRecruitPoi('p1', REMOTE), makeRecruitPoi('p2', REMOTE)]);
    assert.ok(String(calls[0].icon.src).startsWith('data:image/svg+xml'), 'fail → 徽章');
    assert.ok(String(calls[1].icon.src).startsWith('data:image/svg+xml'), 'fail → 徽章');
    assert.equal(mock.calls.length, 1, 'fail 记忆化:同会话不重试');
    c.destroy();
  } finally {
    mock.restore();
  }
});

test('TMap icon:data URL logo / 缺 logo → 本地直通零预检', async () => {
  const mock = installFetchMock(async () => new Response('', { status: 200 }));
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
    assert.equal(mock.calls.length, 0, '本地形态零预检');
    c.destroy();
  } finally {
    mock.restore();
  }
});

test('TMap icon:AMap 引擎零变化(不设 icon,content 徽章路径不变)', async () => {
  const mock = installFetchMock(async () => new Response('', { status: 200 }));
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
    assert.equal(mock.calls.length, 0, 'AMap 路径不触发预检');
    c.destroy();
  } finally {
    mock.restore();
  }
});
