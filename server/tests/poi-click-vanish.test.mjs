// ============================================================
// poi-click-vanish 回归(2026-08-26)——「点击部分 POI 后全部消失」
//
// 用户症状(深圳街景级,移动端):点击快手 marker → 详情面板打开,
// 但地图上所有徽章 + 列表全部消失,永久不恢复。
//
// 实测根因链(ego-browser 插桩,__pcv 时间线):
//   1. 点击 marker(≤767px)→ dynamic 导入详情面板挂载
//      → MapShell fiber disconnect/reconnect(use-map-engine keepalive 链)
//   2. reconnect 时 React 重放 passive effects——useModeCacheRestore 的
//      []-effect 被再次执行 → setCatalog(sessionStorage 快照)
//   3. 快照是全量加载中途的 onBatch 批次(loadWorkViewport 每页写缓存;
//      实测定格在第 7 页 = 350 条,不含深圳公司)
//   4. workMarkerPois 塌缩 350(无深圳 id)→ visiblePOIIds 不含深圳徽章
//      → setVisiblePOIs 全部 hide;列表 pois=0 →「0 个结果」;永久不恢复
//      (主加载缓存早退:catalogRef>0 + query 相同 + refreshToken=0 → 不重拉)
//
// 两处修复:
//   A. useModeCacheRestore 加「只跑一次」守卫——fiber reconnect 重放
//      []-effect 时不再覆盖活目录(本文件行为级断言)
//   B. work 全量加载不再逐页写中途快照(onBatch 只落 React 状态,最终
//      结果才写缓存)——消灭「残缺池」污染 sessionStorage 的源头
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { register } from 'node:module';

import React from 'react';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// @/ 别名在 node:test 下不可解析:注册一次性 loader(ts 路径解析)
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'alias-loader.mjs')));

function installMemoryStorage() {
  const store = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
  };
  return store;
}

const recruitmentPoi = (id, lng) => ({
  id,
  kind: 'recruitment',
  name: `公司${id}`,
  mode: 'work',
  source: 'seed',
  location: { lng, lat: 30.28 },
  company: { name: `公司${id}`, industries: [], scale: 'bigtech' },
  positions: [],
});

// ---- 最小 hook 运行时(无 jsdom):注入 React 内部 dispatcher,手动驱动
// effect 生命周期。语义对齐 fiber disconnect/reconnect:同一份 hook 记忆
// (states/refs 存活),mount-only effects 被 React 重放。----

function createHookEnv() {
  const pendingEffects = [];
  const cleanups = [];
  const states = [];
  const refs = [];
  let hookCallIndex = 0;

  const dispatcher = {
    useState(init) {
      const i = hookCallIndex++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [
        states[i],
        (v) => {
          states[i] = typeof v === 'function' ? v(states[i]) : v;
        },
      ];
    },
    useRef(init) {
      const i = hookCallIndex++;
      if (!(i in refs)) refs[i] = { current: init };
      return refs[i];
    },
    useCallback(fn) {
      hookCallIndex++;
      return fn;
    },
    useEffect(fn) {
      hookCallIndex++;
      pendingEffects.push(fn);
    },
  };

  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  return {
    /** 渲染一次组件(按 hook 调用序收集,不执行 effects)。 */
    render(Comp) {
      const prev = internals.H;
      hookCallIndex = 0;
      internals.H = dispatcher;
      try {
        Comp();
      } finally {
        internals.H = prev;
      }
    },
    /** 执行收集到的 mount effects(挂载/fiber reconnect 重放)。 */
    runEffects() {
      while (pendingEffects.length) {
        const fn = pendingEffects.shift();
        const cleanup = fn();
        if (cleanup) cleanups.push(cleanup);
      }
    },
    /** fiber disconnect:跑全部 cleanup(reconnect 前奏)。 */
    cleanupEffects() {
      while (cleanups.length) {
        const c = cleanups.pop();
        try {
          c();
        } catch {}
      }
    },
    /** 直接读第 n 个 useState 的当前值(绕过渲染)。 */
    state(n) {
      return states[n];
    },
  };
}

async function loadRestoreHook() {
  return import('../src/hooks/use-mode-cache-restore.ts');
}

