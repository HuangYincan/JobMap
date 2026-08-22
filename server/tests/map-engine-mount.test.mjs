// ============================================================
// 挂载失败回退测试(ws-8;feature/engine-mount-fallback)
//
// 背景:sessionStorage 偏好 = 故障引擎(如百度 AK 类型错误)→ 刷新页面 →
// 挂载切换失败 → 旧实现只 console.warn、engine 停留在失败引擎、地图空白。
// 修复:挂载路径失败自动回退其余已配置引擎(ENGINE_PRIORITY 序)。
//
// 纯函数 mountEngineView 在 lib/mount.ts(无 @ 别名、无 React 依赖),node
// 可直接 import 行为断言;hook(use-map-engine.ts)侧以源契约断言接线
// (setEngine(created.engine) / setActiveSearchProvider / 失败不写偏好 /
// 保持 warn + 空视图)。引擎由参数注入(DI),全 mock、不真发网络。
// ============================================================

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountEngineView } from '../src/lib/map-engine/mount.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const src = (rel) => readFileSync(join(root, rel), 'utf8');

/** 捕获引擎/视图事件的共享日志 */
const events = [];

let seq = 0;

/** mock MapView:engine 归属 + destroy 探针(helper 只消费这两个) */
function makeMockView(engine, { id } = {}) {
  const view = {
    id: id ?? `view-${++seq}`,
    engine,
    destroyed: false,
    destroy() {
      this.destroyed = true;
      events.push(`destroy:${this.id}`);
    },
  };
  return view;
}

/** mock MapEngine(DI):load/createView 只记日志不真发网络 */
function makeMockEngine(id, { overrides = {} } = {}) {
  const engine = {
    id,
    label: `engine-${id}`,
    namespace: 'NS',
    coordSystem: 'gcj02',
    keyVar: 'NEXT_PUBLIC_AMAP_KEY',
    isConfigured: () => true,
    async load() {
      events.push(`load:${id}`);
    },
    async createView() {
      events.push(`createView:${id}`);
      return makeMockView(engine);
    },
    search: {
      searchPOI: async () => [],
      fetchSuggestions: async () => [],
      getCurrentPosition: async () => null,
      geocodeAddress: async () => null,
    },
    ...overrides,
  };
  return engine;
}

/** 已按 ENGINE_PRIORITY 排序的 configured 列表(getConfiguredEngines 同序) */
function makeConfigured(ids) {
  return ids.map((id) => makeMockEngine(id));
}

const container = { tagName: 'DIV', style: {} };
const OPTS = {
  container,
  center: { lng: 121.47, lat: 31.23 },
  zoom: 11,
  style: 'normal',
};

afterEach(() => {
  events.length = 0;
});

// ---------------------------------------------------------------------------
// 行为断言:回退顺序 / view 挂载 / engine 归属
// ---------------------------------------------------------------------------

test('首引擎 createView 失败 → 回退第二引擎,view 挂载且 engine 归属正确', async () => {
  // 偏好 = baidu(故障);configured 按优先级序 [amap, tencent, baidu]
  const preferred = makeMockEngine('baidu', {
    overrides: {
      createView: async () => {
        events.push('createView:baidu');
        throw new Error('BMapGL init 失败(模拟)');
      },
    },
  });
  const configured = makeConfigured(['amap', 'tencent']).concat(preferred);

  const created = await mountEngineView(preferred, configured, {
    ...OPTS,
    isCancelled: () => false,
    isViewTaken: () => false,
  });

  assert.ok(created, '回退成功必须返回 view');
  assert.equal(created.engine.id, 'amap', '回退到优先级第一个已配置引擎');
  assert.equal(created.destroyed, false);
  // 顺序:偏好引擎(失败)→ 回退候选按优先级序
  assert.deepEqual(events, [
    'load:baidu',
    'createView:baidu',
    'load:amap',
    'createView:amap',
  ]);
});

test('首引擎 load 失败同样回退(回退重试 load+createView 全链路)', async () => {
  const preferred = makeMockEngine('tencent', {
    overrides: {
      load: async () => {
        events.push('load:tencent');
        throw new Error('TMap 脚本加载失败(模拟)');
      },
    },
  });
  const configured = makeConfigured(['amap']).concat(preferred);

  const created = await mountEngineView(preferred, configured, {
    ...OPTS,
    isCancelled: () => false,
    isViewTaken: () => false,
  });

  assert.equal(created.engine.id, 'amap');
  assert.deepEqual(events, ['load:tencent', 'load:amap', 'createView:amap']);
});

