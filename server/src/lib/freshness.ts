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
