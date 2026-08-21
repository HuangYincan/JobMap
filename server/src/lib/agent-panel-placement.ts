// 面板跟随悬浮球:纯布局函数(可单测,零 DOM 依赖)。
//
// 锚点语义(与 agent-ball/agent-panel 配套,2026-08-21 UX 增强):
// - 球在右半区 → 面板右缘贴球左缘(gap 8px),面板在球左侧;
// - 球在左半区 → 面板左缘贴球右缘(gap 8px),面板在球右侧;
// - 横向边界:首选侧放不下(溢出视口,含 12px 边距)→ 翻转到球另一侧;
// - 两侧都放不下(极窄视口)→ mode 'sheet'(全宽底部 sheet,复用移动端抽屉模式);
// - 移动端(≤767px)恒 sheet(与 agent-panel.module.css 的 media query 同阈值);
// - 垂直:面板 top 与球 top 对齐,clamp 在 [12, viewportH - panelH - 12]。

export const PANEL_BALL_GAP = 8;
export const PANEL_EDGE_MARGIN = 12;
export const MOBILE_MAX_WIDTH = 767;

export interface BallRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export type PanelPlacement =
  | { mode: 'side'; left: number; top: number; flipped: boolean }
  | { mode: 'sheet' };

/** clamp 到 [min, max];min > max 时取 min(面板高于视口时贴顶)。 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 纯函数:在「首选侧放不下」时决策是否翻转到另一侧(或降级 sheet)。
 * - preferLeft:球在右半区(首选把面板放在球左侧);
 * - fitsLeft / fitsRight:对应侧放得下(含 12px 边距与 8px 间隙)。
 * 返回值:最终放置侧;'sheet' 表示两侧都放不下。
 */
export function pickPanelSide(preferLeft: boolean, fitsLeft: boolean, fitsRight: boolean): 'left' | 'right' | 'sheet' {
  if (preferLeft) {
    if (fitsLeft) return 'left';
    if (fitsRight) return 'right'; // 溢出 → 翻转到球另一侧
    return 'sheet';
  }
  if (fitsRight) return 'right';
  if (fitsLeft) return 'left'; // 溢出 → 翻转到球另一侧
  return 'sheet';
}

/**
 * 计算面板锚定位置。ball/panel/viewport 均为纯几何输入(px)。
 * - 返回值 left/top 为面板左上角(viewport 坐标系),供 transform 锚定;
 * - flipped=true 表示实际落在了首选侧的对侧(翻转过)。
 */
export function computePanelPlacement(
  ball: BallRect,
  panel: PanelSize,
  viewport: ViewportSize,
): PanelPlacement {
  // 移动端恒底部 sheet(与 CSS media query 同阈值,不受球位置影响)
  if (viewport.width <= MOBILE_MAX_WIDTH) return { mode: 'sheet' };

  const ballCenter = ball.left + ball.width / 2;
  const preferLeftSide = ballCenter > viewport.width / 2;

  // 面板左缘(球左侧放置:panel 右缘 = ball.left - gap)
  const leftSideLeft = ball.left - PANEL_BALL_GAP - panel.width;
  // 面板左缘(球右侧放置:panel 左缘 = ball.right + gap)
  const rightSideLeft = ball.left + ball.width + PANEL_BALL_GAP;

  const fitsLeft = leftSideLeft >= PANEL_EDGE_MARGIN;
  const fitsRight = rightSideLeft + panel.width <= viewport.width - PANEL_EDGE_MARGIN;

  const side = pickPanelSide(preferLeftSide, fitsLeft, fitsRight);
  if (side === 'sheet') return { mode: 'sheet' };

  const left = side === 'left' ? leftSideLeft : rightSideLeft;
  const flipped = side !== (preferLeftSide ? 'left' : 'right');

  // 垂直:top 对齐球 top,clamp [12, viewportH - panelH - 12]
  const maxTop = Math.max(PANEL_EDGE_MARGIN, viewport.height - panel.height - PANEL_EDGE_MARGIN);
  const top = clamp(ball.top, PANEL_EDGE_MARGIN, maxTop);

  return { mode: 'side', left, top, flipped };
}
