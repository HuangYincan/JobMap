// 每会话独立流状态(ws-pstream:agent 会话并行流,切换会话不打断)。
//
// 流状态从面板单例(一个 abortRef + 单一 streaming/messages)改为
// `Map<sessionId, SessionStream>` 纯函数管理(内存为事实源):
// - startStream:发消息时建流(streaming=true,controller 注入,消息种子 = 用户消息后全量);
// - routeDelta / routeTool / routeAction:事件按**流所属 sessionId** 路由到该会话
//   messages(reduceAgentEvent 按轮拆分),其余会话不受影响(并行流互不打断);
// - markDone / markStreamError:per-session 完成/错误状态(done/truncated/notConfigured/
//   fatalError/tool),done 只落本会话;
// - finishStream(流 finally):streaming=false + completion 判定(与 resolveCompletion
//   同款规则:done 事件 → 'done';用户停止 → 'stopped';异常/静默 → null);
// - finishStreamIfCurrent / isCurrentController:打断后同 sessionId 换新 controller,
//   旧 finally 不得落定到新流;
// - stopStream / removeStream / abortAllStreams:终止/移除/卸载清理(controller.abort,
//   不泄漏);removeStream 同时删 entry —— 之后 finally 的迟到事件安全落空(no-op);
// - 未知 sessionId 一律 no-op 且返回原 map 引用(会话已删的迟到事件安全落空)。
//
// 本模块零 DOM/零 React,node 环境可单测;组件侧只调用这些纯函数 + 落库边界。

import type { AgentAction, AgentEvent } from "./agent/types.ts";
import { reduceAgentEvent, type AgentMessage } from "./agent-panel-state.ts";
import type { AgentCompletionState, AgentToolInfo } from "../components/agent-map-executor.ts";

/** 单个会话的流状态(controller + 进行中标记 + 内存消息 + per-session UI 状态)。 */
export interface SessionStream {
  /** 本流 abort 控制器(停止/删除/卸载时 abort;与其他会话流互不相干)。 */
  controller: AbortController;
  /** 流式进行中(done/error 事件不置 false,以 finally 的 finishStream 为准)。 */
  streaming: boolean;
  /** 内存消息(事实源);显示 = 本会话 entry 的 messages ?? 从 store 载入。 */
  messages: AgentMessage[];
  /** done 事件是否已到达(finishStream 判定 completion 用)。 */
  done: boolean;
  /** 完成状态行:done 事件 → 'done';用户停止 → 'stopped';无 → null。 */
  completion: AgentCompletionState;
  /** done 事件携带的截断说明(「已达回答上限」弱提示)。 */
  truncated: boolean;
  /** 未配置提示(503 LLM_UNCONFIGURED → agentNotConfigured)。 */
  notConfigured: boolean;
  /** 致命错误文案(已本地化;RATE_LIMITED / 其他 → agentError)。 */
  fatalError: string | null;
  /** 顶部工具状态条:只反映运行中的工具(start 事件),done/error 清空。 */
  tool: AgentToolInfo | null;
}

/** 流 Map:sessionId → SessionStream。只读语义,增删改一律返回新 Map。 */
export type SessionStreamMap = ReadonlyMap<string, SessionStream>;

/** 空流 Map(初始/刷新后)。 */
export const EMPTY_STREAM_MAP: SessionStreamMap = new Map();

/** 新会话流(发消息时经 startStream 覆盖式建流,清空上一轮完成/错误状态)。 */
export function createSessionStream(controller: AbortController): SessionStream {
  return {
    controller,
    streaming: true,
    messages: [],
    done: false,
    completion: null,
    truncated: false,
    notConfigured: false,
    fatalError: null,
    tool: null,
  };
}

/** 更新某会话 entry;未知 sessionId → 原 map 引用(no-op)。 */
function updateEntry(
  map: SessionStreamMap,
  sessionId: string,
  update: (entry: SessionStream) => SessionStream,
): SessionStreamMap {
  const entry = map.get(sessionId);
  if (!entry) return map;
  const next = new Map(map);
  next.set(sessionId, update(entry));
  return next;
}

/** 发消息建流:覆盖式(同一会话重发 = 新一轮,完成/错误状态随之清零)。 */
export function startStream(
  map: SessionStreamMap,
  sessionId: string,
  controller: AbortController,
  messages: AgentMessage[],
): SessionStreamMap {
  const next = new Map(map);
  next.set(sessionId, { ...createSessionStream(controller), messages });
  return next;
}

/** 按流所属 sessionId 路由 delta 事件(其余会话不受影响)。 */
export function routeDelta(map: SessionStreamMap, sessionId: string, text: string): SessionStreamMap {
  return updateEntry(map, sessionId, (e) => ({ ...e, messages: reduceAgentEvent(e.messages, { type: "delta", text }) }));
}

