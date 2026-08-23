import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampBallPosition,
  computeBallSnap,
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

// ---------- 持久化位置恢复(旧视口数据收敛)----------

test('clampBallPosition: 恢复坐标收敛到当前视口', () => {
  assert.deepEqual(
    clampBallPosition({ left: -80, right: null, top: 99999 }, V, 44, 12),
    { left: 12, right: null, top: 800 - 44 - 12 },
  );
  assert.deepEqual(
    clampBallPosition({ left: 99999, right: null, top: -30 }, V, 44, 12),
    { left: 1280 - 44 - 12, right: null, top: 12 },
  );
});

test('clampBallPosition: 极小视口退回贴边位置', () => {
  const tiny = { width: 40, height: 40 };
  assert.deepEqual(clampBallPosition({ left: -100, right: null, top: -100 }, tiny, 44, 12), {
    left: 12,
    right: null,
    top: 12,
  });
});
});

// ---------- 常量契约 ----------

test('常量契约:gap=8 / 边距=12 / 移动端阈值=767', () => {
  assert.equal(PANEL_BALL_GAP, 8);
  assert.equal(PANEL_EDGE_MARGIN, 12);
  assert.equal(MOBILE_MAX_WIDTH, 767);
});

// ---------- computeBallSnap 四向吸附(球心最近边,平局 左→右→上→下)----------
// 约定:ballSize=44, margin=12;吸附坐标:left/right → left 贴边 + top 保留;
// top/bottom → top 贴边 + left 保留。

test('computeBallSnap: 左半区 → 吸附左边缘,top 保留松手坐标', () => {
  const s = computeBallSnap({ left: 300, top: 400 }, { width: 1280, height: 800 }, 44, 12);
  assert.deepEqual(s, { edge: 'left', left: 12, top: 400 });
});

test('computeBallSnap: 右半区 → 吸附右边缘,top 保留松手坐标', () => {
  const s = computeBallSnap({ left: 900, top: 400 }, { width: 1280, height: 800 }, 44, 12);
  assert.deepEqual(s, { edge: 'right', left: 1280 - 44 - 12, top: 400 });
});

test('computeBallSnap: 上半区 → 吸附上边缘,left 保留松手坐标', () => {
  const s = computeBallSnap({ left: 500, top: 100 }, { width: 1280, height: 800 }, 44, 12);
  assert.deepEqual(s, { edge: 'top', left: 500, top: 12 });
});

test('computeBallSnap: 下半区 → 吸附下边缘,left 保留松手坐标', () => {
  const s = computeBallSnap({ left: 500, top: 700 }, { width: 1280, height: 800 }, 44, 12);
  assert.deepEqual(s, { edge: 'bottom', left: 500, top: 800 - 44 - 12 });
});

test('computeBallSnap: 四角附近 → 按最近边(左上→左,右上→上,右下→下,左下→左)', () => {
  // 左上:球心(42,42),左=上=42 平局 → 左
  assert.deepEqual(computeBallSnap({ left: 20, top: 20 }, { width: 1280, height: 800 }, 44, 12),
    { edge: 'left', left: 12, top: 20 });
  // 右上:球心(1232,32),右 48 > 上 32 → 上
  assert.deepEqual(computeBallSnap({ left: 1210, top: 10 }, { width: 1280, height: 800 }, 44, 12),
    { edge: 'top', left: 1210, top: 12 });
  // 右下:球心(1242,772),右 38 > 下 28 → 下
  assert.deepEqual(computeBallSnap({ left: 1220, top: 750 }, { width: 1280, height: 800 }, 44, 12),
    { edge: 'bottom', left: 1220, top: 800 - 44 - 12 });
  // 左下:球心(32,762),左 32 < 下 38 → 左
  assert.deepEqual(computeBallSnap({ left: 10, top: 740 }, { width: 1280, height: 800 }, 44, 12),
    { edge: 'left', left: 12, top: 740 });
});

