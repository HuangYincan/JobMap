import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_THROTTLE_MS,
  createAgentMapExecutor,
  resolveCompletion,
  validateAction,
} from '../src/components/agent-map-executor.ts';

/** mock bridge:记录调用,支持 ready/camera 控制与覆盖物清理回调记录。 */
function mockBridge() {
  const calls = [];
  let ready = true;
  let camera = { center: { lng: 120.15, lat: 30.27 }, zoom: 13 };
  const bridge = {
    calls,
    setReady(v) {
      ready = v;
    },
    setCamera(c) {
      camera = c;
    },
    isReady() {
      return ready;
    },
    getSnapshot() {
      return ready ? camera : null;
    },
    flyTo(lng, lat, zoom) {
      calls.push(['flyTo', lng, lat, zoom]);
      camera = { center: { lng, lat }, zoom: zoom ?? camera.zoom };
    },
    select(id, mode) {
      calls.push(['select', id, mode]);
    },
    addMarkers(points) {
      calls.push(['addMarkers', points]);
      return () => calls.push(['cleanup-markers']);
    },
    drawCircle(center, radiusMeters) {
      calls.push(['drawCircle', center, radiusMeters]);
      return () => calls.push(['cleanup-circle']);
    },
    openDetail(id, mode) {
      calls.push(['openDetail', id, mode]);
    },
  };
  return bridge;
}

function makeExecutor(bridge, extra = {}) {
  const callbacks = {
    onDelta: () => callbacks.events.push(['delta']),
    onTool: (info) => callbacks.events.push(['tool', info.name, info.status]),
    onDone: (truncated) => callbacks.events.push(['done', truncated]),
    onError: (code, message) => callbacks.events.push(['error', code, message]),
    onAction: (action) => callbacks.events.push(['action', action.type]),
    events: [],
    ...extra,
  };
  return { executor: createAgentMapExecutor(bridge, callbacks), callbacks };
}

const action = (type, payload) => ({ type, payload });

test('validateAction: 客户端校验与后端同款(越界坐标/超长 id/超大 radius/>50 points/未知 type/NaN)', () => {
  assert.deepEqual(validateAction(action('flyTo', { center: { lng: 120.1, lat: 30.2 }, zoom: 12 })), {
    type: 'flyTo',
    payload: { center: { lng: 120.1, lat: 30.2 }, zoom: 12 },
  });
  assert.equal(validateAction(action('flyTo', { center: { lng: 120, lat: 30 }, zoom: -1 })).payload.zoom, 3);
  assert.equal(validateAction(action('flyTo', { center: { lng: 120, lat: 30 }, zoom: 21 })).payload.zoom, 20);
  assert.equal(validateAction(action('flyTo', { center: { lng: 120, lat: 30 }, zoom: 1e6 })).payload.zoom, 20);
  assert.equal(validateAction(action('flyTo', { center: { lng: 181, lat: 30 } })), null);
  assert.equal(validateAction(action('flyTo', { center: { lng: 120, lat: NaN } })), null);
  assert.equal(validateAction(action('select', { id: 'x'.repeat(129) })), null);
  assert.equal(validateAction(action('drawCircle', { center: { lng: 120, lat: 30 }, radiusMeters: 5 })), null);
  assert.equal(validateAction(action('drawCircle', { center: { lng: 120, lat: 30 }, radiusMeters: 50001 })), null);
  assert.equal(validateAction(action('addMarkers', { points: [] })), null);
  assert.equal(
    validateAction(action('addMarkers', { points: Array.from({ length: 51 }, () => ({ lng: 120, lat: 30 })) })),
    null,
  );
  assert.equal(validateAction(action('search', { query: 'q'.repeat(101) })), null);
  assert.equal(validateAction(action('unknownType', {})), null);
  assert.equal(validateAction({ type: 'flyTo' }), null);
  assert.equal(validateAction(null), null);
});

