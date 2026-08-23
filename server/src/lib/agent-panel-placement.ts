// 面板跟随悬浮球 + 悬浮球四向吸附:纯布局函数(可单测,零 DOM 依赖)。
//
// 锚点语义(与 agent-ball/agent-panel 配套,2026-08-21 UX 增强):
// - 球在右半区 → 面板右缘贴球左缘(gap 8px),面板在球左侧;
// - 球在左半区 → 面板左缘贴球右缘(gap 8px),面板在球右侧;
// - 横向边界:首选侧放不下(溢出视口,含 12px 边距)→ 翻转到球另一侧;
// - 两侧都放不下(极窄视口)→ mode 'sheet'(全宽底部 sheet,复用移动端抽屉模式);
// - 移动端(≤767px)恒 sheet(与 agent-panel.module.css 的 media query 同阈值);
// - 垂直(edge='top'|'bottom',球贴上下边缘):面板优先在球对侧(gap 8),
//   放不下翻转到另一侧,两侧都放不下 → sheet;水平居中于球心,clamp 12px;
// - 水平(edge 缺省或 'left'/'right'):面板 top 与球 top 对齐,clamp 在
//   [12, viewportH - panelH - 12]。

export const PANEL_BALL_GAP = 8;
export const PANEL_EDGE_MARGIN = 12;
export const MOBILE_MAX_WIDTH = 767;

/** 悬浮球吸附边缘(四向)。 */
export type BallSnapEdge = 'left' | 'right' | 'top' | 'bottom';

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

export interface BallPosition {
  left: number | null;
  right: number | null;
  top: number;
}

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
 * 纯函数:悬浮球松手四向吸附决策。按「球心到四边距离最近」选边,
 * 平局打破顺序固定 左→右→上→下(确定性,可测)。
 * - 距离:左 = centerX,右 = viewportW - centerX,上 = centerY,下 = viewportH - centerY;
 * - 吸附坐标:left/right 吸附 → left 贴边(margin),top 保留松手坐标并 clamp
 *   [margin, viewportH - ballSize - margin];top/bottom 吸附 → top 贴边,
 *   left 保留松手坐标并 clamp [margin, viewportW - ballSize - margin]。
 * 返回值含最终吸附坐标(left/top 为球左上角,viewport 坐标系)。
 */
export function computeBallSnap(
  drop: { left: number; top: number },
  viewport: { width: number; height: number },
  ballSize: number,
  margin: number,
): { edge: BallSnapEdge; left: number; top: number } {
  const centerX = drop.left + ballSize / 2;
  const centerY = drop.top + ballSize / 2;
  const distances = [centerX, viewport.width - centerX, centerY, viewport.height - centerY];
  const edges: BallSnapEdge[] = ['left', 'right', 'top', 'bottom'];
  // indexOf 取第一个最小值 → 平局时按 左→右→上→下 顺序
  const edge = edges[distances.indexOf(Math.min(...distances))];

  const clampAxis = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  if (edge === 'left') {
    return { edge, left: margin, top: clampAxis(drop.top, margin, viewport.height - ballSize - margin) };
  }
  if (edge === 'right') {
    return { edge, left: viewport.width - ballSize - margin, top: clampAxis(drop.top, margin, viewport.height - ballSize - margin) };
  }
  if (edge === 'top') {
    return { edge, left: clampAxis(drop.left, margin, viewport.width - ballSize - margin), top: margin };
  }
  return { edge, left: clampAxis(drop.left, margin, viewport.width - ballSize - margin), top: viewport.height - ballSize - margin };
}

/**
 * 恢复持久化位置时收敛到当前视口。极小视口下可用区间可能为负,
 * 此时退回贴边距位置,保证球至少有一角可见且可拖拽。
 */
export function clampBallPosition(
  position: BallPosition,
  viewport: ViewportSize,
  ballSize: number,
  margin: number,
): BallPosition {
  const maxTop = Math.max(margin, viewport.height - ballSize - margin);
  const maxLeft = Math.max(margin, viewport.width - ballSize - margin);
  return {
    left: position.left === null ? null : clamp(position.left, margin, maxLeft),
    right: position.right,
    top: clamp(position.top, margin, maxTop),
  };
}

/**
 * 计算面板锚定位置。ball/panel/viewport 均为纯几何输入(px)。
 * - 返回值 left/top 为面板左上角(viewport 坐标系),供 transform 锚定;
 * - flipped=true 表示实际落在了首选侧的对侧(翻转过)。
 * - 可选 edge:球当前吸附边缘。'left'/'right' → 强制面板在球对侧
 *   ('left' → 面板在球右,'right' → 面板在球左);'top'/'bottom' → 垂直锚定
 *   (面板优先在球对侧,放不下翻转,都放不下 → sheet);edge 缺省 → 按球心
 *   左右半区水平锚定 + 垂直 clamp(旧行为,旧调用语义不变)。
 */
export function computePanelPlacement(
  ball: BallRect,
  panel: PanelSize,
  viewport: ViewportSize,
  edge?: BallSnapEdge,
): PanelPlacement {
  // 移动端恒底部 sheet(与 CSS media query 同阈值,不受球位置影响)
  if (viewport.width <= MOBILE_MAX_WIDTH) return { mode: 'sheet' };

  // 垂直锚定(球贴上下边缘):面板水平居中于球心,垂直优先对侧 + 翻转 + sheet
  if (edge === 'top' || edge === 'bottom') {
    const belowTop = ball.top + ball.height + PANEL_BALL_GAP;
    const aboveTop = ball.top - PANEL_BALL_GAP - panel.height;
    const belowFits = belowTop + panel.height <= viewport.height - PANEL_EDGE_MARGIN;
    const aboveFits = aboveTop >= PANEL_EDGE_MARGIN;
    const preferBelow = edge === 'top'; // 球贴顶 → 首选面板在球下方

    let top: number;
    let flipped: boolean;
    if (preferBelow) {
      if (belowFits) {
        top = belowTop;
        flipped = false;
      } else if (aboveFits) {
        top = aboveTop;
        flipped = true;
      } else {
        return { mode: 'sheet' };
      }
    } else if (aboveFits) {
      top = aboveTop;
      flipped = false;
    } else if (belowFits) {
      top = belowTop;
      flipped = true;
    } else {
      return { mode: 'sheet' };
    }

    // 水平:面板居中于球心,clamp [12, viewportW - panelW - 12]
    const maxLeft = Math.max(PANEL_EDGE_MARGIN, viewport.width - panel.width - PANEL_EDGE_MARGIN);
    const left = clamp(ball.left + ball.width / 2 - panel.width / 2, PANEL_EDGE_MARGIN, maxLeft);
    return { mode: 'side', left, top, flipped };
  }

  const ballCenter = ball.left + ball.width / 2;
  // edge 显式时强制分侧('left' → 面板在球右,'right' → 面板在球左);缺省按半区
  const preferLeftSide = edge === 'right' ? true : edge === 'left' ? false : ballCenter > viewport.width / 2;

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