test('A·useModeCacheRestore:重放 mount effect(fiber reconnect)不得覆盖已演进的 catalog', async () => {
  const { useModeCacheRestore } = await loadRestoreHook();
  const { writeModeCache } = await import('../src/lib/mode-cache.ts');

  installMemoryStorage();

  // 缓存 = 全量加载中途的残缺快照(350 条,不含深圳公司)
  const staleSnapshot = Array.from({ length: 350 }, (_, i) => recruitmentPoi(`c-${i}`, 120.0 + i * 0.001));
  writeModeCache({
    mode: 'work',
    catalog: staleSnapshot,
    pageOffset: 0,
    searchOrigin: null,
    query: '',
    filters: {},
    sort: 'distance',
  });

  const env = createHookEnv();
  const calls = { restoreSetCatalog: 0 };
  const skipFetchRef = { current: false };
  const noMoreRef = { current: false };
  const catalogRef = { current: [] };
  const deps = {
    mode: 'work',
    skipFetchRef,
    catalogRef,
    noMoreRef,
    setCatalog: () => {
      calls.restoreSetCatalog += 1;
    },
    setPageOffset: () => {},
    setSearchOrigin: () => {},
    setQuery: () => {},
    setFilters: () => {},
    setSort: () => {},
    setNoMoreData: () => {},
  };

  function TestComp() {
    useModeCacheRestore(deps);
  }

  // 首次挂载:还原缓存快照(合法——刷新页面恢复会话池)
  env.render(TestComp);
  env.runEffects();
  assert.equal(calls.restoreSetCatalog, 1, '首挂载执行一次 restore');
  assert.equal(skipFetchRef.current, true);

  // 模拟全量加载完成:catalog 演进到完整池(737,含深圳公司)。
  // 只改 catalogRef(不动 deps.setCatalog —— restore 分支计数独立)。
  const fullPool = Array.from({ length: 737 }, (_, i) =>
    recruitmentPoi(i < 500 ? `c-${i}` : `sz-${i}`, i >= 500 ? 113.94 : 120.0),
  );
  catalogRef.current = fullPool;

  // fiber disconnect/reconnect:cleanup 全部 effects 后重放 mount-only effects
  env.cleanupEffects();
  env.render(TestComp);
  env.runEffects();

  // 修复前:[]-effect 重放 → setCatalog(staleSnapshot) 再次执行,catalog 塌缩回
  // 350(用户症状);修复后:once 守卫短路,setCatalog 不被再次调用。
  assert.equal(
    calls.restoreSetCatalog,
    1,
    'reconnect 重放 []-effect 不得再走 restore 分支(poi-click-vanish 根因)',
  );
});

// ---- B·work 全量加载不得逐页写中途快照进 sessionStorage ----

test('B·loadWorkViewport onBatch 中途批次不写缓存:最终结果才落库', () => {
  const shell = src('components/map-shell.tsx');
  // 主加载 onBatch 内不得出现 writeModeCache(旧实现每页写 → 中断留下残缺池)
  const onBatchAt = shell.indexOf('const onBatch = (batch: POI[]) => {');
  assert.ok(onBatchAt !== -1, 'onBatch 锚点存在');
  const onBatchEnd = shell.indexOf('\n        };', onBatchAt);
  const onBatchBlock = shell.slice(onBatchAt, onBatchEnd);
  assert.doesNotMatch(
    onBatchBlock,
    /writeModeCache\(/,
    'onBatch 中途批次不得写 mode cache(残缺池污染 sessionStorage → poi-click-vanish 放大器)',
  );
});

// ---- 源码契约:守卫形态 ----

test('useModeCacheRestore 源码契约:once 守卫存在且先于缓存读取', () => {
  const hook = src('hooks/use-mode-cache-restore.ts');
  assert.match(hook, /didRestoreRef|restoredRef|hasRestored/, '一次性守卫 ref 存在');
  // 守卫必须先于 readModeCache(短路整个 restore 分支)
  const guardIdx = hook.search(/didRestoreRef\.current|restoredRef\.current|hasRestored\.current/);
  const readIdx = hook.indexOf('readModeCache(mode)');
  assert.ok(guardIdx !== -1 && readIdx !== -1 && guardIdx < readIdx, '守卫先于缓存读取');
});