test('偏好引擎健康时直接成功,零回退(回退不预跑)', async () => {
  const preferred = makeMockEngine('amap');
  const configured = makeConfigured(['amap', 'tencent', 'baidu']);

  const created = await mountEngineView(preferred, configured, {
    ...OPTS,
    isCancelled: () => false,
    isViewTaken: () => false,
  });

  assert.equal(created.engine.id, 'amap');
  assert.deepEqual(events, ['load:amap', 'createView:amap']);
});

test('回退顺序去重:preferred 已在 configured 中 → 不回试同一引擎', async () => {
  // 若不去重,preferred(amap,故障)会先试一次失败、再被 configured 首个
  // (也是 amap)试第二次——断言每个引擎只尝试一次
  const preferred = makeMockEngine('amap', {
    overrides: {
      createView: async () => {
        events.push('createView:amap');
        throw new Error('AMap init 失败(模拟)');
      },
    },
  });
  const configured = [preferred, makeMockEngine('tencent')];

  const created = await mountEngineView(preferred, configured, {
    ...OPTS,
    isCancelled: () => false,
    isViewTaken: () => false,
  });

  assert.equal(created.engine.id, 'tencent');
  assert.deepEqual(events, [
    'load:amap',
    'createView:amap',
    'load:tencent',
    'createView:tencent',
  ], 'amap 只尝试一次(preferred 与 configured 首个去重)');
});

test('preferred=null(无偏好):从 configured 优先级序第一个开始,失败按序回退', async () => {
  const amap = makeMockEngine('amap', {
    overrides: {
      createView: async () => {
        events.push('createView:amap');
        throw new Error('AMap init 失败(模拟)');
      },
    },
  });
  const tencent = makeMockEngine('tencent');

  const created = await mountEngineView(null, [amap, tencent], {
    ...OPTS,
    isCancelled: () => false,
    isViewTaken: () => false,
  });

  assert.equal(created.engine.id, 'tencent');
  assert.deepEqual(events, ['load:amap', 'createView:amap', 'load:tencent', 'createView:tencent']);
});

// ---------------------------------------------------------------------------
// 行为断言:全部失败 / 取消 / 接管(不泄漏)
// ---------------------------------------------------------------------------

test('全部候选失败 → 抛错(调用方保持空视图 + warn),每个候选只尝试一次', async () => {
  const preferred = makeMockEngine('baidu', {
    overrides: {
      createView: async () => {
        events.push('createView:baidu');
        throw new Error('BMapGL init 失败(模拟)');
      },
    },
  });
  const tencent = makeMockEngine('tencent', {
    overrides: {
      createView: async () => {
        events.push('createView:tencent');
        throw new Error('TMap init 失败(模拟)');
      },
    },
  });
  const configured = [tencent, preferred];

  await assert.rejects(
    mountEngineView(preferred, configured, {
      ...OPTS,
      isCancelled: () => false,
      isViewTaken: () => false,
    }),
    /TMap init 失败/,
  );
  assert.deepEqual(events, [
    'load:baidu',
    'createView:baidu',
    'load:tencent',
    'createView:tencent',
  ]);
});

test('取消:load 恢复后置位 → 返回 null,不 createView、不继续回退', async () => {
  const preferred = makeMockEngine('baidu');
  let cancelled = false;
  preferred.load = async () => {
    events.push('load:baidu');
    cancelled = true; // teardown 在 load 期间到达
  };
  const configured = [makeMockEngine('amap'), preferred];

  const result = await mountEngineView(preferred, configured, {
    ...OPTS,
    isCancelled: () => cancelled,
    isViewTaken: () => false,
  });

  assert.equal(result, null);
  assert.deepEqual(events, ['load:baidu'], '取消后零 createView、零回退尝试');
});

test('取消:createView resolve 后置位 → 已建视图销毁并返回 null(不泄漏)', async () => {
  const preferred = makeMockEngine('baidu');
  let cancelled = false;
  let createdView;
  preferred.createView = async () => {
    events.push('createView:baidu');
    const v = makeMockView(preferred, { id: 'created' });
    createdView = v;
    cancelled = true; // teardown 恰在 createView resolve 后发生
    return v;
  };
  const configured = [makeMockEngine('amap'), preferred];

  const result = await mountEngineView(preferred, configured, {
    ...OPTS,
    isCancelled: () => cancelled,
    isViewTaken: () => false,
  });

  assert.equal(result, null);
  assert.equal(createdView.destroyed, true, '无人认领的视图必须销毁(不留双实例)');
  assert.deepEqual(events, ['load:baidu', 'createView:baidu', 'destroy:created']);
});

