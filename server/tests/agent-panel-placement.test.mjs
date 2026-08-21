import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePanelPlacement,
  MOBILE_MAX_WIDTH,
  PANEL_BALL_GAP,
  PANEL_EDGE_MARGIN,
  pickPanelSide,
} from '../src/lib/agent-panel-placement.ts';

// 桌面视口默认 1280×800;球 44×44;面板 360×560(70vh)
const V = { width: 1280, height: 800 };
const BALL = { left: 1280 - 12 - 44, top: 200, width: 44, height: 44 }; // 右缘吸附(top 在可对齐范围内)
const PANEL = { width: 360, height: 560 };

// ---------- pickPanelSide 决策矩阵(溢出翻转规则)----------

test('pickPanelSide: 首选侧放得下 → 取首选侧(不翻转)', () => {
  assert.equal(pickPanelSide(true, true, false), 'left');
  assert.equal(pickPanelSide(true, true, true), 'left');
  assert.equal(pickPanelSide(false, false, true), 'right');
  assert.equal(pickPanelSide(false, true, true), 'right');
});

test('pickPanelSide: 首选侧放不下 → 翻转到球另一侧', () => {
  assert.equal(pickPanelSide(true, false, true), 'right'); // 首选左失败 → 翻右
  assert.equal(pickPanelSide(false, true, false), 'left'); // 首选右失败 → 翻左
});

test('pickPanelSide: 两侧都放不下 → sheet', () => {
  assert.equal(pickPanelSide(true, false, false), 'sheet');
  assert.equal(pickPanelSide(false, false, false), 'sheet');
});

// ---------- 锚点与水平 ----------

test('球在右缘 → 面板右缘贴球左缘(gap 8),top 对齐球 top', () => {
  const p = computePanelPlacement(BALL, PANEL, V);
  assert.equal(p.mode, 'side');
  if (p.mode !== 'side') return;
  assert.equal(p.left + PANEL.width, BALL.left - PANEL_BALL_GAP, '面板右缘 = 球左缘 - gap');
  assert.equal(p.left, BALL.left - PANEL_BALL_GAP - PANEL.width);
  assert.equal(p.top, BALL.top, 'top 与球 top 对齐');
  assert.equal(p.flipped, false);
});

test('球在左缘 → 面板左缘贴球右缘(gap 8)', () => {
  const ball = { left: 12, top: 150, width: 44, height: 44 };
  const p = computePanelPlacement(ball, PANEL, V);
  assert.equal(p.mode, 'side');
  if (p.mode !== 'side') return;
  assert.equal(p.left, ball.left + ball.width + PANEL_BALL_GAP, '面板左缘 = 球右缘 + gap');
  assert.equal(p.top, ball.top);
  assert.equal(p.flipped, false);
});

test('球在中间偏右 → 面板仍放球左侧(按半区分侧)', () => {
  const ball = { left: 700, top: 100, width: 44, height: 44 }; // 中心 722 > 640
  const p = computePanelPlacement(ball, PANEL, V);
  assert.equal(p.mode, 'side');
  if (p.mode !== 'side') return;
  assert.equal(p.left, ball.left - PANEL_BALL_GAP - PANEL.width);
  assert.equal(p.flipped, false);
});

test('横向边界:首选侧放不下 → 翻转到另一侧(flipped=true)', () => {
  // 首选左(preferLeft=true)失败 + 右侧放得下:球在右半区但贴中轴过近,
  // 面板左缘被 12px 边距顶出。构造:视口 780,球中心 > 390 且 left < 380:
  // left=380(中心 402 > 390 → 首选左;380-8-360=12 ≥ 12 恰好放得下)…用 left=379:
  // 首选左 379-8-360=11 < 12 失败 → 翻右侧 423+8+360=791 ≤ 768?不,791 > 768 → sheet
  // —— 数学上翻转要求对侧有 ≥ panel+gap+12 空间而首选侧没有,即球必须同时
  // 「贴近中轴」与「对侧宽敞」:取视口 900,球 left=418(中心 440 > 450?不)…
  // 直接给「球在左半区但左侧也宽敞」的对称构造:视口 900,球 left=70
  // (中心 92 < 450 → 首选右:114+8+360=482 ≤ 888 ✓ 放得下,不翻转)
  // 翻转需要首选侧失败,唯一可达路径是球居中(首选侧恰被边距顶出)时对侧宽敞:
  // 视口 900,球 left=414(中心 436 < 450 → 首选右:458+8+360=826 ≤ 888 ✓)→ 不翻转
  // 视口 800,球 left=376(中心 398 < 400 → 首选右:420+8+360=788 ≤ 788 ✓)→ 恰好放得下
  // 视口 800,球 left=377(中心 399 < 400 → 首选右:421+8+360=789 > 788 ✗)→ 翻左:
  // 377-8-360=9 < 12 ✗ → sheet。翻左需要 left ≥ 380:视口 820,球 left=390
  // (中心 412 > 410 → 首选左:390-8-360=22 ≥ 12 ✓ 放得下,不翻转)…
  // 球 left=389(中心 411 > 410 → 首选左:389-8-360=21 ≥ 12 ✓)→ 不翻转
  // —— 结论:在固定面板宽 + 对称边距下,「首选失败 + 对侧成功」不可达
  // (几何上两侧空间互斥),翻转分支为规范要求的防御路径(常量漂移保护)。
  // 此处用 pickPanelSide 直测翻转决策(见上),computePanelPlacement 只验证
  // 不可达性:上述边界场景一致降级为 sheet,不产生越界坐标。
  const boundary = computePanelPlacement({ left: 379, top: 300, width: 44, height: 44 }, PANEL, { width: 800, height: 800 });
  assert.deepEqual(boundary, { mode: 'sheet' });
});

