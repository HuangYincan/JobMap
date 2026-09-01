// ============================================================
// Position freshness and authenticity signals.
//
// Authenticity is primarily a source-provenance decision. External-id prefixes
// remain only as a compatibility rule for the historical official-career
// portal rows and for source-less legacy records; adding a new source must be
// done in recruitment-provenance.ts, not by scattering another prefix check.
// ============================================================

import { sourceAuthenticityPolicy, SOURCE_META } from './recruitment-provenance.ts';

export type FreshnessKind = 'radar' | 'portal' | 'seed';

const AUTHENTIC_ID_PREFIXES: ReadonlyArray<[string, FreshnessKind]> = [
  ['radar-', 'radar'],
  ['portal-', 'portal'],
];

export function positionFreshness(id: string | undefined): FreshnessKind {
  if (!id) return 'seed';
  return AUTHENTIC_ID_PREFIXES.find(([prefix]) => id.startsWith(prefix))?.[1] ?? 'seed';
}

/**
 * Backward-compatible identity-only check. New import paths should call
 * isAuthenticPositionRecord so registered source provenance wins.
 */
export function isAuthenticPositionId(id: string | undefined): boolean {
  return positionFreshness(id) !== 'seed';
}

export interface PositionProvenance {
  externalId?: string;
  source?: string;
}

/**
 * Decide whether a normalized position may be written as live recruitment data.
 *
 * - `source` policy: every position from that reviewed source is authentic;
 * - `id-prefix` policy: the source contains mixed scaffold and portal rows, so
 *   only the centrally defined portal/radar identity is eligible;
 * - `none`: never make a position live;
 * - missing source: preserve the legacy radar/portal behavior for old callers.
 */
export function isAuthenticPositionRecord(position: PositionProvenance): boolean {
  const source = position.source?.trim();
  if (!source) return isAuthenticPositionId(position.externalId);
  const policy = sourceAuthenticityPolicy(source);
  if (policy === 'source') return true;
  if (policy === 'id-prefix') return isAuthenticPositionId(position.externalId);
  return false;
}

/**
 * SQL equivalent of isAuthenticPositionRecord for public DB reads. Source
 * codes are emitted from SOURCE_META so unknown/source-less rows remain
 * excluded. The id-prefix policy currently applies to official-career's
 * portal-* rows; add a registry-aware branch here when another such source is
 * introduced.
 */
export function authenticPositionSql(sourceAlias = 'source_registry', positionAlias = 'p'): string {
  const sourceCodes = Object.entries(SOURCE_META)
    .filter(([, metadata]) => metadata.authenticity === 'source')
    .map(([code]) => `'${code.replaceAll("'", "''")}'`)
    .join(', ');
  const sourceClause = sourceCodes ? `${sourceAlias}.code IN (${sourceCodes})` : 'FALSE';
  const idPrefixCodes = Object.entries(SOURCE_META)
    .filter(([, metadata]) => metadata.authenticity === 'id-prefix')
    .map(([code]) => `(${sourceAlias}.code = '${code.replaceAll("'", "''")}' AND ${positionAlias}.external_id LIKE 'portal-%')`)
    .join(' OR ');
  return `(${[sourceClause, idPrefixCodes].filter(Boolean).join(' OR ')})`;
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
