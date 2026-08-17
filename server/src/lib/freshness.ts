// ============================================================
// Position freshness signals (backend of tech/17 proposal)
//
// radar-*  → 「正在校招」: mapped xiaozhao-radar rows (real apply links)
// portal-* → 「官网直投」: curated verified official career portals
// These are NOT job JD — they are "this company is recruiting now" signals.
// Frontend rendering awaits approval (tech/17-freshness-presentation-proposal.md).
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
export function todayDateString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * A1（tech/18）：只在招 —— status='open' 且 deadline 为空或 >= 今天。
 * 无 deadline / 无法解析的 deadline 视为未设截止（保留）。
 * DB 读路径在 SQL 里恒开同一条规则；这里是内存路径（离线 catalog + 筛选）。
 */
export function isAlivePosition(
  pos: { status?: string; deadline?: string } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!pos) return false;
  if (pos.status !== 'open') return false;
  if (!pos.deadline) return true;
  const stamp = Date.parse(pos.deadline);
  if (!Number.isFinite(stamp)) return true;
  return stamp >= Date.parse(todayDateString(now));
}
