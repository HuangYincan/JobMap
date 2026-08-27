// agent-map-bridge 契约:定位点显式锚定(2026-08-21 ws-pinfix)
//
// 背景:AI 助手的蓝色定位点在缩放时偏移(平移不报)。根因:addMarkers 调
// view.createMarker({position, content}) 不设 offset,AMap 对无 offset 的 content
// marker 依赖内容实测尺寸做锚定 —— 有 label 时旧 flex 竖排结构(实测高约 44px、
// 含非整数 2.5px 边框)在缩放重排/动画期间锚点计算错位,点与底图漂移。
//
// 契约(本测试锁定):
// 1. createMarker 必须带 offset: [-10, -10] —— 圆心锚定地理坐标(与距离手柄
//    18px 点 [-9,-9] 同款语义;三引擎适配器 amap Pixel / baidu Size / tencent {x,y}
//    均已支持,零引擎改动)。
// 2. content 外层恒为 20×20 固定 wrapper(无 label 时即圆点本体);label(有则)
//    绝对定位出流,不占布局、不撑高 → 实测尺寸恒 20×20,锚点可精确计算。
// 3. 保留:escapeHtml(label)、非法点跳过、清理函数语义。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MockView } from './fixtures/engine-mock.mjs';
import { createAgentBridge } from '../src/lib/agent-map-bridge.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgeSrc = readFileSync(join(__dirname, '../src/lib/agent-map-bridge.ts'), 'utf8');

const DOT =
  '<div style="width:20px;height:20px;border-radius:50%;background:#007AFF;' +
  'border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,122,255,0.45)"></div>';

function makeView() {
  return new MockView({ center: { lng: 120.15, lat: 30.27 }, zoom: 13 });
}

test('flyTo: zoom 极端/负值钳制到共同范围[3,20],边界保持稳定,非 finite 忽略', () => {
  const view = makeView();
  const bridge = createAgentBridge(view);
  const center = { lng: 121, lat: 31 };
  const expected = [3, 3, 3, 20, 20, 20];
  for (const [zoom, target] of [-1, 0, 3, 20, 21, 1e6].map((value, i) => [value, expected[i]])) {
    bridge.flyTo(center.lng, center.lat, zoom);
    assert.equal(view.getState().zoom, target, `zoom=${zoom} 应稳定落在共同范围`);
  }
  bridge.flyTo(center.lng, center.lat, Number.NaN);
  assert.equal(view.getState().zoom, 20, 'NaN 不应触碰引擎或污染上一合法 zoom');
  bridge.flyTo(center.lng, center.lat, undefined);
  assert.equal(view.getState().zoom, 20, '缺省 zoom 保持当前值');
});

test('addMarkers:createMarker 显式锚点 offset [-10,-10](圆心锚定,有/无 label 一致)', () => {
  const view = makeView();
  const bridge = createAgentBridge(view);
  bridge.addMarkers([
    { lng: 120.1, lat: 30.1 },
    { lng: 120.2, lat: 30.2, label: '西湖' },
  ]);
  assert.equal(view.markers.length, 2);
  for (const m of view.markers) {
    assert.deepEqual(m.opts.offset, [-10, -10], 'offset 必须为 [-10,-10] 元组');
  }
});

test('addMarkers:content 外层恒为 20×20 固定 wrapper,label 绝对定位出流(无 flex 撑高)', () => {
  const view = makeView();
  const bridge = createAgentBridge(view);
  bridge.addMarkers([{ lng: 120.1, lat: 30.1, label: '点' }]);
  const html = view.markers[0].content;
  // 外层 wrapper 固定 20×20(即圆点本体),锚点数学精确
  assert.match(html, /position:relative;width:20px;height:20px/);
  // 圆点本体 20×20 + 白边 + 蓝影(样式保留)
  assert.match(html, /width:20px;height:20px;border-radius:50%;background:#007AFF/);
  // label 绝对定位:叠在圆点上方 2px、水平居中,不占布局
  assert.match(html, /position:absolute;bottom:calc\(100% \+ 2px\);left:50%;transform:translateX\(-50%\)/);
  assert.match(html, /white-space:nowrap/);
  // 严禁旧 flex column 竖排撑高结构
  assert.doesNotMatch(html, /display:flex|flex-direction/);
});

test('addMarkers:无 label → content 即纯 20×20 圆点,无 wrapper/绝对定位', () => {
  const view = makeView();
  const bridge = createAgentBridge(view);
  bridge.addMarkers([{ lng: 120.1, lat: 30.1 }]);
  assert.equal(view.markers.length, 1);
  assert.equal(view.markers[0].content, DOT);
});

test('addMarkers:label 走 escapeHtml(LLM 输出不可信,防 HTML 注入)', () => {
  const view = makeView();
  const bridge = createAgentBridge(view);
  bridge.addMarkers([{ lng: 120.1, lat: 30.1, label: '<img src=x onerror=alert(1)>' }]);
  const html = view.markers[0].content;
  assert.ok(!html.includes('<img'), 'label 不得作为原始 HTML 注入');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('addMarkers:非法点跳过(不 createMarker);label 超长 → 丢弃 label 但保留点', () => {
  const view = makeView();
  const bridge = createAgentBridge(view);
  bridge.addMarkers([
    { lng: 120.1, lat: 30.1 },
    { lng: 999, lat: 30.2 }, // 越界经度
    { lng: 120.3, lat: 91 }, // 越界纬度
    { lng: NaN, lat: 30.4 },
    { lng: 120.5, lat: 30.5, label: 'l'.repeat(51) }, // label 超长 → 仅丢弃 label
    null,
  ]);
  assert.equal(view.markers.length, 2, '仅合法 lng/lat 点创建 marker');
  assert.equal(view.markers[1].content, DOT, '超长 label 点保留圆点、不带标签');
});

test('addMarkers:清理函数移除本批全部 marker(幂等)', () => {
  const view = makeView();
  const bridge = createAgentBridge(view);
  const cleanup = bridge.addMarkers([
    { lng: 120.1, lat: 30.1, label: 'a' },
    { lng: 120.2, lat: 30.2 },
  ]);
  assert.equal(view.markers.length, 2);
  cleanup();
  assert.ok(view.markers.every((m) => m.removed));
  cleanup(); // 幂等:二次调用不抛
  assert.ok(view.markers.every((m) => m.removed));
});

test('addMarkers:view 未就绪(null)时安全空操作,不抛', () => {
  const bridge = createAgentBridge(null);
  assert.doesNotThrow(() => bridge.addMarkers([{ lng: 120.1, lat: 30.1, label: 'x' }]));
});

test('源码契约:offset [-10,-10] 字面量 + 无 flex-direction(2026-08-21 ws-pinfix 回归守卫)', () => {
  assert.match(bridgeSrc, /offset: \[-10, -10\]/);
  assert.match(bridgeSrc, /position:absolute;bottom:calc\(100% \+ 2px\)/);
  assert.doesNotMatch(bridgeSrc, /flex-direction/, 'agent-map-bridge 不得再出现 flex 竖排撑高');
});