// ---------- 垂直 clamp ----------

test('垂直 clamp:球 top 贴顶 → 面板 top=12', () => {
  const p = computePanelPlacement({ ...BALL, top: 0 }, PANEL, V);
  assert.equal(p.mode, 'side');
  if (p.mode !== 'side') return;
  assert.equal(p.top, PANEL_EDGE_MARGIN);
});

test('垂直 clamp:球贴底 → 面板 top=vh-panelH-12', () => {
  const p = computePanelPlacement({ ...BALL, top: 800 - 44 - 12 }, PANEL, V);
  assert.equal(p.mode, 'side');
  if (p.mode !== 'side') return;
  assert.equal(p.top, 800 - PANEL.height - PANEL_EDGE_MARGIN);
  assert.equal(p.top, 228);
});

test('垂直 clamp:面板高于视口 → 贴顶(不产生负 top)', () => {
  const tallPanel = { width: 360, height: 3000 };
  const p = computePanelPlacement({ left: 12, top: 500, width: 44, height: 44 }, tallPanel, { width: 1280, height: 800 });
  assert.equal(p.mode, 'side');
  if (p.mode !== 'side') return;
  assert.equal(p.top, PANEL_EDGE_MARGIN);
});

// ---------- 极窄视口 / 移动端 ----------

test('极窄视口(两侧都放不下)→ 全宽 sheet(桌面 >767 才走 sheet 判定)', () => {
  // 桌面宽 790,球右缘吸附:首选左侧 734-8-360=366 ≥ 12 ✓ 放得下 → side
  const wideEnough = computePanelPlacement({ left: 790 - 56, top: 200, width: 44, height: 44 }, PANEL, { width: 790, height: 800 });
  assert.equal(wideEnough.mode, 'side');
  // 桌面宽 800,球 left=377(中心 399 < 400 → 首选右侧;右缘 377+44+8+360=789 > 788 ✗
  // → 翻左侧 377-8-360=9 < 12 ✗)→ 两侧都放不下 → sheet
  const narrow1 = computePanelPlacement({ left: 377, top: 200, width: 44, height: 44 }, PANEL, { width: 800, height: 800 });
  assert.deepEqual(narrow1, { mode: 'sheet' });
  // 桌面宽 768,球 left=350(中心 372 < 384 → 首选右侧;762 > 756 ✗ → 翻左 ✗)→ sheet
  const narrow2 = computePanelPlacement({ left: 350, top: 200, width: 44, height: 44 }, PANEL, { width: 768, height: 800 });
  assert.deepEqual(narrow2, { mode: 'sheet' });
  // ≤767 恒移动端 sheet(球右缘吸附也如此)
  assert.deepEqual(computePanelPlacement({ left: 12, top: 200, width: 44, height: 44 }, PANEL, { width: 767, height: 800 }), { mode: 'sheet' });
  assert.deepEqual(computePanelPlacement({ left: 100, top: 200, width: 44, height: 44 }, PANEL, { width: 430, height: 800 }), { mode: 'sheet' });
});

test('移动端(≤767px)→ 恒 sheet,不受球位置影响', () => {
  for (const ball of [
    { left: 12, top: 300, width: 44, height: 44 },
    { left: 300, top: 500, width: 44, height: 44 },
    { left: 700, top: 100, width: 44, height: 44 },
  ]) {
    assert.deepEqual(computePanelPlacement(ball, PANEL, { width: MOBILE_MAX_WIDTH, height: 700 }), { mode: 'sheet' });
  }
});

// ---------- 常量契约 ----------

test('常量契约:gap=8 / 边距=12 / 移动端阈值=767', () => {
  assert.equal(PANEL_BALL_GAP, 8);
  assert.equal(PANEL_EDGE_MARGIN, 12);
  assert.equal(MOBILE_MAX_WIDTH, 767);
});
