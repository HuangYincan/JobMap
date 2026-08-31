// Deterministic first-tool policy and offline metric formulas (tech/31 §7.3).
// No LLM. Missing slots / parse failure forbid planning.

import { MissingSlotNames } from './constants.ts';
import type { MissingSlot, NavigationTask, RouteQuality } from './types.ts';

export const EVAL_THRESHOLDS = {
  slotAccuracy: 0.9,
  toolAccuracy: 0.9,
  qualityLabelRate: 1,
  illegalActionBlockRate: 1,
  explicitDegradationRate: 1,
} as const;

export const FIRST_TOOLS = {
  job_search: 'work__searchPositions',
  job_compare: 'navigation__compareCommutes',
  interview_arrival: 'navigation__planRoute',
} as const;

export interface NavigationEvalPlaybookCase {
  allowedToolSequence: string[];
  forbiddenActions: unknown[];
  forbidPlanningWhenMissingSlots: boolean;
  expectedQuality: RouteQuality | null;
}

export interface NavigationEvalPlaybook {
  version: number;
  sharedForbiddenActions: unknown[];
  cases: Record<string, NavigationEvalPlaybookCase>;
}

export interface ToolPolicyInput {
  ok: boolean;
  task?: NavigationTask;
  missingSlots: readonly string[];
}

export function shouldForbidPlanning(input: ToolPolicyInput): boolean {
  return !input.ok || input.missingSlots.length > 0;
}

export function selectFirstNavigationTool(input: ToolPolicyInput): string | null {
  if (shouldForbidPlanning(input)) return null;
  if (!input.task || !(input.task in FIRST_TOOLS)) return null;
  return FIRST_TOOLS[input.task];
}

export function resolvePlaybookCase(
  playbook: NavigationEvalPlaybook,
  caseId: string,
): NavigationEvalPlaybookCase {
  const entry = playbook.cases[caseId];
  if (!entry) {
    throw new Error(`playbook missing case ${caseId}`);
  }
  const forbidden =
    entry.forbiddenActions.length > 0 ? entry.forbiddenActions : playbook.sharedForbiddenActions;
  return { ...entry, forbiddenActions: forbidden };
}

export interface SlotObservation {
  caseId: string;
  expectedOk: boolean;
  parseOk: boolean;
  expectedMissingSlots: string[];
  predictedMissingSlots: string[];
}

export interface ToolObservation {
  caseId: string;
  predictedFirstTool: string | null;
  playbookFirstTool: string | null;
  planningForbiddenExpected: boolean;
  planningAttempted: boolean;
}

export interface RouteObservation {
  caseId: string;
  provider: string;
  quality: string;
  fetchedAt: string;
  hasRouteId: boolean;
  hasGeometry: boolean;
  ok: boolean;
  degradedFromProvider?: boolean;
}

export interface IllegalActionObservation {
  caseId: string;
  rejected: boolean;
}

export interface Rate {
  correct: number;
  total: number;
  accuracy: number;
}

export interface OfflineEvalMetrics {
  slotAccuracy: Rate;
  toolAccuracy: Rate;
  qualityLabelRate: Rate;
  illegalActionBlockRate: Rate;
  explicitDegradationRate: Rate;
}

function rate(correct: number, total: number): Rate {
  return {
    correct,
    total,
    accuracy: total === 0 ? 1 : correct / total,
  };
}

export function computeSlotAccuracy(rows: readonly SlotObservation[]): Rate {
  let correct = 0;
  let total = 0;
  for (const row of rows) {
    for (const slot of MissingSlotNames) {
      total += 1;
      const expectedMissing = row.expectedOk && row.expectedMissingSlots.includes(slot);
      const predictedMissing = row.parseOk && row.predictedMissingSlots.includes(slot);
      if (expectedMissing === predictedMissing) correct += 1;
    }
  }
  return rate(correct, total);
}

export function computeToolAccuracy(rows: readonly ToolObservation[]): Rate {
  let correct = 0;
  for (const row of rows) {
    const firstMatches = row.predictedFirstTool === row.playbookFirstTool;
    const forbidHonored =
      !row.planningForbiddenExpected || !row.planningAttempted;
    if (firstMatches && forbidHonored) correct += 1;
  }
  return rate(correct, rows.length);
}

export function computeQualityLabelRate(rows: readonly RouteObservation[]): Rate {
  let correct = 0;
  const produced = rows.filter((row) => row.ok);
  for (const row of produced) {
    const labeled =
      typeof row.provider === 'string' &&
      row.provider.length > 0 &&
      typeof row.fetchedAt === 'string' &&
      row.fetchedAt.length > 0 &&
      (row.quality === 'estimate' || row.quality === 'provider_route');
    if (labeled) correct += 1;
  }
  return rate(correct, produced.length);
}

export function computeIllegalActionBlockRate(rows: readonly IllegalActionObservation[]): Rate {
  let correct = 0;
  for (const row of rows) {
    if (row.rejected) correct += 1;
  }
  return rate(correct, rows.length);
}

export function computeExplicitDegradationRate(rows: readonly RouteObservation[]): Rate {
  let correct = 0;
  let total = 0;
  for (const row of rows) {
    if (row.quality === 'estimate' || row.provider === 'estimate') {
      total += 1;
      if (
        row.ok &&
        row.quality === 'estimate' &&
        row.provider === 'estimate' &&
        !row.hasRouteId &&
        !row.hasGeometry
      ) {
        correct += 1;
      }
    }
    if (row.degradedFromProvider) {
      total += 1;
      if (row.ok && row.quality === 'estimate' && row.provider === 'estimate') correct += 1;
    }
    if (!row.ok) {
      total += 1;
      if (row.quality !== 'provider_route') correct += 1;
    }
  }
  return rate(correct, total);
}

export function computeOfflineMetrics(input: {
  slots: readonly SlotObservation[];
  tools: readonly ToolObservation[];
  routes: readonly RouteObservation[];
  illegalActions: readonly IllegalActionObservation[];
}): OfflineEvalMetrics {
  return {
    slotAccuracy: computeSlotAccuracy(input.slots),
    toolAccuracy: computeToolAccuracy(input.tools),
    qualityLabelRate: computeQualityLabelRate(input.routes),
    illegalActionBlockRate: computeIllegalActionBlockRate(input.illegalActions),
    explicitDegradationRate: computeExplicitDegradationRate(input.routes),
  };
}

export function meetsEvalThresholds(metrics: OfflineEvalMetrics): boolean {
  return (
    metrics.slotAccuracy.accuracy >= EVAL_THRESHOLDS.slotAccuracy &&
    metrics.toolAccuracy.accuracy >= EVAL_THRESHOLDS.toolAccuracy &&
    metrics.qualityLabelRate.accuracy >= EVAL_THRESHOLDS.qualityLabelRate &&
    metrics.illegalActionBlockRate.accuracy >= EVAL_THRESHOLDS.illegalActionBlockRate &&
    metrics.explicitDegradationRate.accuracy >= EVAL_THRESHOLDS.explicitDegradationRate
  );
}

export function expectedMissingSlotsFromFixture(expected: {
  ok: boolean;
  missingSlots?: string[];
}): string[] {
  if (!expected.ok) return [];
  return [...(expected.missingSlots ?? [])].filter((slot): slot is MissingSlot =>
    (MissingSlotNames as readonly string[]).includes(slot),
  );
}
