// ============================================================
// POI 生命周期回归(2026-09-01 scan 20260901-poi-lifecycle)
//
// 审查:针「先渲染后消失」主路径是可见集收空或控制器 destroy,不是
// setPOIs([])。本文件锁 #1–#7 的源码契约 + #1 的 hook 行为。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import React from 'react';

import {
  installAMapMock,
  uninstallAMapMock,
  MockMap,
  makePoi,
} from './fixtures/amap-mock.mjs';
import { usePOIMap } from '../src/hooks/use-poi-map.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

test.afterEach(() => {
  uninstallAMapMock();
});

test('poi-lifecycle source: #1 keepalive / #2 work pool / #3 cluster ungrouped / #4 bounds / #5 isAttached / #6 logo / #7 vacant', () => {
  const hook = src('hooks/use-poi-map.ts');
  const engineHook = src('hooks/use-map-engine.ts');
  const shell = src('components/map-shell.tsx');
  const markers = src('lib/map-markers.ts');
  const amap = src('lib/map-engine/amap/amap-engine.ts');
  const tencent = src('lib/map-engine/tencent/tencent-engine.ts');
  const cluster = src('lib/city-cluster.ts');
  const vp = src('lib/viewport-search.ts');

  assert.match(hook, /keepaliveRef/);
  assert.match(hook, /latest\.current\.pois/);
  assert.doesNotMatch(hook, /offMove\(\);\s*controller\.destroy\(\);/);

  const relinq = engineHook.slice(engineHook.indexOf('const relinquishView'), engineHook.indexOf('const keep = keepaliveRef.current'));
  assert.doesNotMatch(relinq, /^\s*setView\(null\)/m, '交棒当帧不得同步置空 view');
  assert.match(relinq, /setView\(\(current\) => \(current === doomed \? null : current\)\)/);

  assert.match(shell, /canonicalMode\(mode\) === "work"\s*\? mergeMapPois\(catalog, overlayPois/);
  assert.match(shell, /const workVisiblePois = useMemo\(/);
  assert.match(shell, /clusterUngroupedPois\(source, groups\)/);
  assert.match(shell, /isUsableViewportBounds\(mapBounds\)/);
  assert.match(shell, /applyLiveViewState\(/);
  assert.match(shell, /有旧目录时空批次一律保留/);
  assert.doesNotMatch(shell, /catalogCoversView\(/);

  assert.match(cluster, /export function clusterUngroupedPois/);
  assert.match(vp, /export function isUsableViewportBounds/);

  assert.match(amap, /if \(!visible\) return true;/);
  assert.match(amap, /return onLayer;/);
  assert.match(tencent, /if \(!wantVisible\) return true;/);

  const upgradeAt = markers.indexOf('private applyLogoUpgrade');
  assert.ok(upgradeAt >= 0, 'applyLogoUpgrade exists');
  const upgradeEnd = markers.indexOf('private maybeUpgradeIcon', upgradeAt);
  const upgrade = markers.slice(upgradeAt, upgradeEnd > 0 ? upgradeEnd : upgradeAt + 1200);
  assert.doesNotMatch(upgrade, /this\.removeMarker\(poi\.id\)/);
  assert.match(upgrade, /this\.applyStyle\(/);
});

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
      return [states[i], (v) => {
        states[i] = typeof v === 'function' ? v(states[i]) : v;
      }];
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
    runEffects() {
      while (pendingEffects.length) {
        const fn = pendingEffects.shift();
        const cleanup = fn();
        if (cleanup) cleanups.push(cleanup);
      }
    },
    cleanupEffects() {
      while (cleanups.length) {
        const c = cleanups.pop();
        try {
          c();
        } catch {}
      }
    },
  };
}

test('usePOIMap keepalive: fiber reconnect 同 view 不拆 marker(poi-lifecycle #1)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  map.on = () => () => {};
  const pois = [makePoi('hz-1', '浙江省发展规划研究院', 120.099, 30.299)];
  const env = createHookEnv();

  function TestComp() {
    usePOIMap(map, { pois, visiblePOIs: ['hz-1'] });
  }

  env.render(TestComp);
  env.runEffects();
  const overlays = () => map.getAllOverlays('marker').length;
  assert.equal(overlays(), 1, '首挂载有针');
  const first = map.getAllOverlays('marker')[0];

  env.cleanupEffects();
  assert.equal(overlays(), 1, 'cleanup 交棒,针还在(尚未到延迟 destroy)');

  env.render(TestComp);
  env.runEffects();
  assert.equal(overlays(), 1, '重连复用控制器,不重建');
  assert.equal(map.getAllOverlays('marker')[0], first, '同一 overlay 实例');
});
