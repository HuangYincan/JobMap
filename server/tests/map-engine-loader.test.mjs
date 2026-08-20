// ============================================================
// 脚本加载器测试 — MapEngine 内核(script-loader)
// 幂等 / 并发共享 / 失败清理(移除标签+清缓存) / DI fake 注入 / 重试 /
// callback 模式 / globalVar 短路 / 非浏览器守卫 / 默认注入器。
// ============================================================

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, resetScriptLoader } from '../src/lib/map-engine/script-loader.ts';

/** DI fake:记录注入次数并暴露 hooks,测试手动触发 onload/onerror */
function countingInjector(record) {
  return (conf, hooks) => {
    record.calls++;
    record.hooks = hooks;
    record.confs.push(conf);
    return { element: record.element };
  };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  resetScriptLoader();
});

test('幂等:同 URL 成功后再次调用,只注入一次', async () => {
  globalThis.window = {};
  const record = { calls: 0, hooks: null, confs: [], element: null };
  const conf = { url: 'https://mock.example/sdk.js?v=1', globalVar: 'MockNS' };

  const p1 = loadScript(conf, { inject: countingInjector(record) });
  assert.equal(record.calls, 1);
  record.hooks.onload();
  await p1;

  const p2 = loadScript(conf, { inject: countingInjector(record) });
  assert.equal(record.calls, 1, '成功后再调用同 URL 不得重新注入');
  await p2;
});

test('并发:同 URL 共享同一 Promise,只注入一次', async () => {
  globalThis.window = {};
  const record = { calls: 0, hooks: null, confs: [], element: null };
  const conf = { url: 'https://mock.example/sdk.js?v=2', globalVar: 'MockNS' };

  const p1 = loadScript(conf, { inject: countingInjector(record) });
  const p2 = loadScript(conf, { inject: countingInjector(record) });
  assert.equal(record.calls, 1, '并发调用只注入一次');
  record.hooks.onload();
  await Promise.all([p1, p2]);
});

test('失败:移除 script 标签 + 清缓存,下次调用可重试(复刻 amap-api L94-100)', async () => {
  globalThis.window = {};
  const removed = [];
  const record = {
    calls: 0,
    hooks: null,
    confs: [],
    element: { remove: () => removed.push('removed') },
  };
  const conf = { url: 'https://mock.example/sdk.js?v=3', globalVar: 'MockNS' };

  const first = loadScript(conf, { inject: countingInjector(record) });
  record.hooks.onerror(new Error('network down'));
  await assert.rejects(first, /network down/);
  assert.equal(removed.length, 1, '失败必须移除 script 标签');

  // 缓存已清 → 再次调用重新注入(重试路径)
  const second = loadScript(conf, { inject: countingInjector(record) });
  assert.equal(record.calls, 2, '失败后缓存清空,重试重新注入');
  record.hooks.onload();
  await second;
});

test('注入方同步抛错:同样走失败清理,可重试', async () => {
  globalThis.window = {};
  let calls = 0;
  const inject = (conf, hooks) => {
    calls++;
    if (calls === 1) throw new Error('injector boom');
    return { element: null };
  };
  const conf = { url: 'https://mock.example/sdk.js?v=4', globalVar: 'MockNS' };

  await assert.rejects(loadScript(conf, { inject }), /injector boom/);
  // 缓存已清 → 再次调用重新注入
  await assert.rejects(loadScript(conf, { inject }), /injector boom/);
  assert.equal(calls, 2);
});

test('callback 模式:window[callbackName] 先注册,回调触发即成功,settle 后清理', async () => {
  globalThis.window = {};
  const record = { calls: 0, hooks: null, confs: [], element: null };
  const conf = {
    url: 'https://map.qq.com/api/gljs?v=1.exp&key=k&callback=onTMapScriptLoad',
    globalVar: 'TMap',
    callbackName: 'onTMapScriptLoad',
  };

  const p = loadScript(conf, { inject: countingInjector(record) });
  assert.equal(record.calls, 1);
  assert.equal(typeof window.onTMapScriptLoad, 'function', '回调必须在注入前注册');
  // 厂商脚本执行 → 调用全局回调
  window.onTMapScriptLoad();
  await p;
  assert.equal(window.onTMapScriptLoad, undefined, 'settle 后回调应清理,避免全局泄漏');
});

test('callback 模式:回调触发后 onload 重复触发被 settled 守卫吞掉', async () => {
  globalThis.window = {};
  const record = { calls: 0, hooks: null, confs: [], element: null };
  const conf = {
    url: 'https://mock.example/bmap.js',
    globalVar: 'BMapGL',
    callbackName: 'onBMapGLScriptLoad',
  };

  const p = loadScript(conf, { inject: countingInjector(record) });
  window.onBMapGLScriptLoad(); // 回调先到
  record.hooks.onload(); // 脚本 onload 后到 → 双 settle 守卫
  await p;
});

test('globalVar 已就绪:直接成功,不再注入', async () => {
  globalThis.window = { AMap: { Map: class {} } };
  let calls = 0;
  const inject = (conf, hooks) => {
    calls++;
    return { element: null };
  };
  const conf = { url: 'https://webapi.amap.com/maps?v=2.0&key=k', globalVar: 'AMap' };
  await loadScript(conf, { inject });
  assert.equal(calls, 0, 'namespace 已存在时不注入');
});

test('非浏览器环境:reject 明确报错', async () => {
  delete globalThis.window;
  await assert.rejects(
    loadScript({ url: 'https://x/sdk.js', globalVar: 'X' }),
    /only available in the browser/,
  );
});

test('默认注入器:创建 script 挂 head + onload 就绪;失败移除标签', async () => {
  let lastScript = null;
  const doc = {
    createElement: (tag) => {
      if (tag !== 'script') return { style: {} };
      lastScript = {
        src: '',
        async: false,
        onload: null,
        onerror: null,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      return lastScript;
    },
    head: { appended: [], appendChild(el) { this.appended.push(el); } },
  };
  globalThis.window = {};
  globalThis.document = doc;
  const conf = { url: 'https://webapi.amap.com/maps?v=2.0&key=k', globalVar: 'AMap' };

  // 成功路径:script 创建 + 挂 head,onload → resolve
  const p = loadScript(conf);
  assert.equal(doc.head.appended.length, 1, '默认注入器必须把 script 挂到 head');
  assert.equal(doc.head.appended[0].src, conf.url);
  assert.equal(lastScript.async, true);
  lastScript.onload();
  await p;

  // 失败路径:onerror → 移除标签
  const p2 = loadScript({ url: 'https://webapi.amap.com/maps?v=2.0&key=k2', globalVar: 'AMap' });
  lastScript.onerror();
  await assert.rejects(p2, /failed to load/);
  assert.equal(lastScript.removed, true, '失败必须移除 script 标签');
});