test('视图被接管(isViewTaken)→ 已建视图销毁并返回 null(切换抢先落地防护)', async () => {
  const preferred = makeMockEngine('tencent');
  let createdView;
  preferred.createView = async () => {
    events.push('createView:tencent');
    const v = makeMockView(preferred, { id: 'created' });
    createdView = v;
    return v;
  };
  const configured = [makeMockEngine('amap'), preferred];

  const result = await mountEngineView(preferred, configured, {
    ...OPTS,
    isCancelled: () => false,
    isViewTaken: () => true, // switchEngine 已抢先落地同容器视图
  });

  assert.equal(result, null);
  assert.equal(createdView.destroyed, true, '同容器双实例防护:挂载创建的视图销毁');
  assert.deepEqual(events, ['load:tencent', 'createView:tencent', 'destroy:created']);
});

// ---------------------------------------------------------------------------
// 源契约断言:use-map-engine.ts 接线(行为不可测部分,同 hooks-contracts 模式)
// ---------------------------------------------------------------------------

test('hook 挂载路径接线 mountEngineView(resolved, getConfiguredEngines, ...)', () => {
  const hook = src('hooks/use-map-engine.ts');
  assert.match(hook, /mountEngineView\(resolved, getConfiguredEngines\(\), \{\s*container,\s*center,\s*zoom,\s*style,/);
  // ws-2:取消语义 ref 化(挂载代际)——cleanup/卸载/watchdog 超时递增即作废在飞链
  assert.match(hook, /isCancelled: \(\) => seq !== mountSeqRef\.current/);
  assert.match(hook, /isViewTaken: \(\) => Boolean\(viewRef\.current\)/);
  assert.match(hook, /export \{ mountEngineView \} from "@\/lib\/map-engine\/mount"/, 're-export 供 node 测试直接 import(同 saved-camera-sync 模式)');
});

test('回退成功 → engine/search 状态随实际挂载引擎更新(首引擎成功时同引用 no-op)', () => {
  const hook = src('hooks/use-map-engine.ts');
  assert.match(hook, /setEngine\(created\.engine\)/);
  assert.match(hook, /setActiveSearchProvider\(created\.engine\.search\)/);
});

test('回退也全部失败 → 保持空视图 + console.warn(不 setEngine/setView)', () => {
  const hook = src('hooks/use-map-engine.ts');
  // catch 只 warn:不落地任何视图/引擎状态,调用方回退 CSS fallback 地图
  assert.match(hook, /\.catch\(\(err\) => \{\s*console\.warn\("\[use-map-engine\] map engine load\/createView failed:", err\);/);
  // 失败分类可见化(2026-08-22 ws-c,bug 3):引擎错误携带 code/stage/guidance
  // 时输出结构化诊断 + 可操作指引(挂载路径 mount.ts 原样上抛,分类属性可达)
  assert.match(hook, /\[use-map-engine\] 引擎加载失败分类:/);
});

test('挂载/回退路径不写偏好(偏好由手动切换专属;失败不持久化)', () => {
  const hook = src('hooks/use-map-engine.ts');
  // writeEnginePreference 只出现在 switchEngine 成功路径(L213 语义)
  const writeCalls = hook.match(/writeEnginePreference\(/g) ?? [];
  assert.equal(writeCalls.length, 1, '全文件只有切换成功路径一处写偏好');
  // 挂载 effect 内不得调用(回退不覆盖 sessionStorage 用户选择)
  const mountRegion = hook.slice(hook.indexOf('mountEngineView('), hook.indexOf('.catch((err) =>'));
  assert.doesNotMatch(mountRegion, /writeEnginePreference/);
});

// ---------------------------------------------------------------------------
// ws-2(2026-08-22):挂载失败错误态(mountError)+ 重试状态机(retryMount)+ watchdog
// ---------------------------------------------------------------------------

test('全部候选失败 → 最终错误携带 engineId(最后一个失败引擎;hook 错误态定位用)', async () => {
  const preferred = makeMockEngine('baidu', {
    overrides: {
      createView: async () => {
        events.push('createView:baidu');
        throw new Error('BMapGL init 失败(模拟)');
      },
    },
  });
  const tencent = makeMockEngine('tencent', {
    overrides: {
      createView: async () => {
        events.push('createView:tencent');
        throw new Error('TMap init 失败(模拟)');
      },
    },
  });
  const configured = [tencent, preferred];

  await assert.rejects(
    mountEngineView(preferred, configured, {
      ...OPTS,
      isCancelled: () => false,
      isViewTaken: () => false,
    }),
    (err) => {
      assert.equal(err.engineId, 'tencent', 'engineId = 最后一个尝试(失败)的引擎,供 mountError.engine 定位');
      assert.match(err.message, /TMap init 失败/, 'message/分类属性原样保留(不重包装)');
      return true;
    },
  );
});

test('hook:挂载链全部失败 → catch 进入错误态(mountError 非 null;engine/code/message)', () => {
  const hook = src('hooks/use-map-engine.ts');
  // 错误态三字段:engine(失败引擎 id,mount.ts 在错误上携带 engineId;watchdog
  // 超时无 engineId → 偏好引擎 resolved.id)/code(透传分类码)/message(原文)
  assert.match(hook, /setMountError\(\{\s*engine: classified\.engineId \?\? resolved\.id,\s*code: classified\.code,\s*message: err instanceof Error \? err\.message : String\(err\),\s*\}\);/);
  // 失败不再只有 warn:catch 第一句仍是 console.warn(行为基线),随后即错误态
  assert.match(hook, /\.catch\(\(err\) => \{\s*console\.warn\("\[use-map-engine\] map engine load\/createView failed:", err\);/);
});

test('hook:重新开始挂载(首挂载/retryMount)与 .then 落地 → mountError 清 null', () => {
  const hook = src('hooks/use-map-engine.ts');
  // runMount 入口清(null):重新开始挂载立即清错误态(ws-2 契约)
  assert.match(hook, /mountRunningRef\.current = true;\s*setMountError\(null\); \/\/ 重新开始挂载:立即清错误态\(ws-2 契约\)/);
  // 成功落地清(null):.then 落地路径(挂载成功,视图/引擎状态落地后)
  assert.match(hook, /setActiveSearchProvider\(created\.engine\.search\);\s*setMountError\(null\); \/\/ 挂载成功:错误态清除/);
});

test('hook:retryMount 幂等(已有活 view / 挂载进行中 → no-op),与首挂载共用 runMount', () => {
  const hook = src('hooks/use-map-engine.ts');
  // no-op 守卫:viewRef 战位(已挂载/接管)或挂载链在飞 → 直接返回,不重复创建
  assert.match(hook, /const retryMount = useCallback\(\(\): void => \{\s*if \(viewRef\.current \|\| mountRunningRef\.current\) return;\s*runMount\(\);\s*\}, \[runMount\]\);/);
  // 单一挂载链:首挂载 effect 与 retryMount 都走 runMount(不复制第二份链)
  assert.ok(hook.match(/runMount\(\);/g).length >= 2, 'runMount 至少被首挂载 effect 与 retryMount 两处调用');
});

test('hook:watchdog —— mountEngineView 整体包 withTimeout(25_000),超时 code=MOUNT_TIMEOUT', () => {
  const hook = src('hooks/use-map-engine.ts');
  assert.match(hook, /const MOUNT_TIMEOUT_MS = 25_000;/);
  assert.match(hook, /withTimeout\(\s*mountEngineView\(resolved, getConfiguredEngines\(\), \{/);
  assert.match(hook, /MOUNT_TIMEOUT_MS,\s*'map-engine mount',\s*\)/);
  assert.match(hook, /err\.code = 'MOUNT_TIMEOUT';/);
  // 超时 → 作废在飞挂载链(后台链恢复后经 isCancelled 销毁已建视图,不泄漏)
  assert.match(hook, /if \(classified\.code === 'MOUNT_TIMEOUT'\) mountSeqRef\.current\+\+;/);
  // 成功后 must clear timer(不吞正常挂载成功路径)
  assert.match(hook, /clearTimeout\(timer\);/);
});

test('hook:首挂载 effect deps 仍 [containerRef](提取 runMount 后不改变重挂载语义)', () => {
  const hook = src('hooks/use-map-engine.ts');
  assert.match(hook, /runMount\(\);\s*return relinquishView;/);
  assert.match(hook, /\}, \[containerRef\]\);/);
});