test('handleEvent: delta/tool/done/error 分流到回调', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge);
  executor.handleEvent({ type: 'delta', text: 'a' });
  executor.handleEvent({ type: 'tool', name: 'rest__geocodeAddress', status: 'start' });
  executor.handleEvent({ type: 'done', truncated: true });
  executor.handleEvent({ type: 'error', code: 'TOOL_ERROR', message: 'x' });
  assert.deepEqual(callbacks.events, [
    ['delta'],
    ['tool', 'rest__geocodeAddress', 'start'],
    ['done', true],
    ['error', 'TOOL_ERROR', 'x'],
  ]);
  assert.equal(bridge.calls.length, 0); // 无地图动作
});

test('handleEvent: reasoning 事件转发到 onReasoning 回调', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge, {
    onReasoning: (text) => callbacks.events.push(['reasoning', text]),
  });
  executor.handleEvent({ type: 'reasoning', text: '先想想' });
  executor.handleEvent({ type: 'reasoning', text: '再想想' });
  executor.handleEvent({ type: 'delta', text: '回答' });
  assert.deepEqual(callbacks.events, [
    ['reasoning', '先想想'],
    ['reasoning', '再想想'],
    ['delta'],
  ]);
  assert.equal(bridge.calls.length, 0);
});

test('handleEvent: 未提供 onReasoning 回调 → reasoning 事件安全忽略', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge); // 无 onReasoning
  executor.handleEvent({ type: 'reasoning', text: 'x' });
  executor.handleEvent({ type: 'delta', text: 'ok' });
  assert.deepEqual(callbacks.events, [['delta']]);
});

test('execute: 执行动作但不回调 onAction(重放语义,不追加建议卡片/不重复定位)', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge);
  executor.execute(action('flyTo', { center: { lng: 121, lat: 31 }, zoom: 14 }));
  assert.deepEqual(bridge.calls.at(-1), ['flyTo', 121, 31, 14]);
  // 仍压 undo 栈:可撤销回执行前 camera
  assert.equal(executor.canUndo(), true);
  assert.equal(executor.undo(), true);
  assert.deepEqual(bridge.calls.at(-1), ['flyTo', 120.15, 30.27, 13]);
  assert.deepEqual(callbacks.events, []); // 全程不通知 onAction
});

test('execute: 500ms 同类型限流生效,非法动作丢弃(与 handleEvent 共享限流窗口)', () => {
  const bridge = mockBridge();
  let t = 1000;
  const { executor, callbacks } = makeExecutor(bridge, { now: () => t });
  executor.execute(action('flyTo', { center: { lng: 121, lat: 31 } }));
  t += 100; // +100ms:同类型仍限流
  executor.execute(action('flyTo', { center: { lng: 122, lat: 32 } }));
  executor.execute(action('flyTo', { center: { lng: 999, lat: 30 } })); // 非法 → 丢弃
  assert.equal(bridge.calls.filter((c) => c[0] === 'flyTo').length, 1);
  assert.deepEqual(callbacks.events, []); // 被丢弃的动作也不通知
  // 与流式 handleEvent 共享同一限流窗口:execute 后 handleEvent 同类型被限流
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 123, lat: 33 } }) });
  assert.equal(bridge.calls.filter((c) => c[0] === 'flyTo').length, 1);
  // 窗口过后恢复
  t += ACTION_THROTTLE_MS;
  executor.execute(action('flyTo', { center: { lng: 124, lat: 34 } }));
  assert.equal(bridge.calls.filter((c) => c[0] === 'flyTo').length, 2);
});

test('execute: bridge 未就绪 → 错误回调,不执行、不压栈', () => {
  const bridge = mockBridge();
  bridge.setReady(false);
  const { executor, callbacks } = makeExecutor(bridge);
  executor.execute(action('flyTo', { center: { lng: 121, lat: 31 } }));
  assert.equal(bridge.calls.length, 0);
  assert.equal(executor.canUndo(), false);
  assert.deepEqual(callbacks.events, [['error', 'MAP_NOT_READY', 'map is not ready']]);
});

test('handleEvent(action): 流式路径仍回调 onAction(建议卡片)', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('select', { id: 'cmp_a' }) });
  assert.deepEqual(bridge.calls.at(-1), ['select', 'cmp_a', undefined]);
  assert.deepEqual(callbacks.events, [['action', 'select']]);
});

