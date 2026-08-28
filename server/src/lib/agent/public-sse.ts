import type { AgentEvent } from './types.ts';

/**
 * 网络 SSE 允许下行的事件类型。reasoning 只服务于服务端 provider tool-call
 * replay,不属于公开协议;路由在 enqueue 前必须通过此 allowlist。
 */
export const SSE_EVENT_TYPES = ['delta', 'tool', 'action', 'images', 'done', 'error'] as const;

type PublicSseEvent = Exclude<AgentEvent, { type: 'reasoning' }>;

/**
 * 网络发送边界过滤:允许的事件原样返回,reasoning/未知事件返回 null。
 * 该函数保持纯函数,让 SSE 契约可在不加载 Next route 的测试中精确回归。
 */
export function filterPublicSseEvent(event: AgentEvent): PublicSseEvent | null {
  if (!SSE_EVENT_TYPES.includes(event.type as (typeof SSE_EVENT_TYPES)[number])) return null;
  return event as PublicSseEvent;
}
