// AI Agent 面板消息状态机(纯函数,零 DOM,可单测)。
//
// 服务端事件按轮序流式下发(reasoning → delta → tool → …,一轮 = 一次模型生成 +
// 工具调用),面板经 reduceAgentEvent 把每轮拆成独立 assistant 消息,视觉上呈现
// 「文本1、工具1、文本2、工具2…」交替(轮序 = 消息序)。
//
// 轮边界规则:
// - delta/reasoning:最后一条 assistant 消息已有 tools → 开新消息(下一轮),否则追加;
//   reasoning 总在其轮的 delta 之前;
// - tool start:同轮归并到当前消息;最后一条 assistant 消息已有 tools → 开新消息;
// - tool done/error:在「所在消息」(含对应 start 项的消息,从后往前找)内原位更新;
//   找不到 start → 挂到最后一条 assistant 消息(没有则新建);
// - action:追加到最后一条 assistant 消息的 actions(没有则新建)——最终轮文本+动作同消息;
// - done/error(事件级):透传,不拆消息、不改消息。
//
// 用户消息不进本状态机(面板 send 时原样追加);事件流中的 assistant 事件永远
// 面向新的用户消息之后的消息序列。

import type { AgentAction, AgentEvent } from "./agent/types.ts";

export interface ToolActivity {
  name: string;
  status: "start" | "done" | "error";
  summary?: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  actions?: AgentAction[];
  /** 思考过程(reasoning 事件流式累积;服务端已截断 4000 字符)。 */
  reasoning?: string;
  /** 工具活动列表(tool 事件;⟳ 开始 / ✓ 完成 / ✗ 失败)。 */
  tools?: ToolActivity[];
}

function lastMessage(messages: AgentMessage[]): AgentMessage | undefined {
  return messages[messages.length - 1];
}

/** 最后一条 assistant 消息是否已带工具活动(轮边界判据)。 */
function lastHasTools(messages: AgentMessage[]): boolean {
  const last = lastMessage(messages);
  return Boolean(last && last.role === "assistant" && last.tools && last.tools.length > 0);
}

/** 原地替换最后一条消息(调用方须保证 messages 非空)。 */
function updateLast(messages: AgentMessage[], update: (m: AgentMessage) => AgentMessage): AgentMessage[] {
  const copy = [...messages];
  copy[copy.length - 1] = update(copy[copy.length - 1]);
  return copy;
}

/** 追加一条新 assistant 消息。 */
function appendAssistant(messages: AgentMessage[], over: Partial<AgentMessage> = {}): AgentMessage[] {
  return [...messages, { role: "assistant", content: "", ...over }];
}

export function reduceAgentEvent(messages: AgentMessage[], ev: AgentEvent): AgentMessage[] {
  switch (ev.type) {
    case "delta": {
      if (lastHasTools(messages)) return appendAssistant(messages, { content: ev.text });
      const last = lastMessage(messages);
      if (last && last.role === "assistant") {
        return updateLast(messages, (m) => ({ ...m, content: m.content + ev.text }));
      }
      return appendAssistant(messages, { content: ev.text });
    }

    case "reasoning": {
      if (lastHasTools(messages)) return appendAssistant(messages, { reasoning: ev.text });
      const last = lastMessage(messages);
      if (last && last.role === "assistant") {
        return updateLast(messages, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + ev.text }));
      }
      return appendAssistant(messages, { reasoning: ev.text });
    }

    case "tool": {
      const info: ToolActivity = { name: ev.name, status: ev.status };
      if (ev.status === "start") {
        if (lastHasTools(messages)) return appendAssistant(messages, { tools: [info] });
        const last = lastMessage(messages);
        if (last && last.role === "assistant") {
          return updateLast(messages, (m) => ({ ...m, tools: [...(m.tools ?? []), info] }));
        }
        return appendAssistant(messages, { tools: [info] });
      }
      // done/error:定位含对应 start 项的消息(从后往前),原位更新;找不到 → 挂到最后一条
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== "assistant") continue;
        const tools = m.tools ?? [];
        if (!tools.some((x) => x.name === info.name && x.status === "start")) continue;
        const copy = [...messages];
        copy[i] = {
          ...m,
          tools: tools.map((x) => (x.name === info.name && x.status === "start" ? { ...x, ...info } : x)),
        };
        return copy;
      }
      const last = lastMessage(messages);
      if (last && last.role === "assistant") {
        return updateLast(messages, (m) => ({ ...m, tools: [...(m.tools ?? []), info] }));
      }
      return appendAssistant(messages, { tools: [info] });
    }

    case "action": {
      const last = lastMessage(messages);
      if (last && last.role === "assistant") {
        return updateLast(messages, (m) => ({ ...m, actions: [...(m.actions ?? []), ev.action] }));
      }
      return appendAssistant(messages, { actions: [ev.action] });
    }

    case "done":
    case "error":
      // 透传:不拆消息、不改消息(面板在事件级处理 done/error 状态)
      return messages;
  }
}