test('search 动作 execute: 无地图副作用,不回调 onAction,不入 undo 栈', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge);
  executor.execute(action('search', { query: '滨江区' }));
  assert.equal(bridge.calls.length, 0);
  assert.equal(executor.canUndo(), false);
  assert.deepEqual(callbacks.events, []);
});

const VALID_ROUTE_ID = `rte_${'a'.repeat(32)}`;

test('validateAction: showRoute 合法 ID 通过;带 geometry/过短拒绝', () => {
  assert.deepEqual(validateAction(action('showRoute', { routeId: VALID_ROUTE_ID })), {
    type: 'showRoute',
    payload: { routeId: VALID_ROUTE_ID },
  });
  assert.equal(validateAction(action('showRoute', { routeId: 'rte_short' })), null);
  assert.equal(
    validateAction(action('showRoute', { routeId: VALID_ROUTE_ID, geometry: [{ lng: 120, lat: 30 }] })),
    null,
  );
});

test('showRoute: 流式路径可 onAction,不画 overlay、不入 undo、不改相机', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('showRoute', { routeId: VALID_ROUTE_ID }) });
  assert.equal(bridge.calls.length, 0);
  assert.equal(executor.canUndo(), false);
  assert.deepEqual(callbacks.events, [['action', 'showRoute']]);
});

test('showRoute execute: no-op 且不回调 onAction', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge);
  executor.execute(action('showRoute', { routeId: VALID_ROUTE_ID }));
  assert.equal(bridge.calls.length, 0);
  assert.equal(executor.canUndo(), false);
  assert.deepEqual(callbacks.events, []);
});

test('flyTo: 执行 + undo 恢复旧 camera(执行前快照)', () => {
  const bridge = mockBridge();
  const { executor } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 121, lat: 31 }, zoom: 15 }) });
  assert.deepEqual(bridge.calls.at(-1), ['flyTo', 121, 31, 15]);
  assert.equal(executor.canUndo(), true);
  assert.equal(executor.undo(), true);
  // 逆操作:飞回执行前的 camera [120.15, 30.27, 13]
  assert.deepEqual(bridge.calls.at(-1), ['flyTo', 120.15, 30.27, 13]);
  assert.equal(executor.canUndo(), false);
  assert.equal(executor.undo(), false); // 空栈
});

test('flyTo: zoom 缺省 → bridge 收到 undefined(保持当前 zoom)', () => {
  const bridge = mockBridge();
  const { executor } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 121, lat: 31 } }) });
  assert.deepEqual(bridge.calls.at(-1), ['flyTo', 121, 31, undefined]);
});

test('addMarkers/drawCircle: undo 调用清理函数(逆序)', () => {
  const bridge = mockBridge();
  const { executor } = makeExecutor(bridge);
  executor.handleEvent({
    type: 'action',
    action: action('addMarkers', { points: [{ lng: 120.1, lat: 30.1, label: 'A' }] }),
  });
  executor.handleEvent({
    type: 'action',
    action: action('drawCircle', { center: { lng: 120.1, lat: 30.1 }, radiusMeters: 5000 }),
  });
  assert.equal(executor.undo(), true); // 先撤销 drawCircle(后进先出)
  assert.deepEqual(bridge.calls.at(-1), ['cleanup-circle']);
  assert.equal(executor.undo(), true); // 再撤销 markers
  assert.deepEqual(bridge.calls.at(-1), ['cleanup-markers']);
  assert.equal(executor.canUndo(), false);
});

test('select/openDetail: undo 回放旧值(上一条 select 值回调)', () => {
  const bridge = mockBridge();
  let t = 0;
  const { executor } = makeExecutor(bridge, { now: () => t });
  executor.handleEvent({ type: 'action', action: action('select', { id: 'cmp_a' }) });
  t += ACTION_THROTTLE_MS + 1; // 越过 500ms 限流窗口
  executor.handleEvent({ type: 'action', action: action('select', { id: 'cmp_b', mode: 'work' }) });
  assert.deepEqual(bridge.calls.filter((c) => c[0] === 'select'), [
    ['select', 'cmp_a', undefined],
    ['select', 'cmp_b', 'work'],
  ]);
  assert.equal(executor.undo(), true);
  // 回放上一条 select 旧值
  assert.deepEqual(bridge.calls.at(-1), ['select', 'cmp_a', undefined]);
  assert.equal(executor.undo(), true);
  // 无更旧值 → 不再回调
  assert.equal(bridge.calls.at(-1)[0], 'select');
  assert.equal(executor.canUndo(), false);
});