/** 按流所属 sessionId 路由 tool 事件(活动列表 + 顶部状态条,均 per-session)。 */
export function routeTool(map: SessionStreamMap, sessionId: string, info: AgentToolInfo): SessionStreamMap {
  return updateEntry(map, sessionId, (e) => ({
    ...e,
    tool: info.status === "start" ? info : null,
    messages: reduceAgentEvent(e.messages, {
      type: "tool",
      name: info.name,
      status: info.status,
      summary: info.summary,
    } as AgentEvent),
  }));
}

/** 按流所属 sessionId 路由 action 事件(建议卡片落在该会话消息底部)。 */
export function routeAction(map: SessionStreamMap, sessionId: string, action: AgentAction): SessionStreamMap {
  return updateEntry(map, sessionId, (e) => ({ ...e, messages: reduceAgentEvent(e.messages, { type: "action", action }) }));
}

/** 搜索结果图片落到该会话最后一条助手消息(最终回答气泡下方)。 */
export function routeImages(
  map: SessionStreamMap,
  sessionId: string,
  images: Array<{ url: string; alt?: string }>,
): SessionStreamMap {
  return updateEntry(map, sessionId, (e) => ({
    ...e,
    messages: reduceAgentEvent(e.messages, { type: "images", images }),
  }));
}

/** done 事件到达:只落本会话(done/truncated/completion),其余会话不受影响。 */
export function markDone(map: SessionStreamMap, sessionId: string, truncated: boolean): SessionStreamMap {
  return updateEntry(map, sessionId, (e) => ({ ...e, done: true, truncated, completion: "done", tool: null }));
}

/** error 事件到达:per-session 未配置/致命错误弱提示(文案已本地化,组件侧解析)。 */
export function markStreamError(
  map: SessionStreamMap,
  sessionId: string,
  opts: { notConfigured: boolean; fatalText: string | null },
): SessionStreamMap {
  return updateEntry(map, sessionId, (e) => ({
    ...e,
    notConfigured: opts.notConfigured,
    fatalError: opts.fatalText,
    tool: null,
  }));
}

/**
 * 流结束(finally)落定:streaming=false + completion 判定(与 executor 的
 * resolveCompletion 同款规则:done 事件 → 'done';用户停止 → 'stopped';其他 → null)。
 * 未知 sessionId(会话已删/已清屏)→ no-op,原 map 引用。
 */
export function finishStream(map: SessionStreamMap, sessionId: string, aborted: boolean): SessionStreamMap {
  return updateEntry(map, sessionId, (e) => ({
    ...e,
    streaming: false,
    completion: e.done ? "done" : aborted ? "stopped" : null,
  }));
}

/** 该会话当前 entry 是否仍是这次 run 的 controller(打断后同 sessionId 会换新流)。 */
export function isCurrentController(
  map: SessionStreamMap,
  sessionId: string,
  controller: AbortController,
): boolean {
  return map.get(sessionId)?.controller === controller;
}

/**
 * 仅当 finally 仍对应本 run 的 controller 时落定。
 * 打断/清屏会 removeStream 后再 startStream 同一 sessionId:旧 finally 不得
 * 把新流标成 stopped,也不得把半成品写进新 entry。
 */
export function finishStreamIfCurrent(
  map: SessionStreamMap,
  sessionId: string,
  controller: AbortController,
  aborted: boolean,
): SessionStreamMap {
  if (!isCurrentController(map, sessionId, controller)) return map;
  return finishStream(map, sessionId, aborted);
}

/** 停止某会话的流(abort 该会话 controller;其余会话不受影响;map 不变)。 */
export function stopStream(map: SessionStreamMap, sessionId: string): SessionStreamMap {
  map.get(sessionId)?.controller.abort();
  return map;
}

/** 删除会话/清屏:终止并移除该会话的流;未知 sessionId → 原 map 引用。 */
export function removeStream(map: SessionStreamMap, sessionId: string): SessionStreamMap {
  map.get(sessionId)?.controller.abort();
  if (!map.has(sessionId)) return map;
  const next = new Map(map);
  next.delete(sessionId);
  return next;
}

/** 卸载清理:abort 全部流 controller(React 严格模式/组件卸载不泄漏)。 */
export function abortAllStreams(map: SessionStreamMap): void {
  for (const entry of map.values()) entry.controller.abort();
}

/** 某会话是否流式进行中(会话列表「进行中」标记 / 防重入)。 */
export function isStreaming(map: SessionStreamMap, sessionId: string | null): boolean {
  if (!sessionId) return false;
  return map.get(sessionId)?.streaming ?? false;
}

/** 某会话内存消息;无流(未流式/已移除)→ null(调用方回落 store)。 */
export function getStreamMessages(map: SessionStreamMap, sessionId: string): AgentMessage[] | null {
  return map.get(sessionId)?.messages ?? null;
}
