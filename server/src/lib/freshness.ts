// ============================================================
// Position freshness signals (backend of tech/17 proposal)
//
// radar-*  → 「正在校招」: mapped xiaozhao-radar rows (real apply links)
// portal-* → 「官网直投」: curated verified official career portals
// These are NOT job JD — they are "this company is recruiting now" signals.
// 2026-08-17 决策 (tech/18 §A1): 不做复杂新鲜度徽标, 呈现上只突出「在招中」信号,
// 过期岗位自动隐藏。tech/17 提案已存档; 本文件判断函数仍用于真实岗位过滤
// (isAuthenticPositionId, 只留 radar-*/portal-* 在招行)。
// ============================================================

export type FreshnessKind = 'radar' | 'portal' | 'seed';

export function positionFreshness(id: string | undefined): FreshnessKind {
  if (!id) return 'seed';
  if (id.startsWith('radar-')) return 'radar';
  if (id.startsWith('portal-')) return 'portal';
  return 'seed';
}

/**
 * Authentic positions only: radar snapshot rows and curated verified portals.
 * Seed / official-career example jobs are development scaffolding and are not
 * shown on the map (decision 2026-08-17: work mode shows real data only).
 */
export function isAuthenticPositionId(id: string | undefined): boolean {
  const kind = positionFreshness(id);
  return kind === 'radar' || kind === 'portal';
}

export interface FreshnessSummary {
  recruiting: boolean;
  portal: boolean;
}

/** Company-level signals derived from its position ids. */
export function summarizeFreshness(positions: Array<{ id?: string }>): FreshnessSummary {
  let recruiting = false;
  let portal = false;
  for (const pos of positions) {
    const kind = positionFreshness(pos.id);
    if (kind === 'radar') recruiting = true;
    if (kind === 'portal') portal = true;
  }
  return { recruiting, portal };
}

/** 服务端本地当天（YYYY-MM-DD），与 DB 的 CURRENT_DATE 对齐。 */