test('openDetail undo 回放旧值', () => {
  const bridge = mockBridge();
  let t = 0;
  const { executor } = makeExecutor(bridge, { now: () => t });
  executor.handleEvent({ type: 'action', action: action('openDetail', { id: 'p1' }) });
  t += ACTION_THROTTLE_MS + 1; // 越过限流窗口
  executor.handleEvent({ type: 'action', action: action('openDetail', { id: 'p2', mode: 'domain' }) });
  assert.deepEqual(bridge.calls.filter((c) => c[0] === 'openDetail'), [
    ['openDetail', 'p1', undefined],
    ['openDetail', 'p2', 'domain'],
  ]);
  assert.equal(executor.undo(), true);
  assert.deepEqual(bridge.calls.at(-1), ['openDetail', 'p1', undefined]);
});

test('search 动作:不调 bridge、不入 undo 栈,但通知 onAction', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('search', { query: '滨江区', mode: 'work' }) });
  assert.equal(bridge.calls.length, 0);
  assert.equal(executor.canUndo(), false);
  assert.deepEqual(callbacks.events, [['action', 'search']]);
});

test('非法动作:校验失败直接丢弃(不调 bridge、不通知 onAction)', () => {
  const bridge = mockBridge();
  const { executor, callbacks } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 999, lat: 30 } }) });
  executor.handleEvent({ type: 'action', action: { type: 'hack', payload: {} } });
  executor.handleEvent({ type: 'action', action: action('drawCircle', { center: { lng: 120, lat: 30 }, radiusMeters: -1 }) });
  assert.equal(bridge.calls.length, 0);
  assert.equal(executor.canUndo(), false);
  assert.deepEqual(callbacks.events, []);
});

test('限流:500ms 内同类型第二次丢弃,不同类型不受限,窗口过后恢复', () => {
  const bridge = mockBridge();
  let t = 1000;
  const { executor, callbacks } = makeExecutor(bridge, { now: () => t });
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 121, lat: 31 } }) });
  t += 100; // +100ms:同类型仍限流
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 122, lat: 32 } }) });
  // 不同类型不受限
  executor.handleEvent({ type: 'action', action: action('select', { id: 'cmp_x' }) });
  const flyCalls = bridge.calls.filter((c) => c[0] === 'flyTo');
  assert.equal(flyCalls.length, 1);
  assert.deepEqual(flyCalls[0], ['flyTo', 121, 31, undefined]);
  t += ACTION_THROTTLE_MS; // 窗口过后恢复
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 123, lat: 33 }, zoom: 10 }) });
  assert.equal(bridge.calls.filter((c) => c[0] === 'flyTo').length, 2);
  // 被限流丢弃的动作不通知 onAction
  const actionNotifications = callbacks.events.filter((e) => e[0] === 'action');
  assert.equal(actionNotifications.length, 3);
});

test('isReady 失败 → 错误回调,不执行', () => {
  const bridge = mockBridge();
  bridge.setReady(false);
  const { executor, callbacks } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 121, lat: 31 } }) });
  assert.equal(bridge.calls.length, 0);
  assert.deepEqual(callbacks.events, [['error', 'MAP_NOT_READY', 'map is not ready']]);
});

test('reset:清空 undo 栈与限流时间戳', () => {
  const bridge = mockBridge();
  let t = 1000;
  const { executor } = makeExecutor(bridge, { now: () => t });
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 121, lat: 31 } }) });
  executor.handleEvent({ type: 'action', action: action('drawCircle', { center: { lng: 121, lat: 31 }, radiusMeters: 1000 }) });
  assert.equal(executor.canUndo(), true);
  executor.reset();
  assert.equal(executor.canUndo(), false);
  assert.equal(executor.undo(), false);
  t += 100; // 限流时间戳也被清空 → 同类型立即恢复(否则 100ms < 500ms 会被丢弃)
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 122, lat: 32 } }) });
  assert.equal(bridge.calls.filter((c) => c[0] === 'flyTo').length, 2);
});