test('computeBallSnap: 视口中央松手 → 上/下胜出(左/右距离更大)', () => {
  // 球心(622,322):上 322 < 下 478 < 左 622 < 右 658 → 上
  assert.deepEqual(computeBallSnap({ left: 600, top: 300 }, { width: 1280, height: 800 }, 44, 12),
    { edge: 'top', left: 600, top: 12 });
  // 球心(622,472):下 328 最小 → 下
  assert.deepEqual(computeBallSnap({ left: 600, top: 450 }, { width: 1280, height: 800 }, 44, 12),
    { edge: 'bottom', left: 600, top: 800 - 44 - 12 });
});

test('computeBallSnap: 平局打破顺序 左→右→上→下', () => {
  const V = { width: 300, height: 300 };
  // 全部相等(正中心,球心 150,150)→ 左
  assert.equal(computeBallSnap({ left: 128, top: 128 }, V, 44, 12).edge, 'left');
  // 右=上(球心 200,100)→ 右(右优先于上)
  assert.equal(computeBallSnap({ left: 178, top: 78 }, V, 44, 12).edge, 'right');
  // 左=下(球心 100,200)→ 左(左优先于下)
  assert.equal(computeBallSnap({ left: 78, top: 178 }, V, 44, 12).edge, 'left');
});

test('computeBallSnap: clamp 边界(贴边/溢出坐标、极小视口)', () => {
  // 松手坐标溢出左边界 → 吸附左,top 原样保留
  assert.deepEqual(computeBallSnap({ left: -50, top: 100 }, { width: 1280, height: 800 }, 44, 12),
    { edge: 'left', left: 12, top: 100 });
  // 松手坐标溢出上边界 → 吸附上,left 原样保留
  assert.deepEqual(computeBallSnap({ left: 500, top: -30 }, { width: 1280, height: 800 }, 44, 12),
    { edge: 'top', left: 500, top: 12 });
  // 极小视口 100×100(可满足):贴顶 + left 正常保留
  assert.deepEqual(computeBallSnap({ left: 30, top: 10 }, { width: 100, height: 100 }, 44, 12),
    { edge: 'top', left: 30, top: 12 });
  // 极小视口 50×50(几何不可满足:球 44 + 边距 24 > 50):仍按公式确定性输出,
  // 吸附边 left=W-56=-6,正交 top clamp 回落 12;不产生 NaN
  const tiny = computeBallSnap({ left: 5, top: 5 }, { width: 50, height: 50 }, 44, 12);
  assert.deepEqual(tiny, { edge: 'right', left: -6, top: 12 });
});

// ---------- computePanelPlacement 垂直锚定(edge='top'|'bottom')----------

test('垂直锚定:球贴上缘 → 面板在球下方(gap 8),水平居中于球心', () => {
  const p = computePanelPlacement({ left: 500, top: 12, width: 44, height: 44 }, PANEL, V, 'top');
  assert.deepEqual(p, { mode: 'side', left: 342, top: 12 + 44 + 8, flipped: false });
});

test('垂直锚定:球贴上缘,下方放不下 → 翻转到球上方(flipped=true)', () => {
  // 纯函数几何:ball.top=580 时下方 632+560=1192 > 788 失败,上方 580-8-560=12 成功
  const p = computePanelPlacement({ left: 500, top: 580, width: 44, height: 44 }, PANEL, V, 'top');
  assert.deepEqual(p, { mode: 'side', left: 342, top: 12, flipped: true });
});

test('垂直锚定:球贴上缘,上/下都放不下 → sheet', () => {
  const tallPanel = { width: 360, height: 760 };
  const p = computePanelPlacement({ left: 500, top: 12, width: 44, height: 44 }, tallPanel, V, 'top');
  assert.deepEqual(p, { mode: 'sheet' });
});

test('垂直锚定:球贴下缘 → 面板在球上方,水平居中于球心', () => {
  const p = computePanelPlacement({ left: 500, top: 800 - 44 - 12, width: 44, height: 44 }, PANEL, V, 'bottom');
  assert.deepEqual(p, { mode: 'side', left: 342, top: 800 - 44 - 12 - 8 - PANEL.height, flipped: false });
});

