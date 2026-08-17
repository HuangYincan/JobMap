// ============================================================
// 在招判断 — 客户端兜底过滤(服务端 alive 过滤在 WS1)
//
// A1 决策:所有读路径只保留「在招中」岗位:
//   status === 'open' 且 deadline 为空或 >= 今天。
// 过期或非 open 的岗位不展示;岗位全部过期时公司整体不展示。
//
// 纯函数、now 可注入,便于单测;不依赖 AMap / React / fetch。
// ============================================================

import type { Position } from './types.ts';

/**
 * deadline 字符串 → 当天本地零点。
 * 优先按 YYYY-MM-DD 拆解(避免 Date.parse 把日期串当 UTC 凌晨解析,
 * 造成负时区提前一天过期);其他格式回退 Date.parse。
 * 无法解析返回 null。
 */
export function deadlineLocalMidnight(deadline: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(deadline.trim());
  if (m) {
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(date.getTime())) return date;
  }
  const parsed = Date.parse(deadline);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/**
 * 岗位是否「在招中」:status=open 且截止为空或 >= 今天(截止当天仍算在招)。
 * 无法解析的截止日期按「在招」处理——宁肯展示,不误杀真实岗位。
 * now 默认当前时间,测试可注入。
 */
export function isAlivePosition(position: Position, now: Date = new Date()): boolean {
  if (position.status !== 'open') return false;
  if (!position.deadline) return true;
  const deadline = deadlineLocalMidnight(position.deadline);
  if (!deadline) return true;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return deadline.getTime() >= startOfToday;
}

/** 公司 POI 的「在招中」岗位列表(保留原数组顺序) */
export function alivePositions<T extends { positions: Position[] }>(
  poi: T,
  now?: Date
): Position[] {
  return poi.positions.filter((p) => isAlivePosition(p, now));
}

/**
 * 只保留在招岗位的 POI;一个在招岗位都没有时返回 null,
 * 调用方据此把该公司从展示中剔除(与服务端零在招公司不下发的行为一致)。
 */
export function withAlivePositions<T extends { positions: Position[] }>(
  poi: T,
  now?: Date
): T | null {
  const positions = alivePositions(poi, now);
  if (positions.length === 0) return null;
  return { ...poi, positions };
}