test('undo 顺序:flyTo → select → markers 混合栈后进先出', () => {
  const bridge = mockBridge();
  const { executor } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 121, lat: 31 }, zoom: 14 }) });
  executor.handleEvent({ type: 'action', action: action('select', { id: 'cmp_a' }) });
  executor.handleEvent({ type: 'action', action: action('addMarkers', { points: [{ lng: 120, lat: 30 }] }) });
  executor.undo(); // markers cleanup
  executor.undo(); // select 回放(无更旧值 → 不再回调,调用不变)
  executor.undo(); // flyTo 回旧 camera
  assert.deepEqual(bridge.calls.slice(-2), [
    ['cleanup-markers'],
    ['flyTo', 120.15, 30.27, 13],
  ]);
  assert.equal(bridge.calls.filter((c) => c[0] === 'select').length, 1); // select 只执行过一次
  assert.equal(executor.canUndo(), false);
});

test('resolveCompletion: done 优先,abort 判定 stopped,其余 null(纯函数)', () => {
  assert.equal(resolveCompletion(false, false), null); // 异常/静默结束 → 不显示完成状态
  assert.equal(resolveCompletion(false, true), 'stopped'); // 用户停止
  assert.equal(resolveCompletion(true, false), 'done'); // done 事件
  assert.equal(resolveCompletion(true, true), 'done'); // done 后 abort → 仍算完成(以 done 为准)
});

test('clearOverlays: 只清 overlay 类条目(相机/select 保留,可继续 undo)', () => {
  const bridge = mockBridge();
  const { executor } = makeExecutor(bridge);
  // 混合栈:camera(flyTo)→ overlay(markers)→ select → overlay(circle)(四类互不相同,无限流)
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 121, lat: 31 }, zoom: 14 }) });
  executor.handleEvent({ type: 'action', action: action('addMarkers', { points: [{ lng: 120, lat: 30 }] }) });
  executor.handleEvent({ type: 'action', action: action('select', { id: 'cmp_a' }) });
  executor.handleEvent({ type: 'action', action: action('drawCircle', { center: { lng: 120.1, lat: 30.1 }, radiusMeters: 2000 }) });
  assert.equal(executor.canUndo(), true);
  executor.clearOverlays();
  // 两个 overlay 清理都已执行(markers + circle),且已移出栈
  const cleanups = bridge.calls.filter((c) => c[0] === 'cleanup-markers' || c[0] === 'cleanup-circle');
  assert.deepEqual(new Set(cleanups.map((c) => c[0])), new Set(['cleanup-markers', 'cleanup-circle']));
  // 相机/select 条目保留:仍可 undo(后进先出 → select 回放,再 flyTo 回旧 camera)
  assert.equal(executor.canUndo(), true);
  assert.equal(executor.undo(), true); // select 回放(无更旧值 → 不回调)
  assert.equal(executor.undo(), true); // flyTo 回执行前 camera
  assert.deepEqual(bridge.calls.at(-1), ['flyTo', 120.15, 30.27, 13]);
  assert.equal(executor.canUndo(), false);
});

test('clearOverlays: 无 overlay 条目 → 栈不变,不执行任何逆操作', () => {
  const bridge = mockBridge();
  const { executor } = makeExecutor(bridge);
  executor.handleEvent({ type: 'action', action: action('flyTo', { center: { lng: 121, lat: 31 } }) });
  const before = bridge.calls.length;
  executor.clearOverlays();
  assert.equal(bridge.calls.length, before); // 相机逆操作未执行
  assert.equal(executor.canUndo(), true); // 相机条目保留
  assert.equal(executor.undo(), true); // 仍可撤销
  assert.deepEqual(bridge.calls.at(-1), ['flyTo', 120.15, 30.27, 13]);
});