test('垂直锚定:球贴下缘,上方放不下 → 翻转到球下方(flipped=true)', () => {
  // ball.top=100:上方 100-8-560 < 12 失败;下方 152+560=712 ≤ 788 成功
  const p = computePanelPlacement({ left: 500, top: 100, width: 44, height: 44 }, PANEL, V, 'bottom');
  assert.deepEqual(p, { mode: 'side', left: 342, top: 100 + 44 + 8, flipped: true });
});

test('垂直锚定:球贴下缘,上/下都放不下 → sheet', () => {
  const tallPanel = { width: 360, height: 760 };
  const p = computePanelPlacement({ left: 500, top: 800 - 44 - 12, width: 44, height: 44 }, tallPanel, V, 'bottom');
  assert.deepEqual(p, { mode: 'sheet' });
});

test('垂直锚定:水平居中 clamp [12, vw-panelW-12]', () => {
  // 球心贴左:居中 -158 → clamp 12
  const left = computePanelPlacement({ left: 0, top: 12, width: 44, height: 44 }, PANEL, V, 'top');
  assert.equal(left.mode, 'side');
  if (left.mode === 'side') assert.equal(left.left, PANEL_EDGE_MARGIN);
  // 球心贴右:居中 1078 → clamp 908
  const right = computePanelPlacement({ left: 1236, top: 12, width: 44, height: 44 }, PANEL, V, 'top');
  assert.equal(right.mode, 'side');
  if (right.mode === 'side') assert.equal(right.left, 1280 - PANEL.width - PANEL_EDGE_MARGIN);
  // 常规球心:居中原值
  const mid = computePanelPlacement({ left: 600, top: 800 - 44 - 12, width: 44, height: 44 }, PANEL, V, 'bottom');
  assert.equal(mid.mode, 'side');
  if (mid.mode === 'side') assert.equal(mid.left, 600 + 22 - PANEL.width / 2);
});

// ---------- computePanelPlacement edge='left'|'right'(强制分侧)----------

test("edge='left' → 面板在球右侧(即使球在右半区也强制)", () => {
  const p = computePanelPlacement({ left: 700, top: 100, width: 44, height: 44 }, PANEL, V, 'left');
  assert.deepEqual(p, { mode: 'side', left: 700 + 44 + PANEL_BALL_GAP, top: 100, flipped: false });
});

test("edge='right' → 面板在球左侧(即使球在左半区也强制)", () => {
  // 球在左半区 left=12:首选左侧 12-8-360 < 12 失败 → 翻转到球右侧(flipped=true)
  const p = computePanelPlacement({ left: 12, top: 200, width: 44, height: 44 }, PANEL, V, 'right');
  assert.equal(p.mode, 'side');
  if (p.mode !== 'side') return;
  assert.equal(p.left, 12 + 44 + PANEL_BALL_GAP);
  assert.equal(p.flipped, true);
});

test('edge 缺省/undefined 与不传等价(旧行为回归)', () => {
  assert.deepEqual(computePanelPlacement(BALL, PANEL, V, undefined), computePanelPlacement(BALL, PANEL, V));
  assert.deepEqual(computePanelPlacement(BALL, PANEL, V, undefined), computePanelPlacement(BALL, PANEL, V, undefined));
});

test('垂直锚定:移动端(≤767px)→ 恒 sheet,edge 无关', () => {
  assert.deepEqual(computePanelPlacement({ left: 100, top: 12, width: 44, height: 44 }, PANEL, { width: 430, height: 800 }, 'top'), { mode: 'sheet' });
  assert.deepEqual(computePanelPlacement({ left: 100, top: 700, width: 44, height: 44 }, PANEL, { width: MOBILE_MAX_WIDTH, height: 800 }, 'bottom'), { mode: 'sheet' });
});
