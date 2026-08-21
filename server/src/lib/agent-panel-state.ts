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
// - done/error(事件级):透传不拆消息;仅最后一条仍在「思考中」时翻转为「思考完成」。
//
// 思考状态(reasoning 事件):只标记不累积内容——消息收到 reasoning 事件 → 'thinking';
// 该消息出现 delta(内容产出)、收到 tool 事件(本轮进入工具阶段)或流结束 → 'done'。
// 内容一律不渲染,面板只消费状态标记。
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
  /** 思考状态标记(reasoning 事件只标记、不累积内容):'thinking' 思考中 → 'done' 思考完成。 */
  reasoning?: "thinking" | "done";
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

/**
 * 思考状态翻转「完成」:该消息出现 delta(内容产出)或本轮进入工具阶段 / 流结束。
 * 只翻转状态,不改内容、不新建消息;无思考标记的消息原样返回。
 */
function finishThinking(m: AgentMessage): AgentMessage {
  return m.reasoning === "thinking" ? { ...m, reasoning: "done" } : m;
}

export function reduceAgentEvent(messages: AgentMessage[], ev: AgentEvent): AgentMessage[] {
  switch (ev.type) {
    case "delta": {
      if (lastHasTools(messages)) return appendAssistant(messages, { content: ev.text });
      const last = lastMessage(messages);
      if (last && last.role === "assistant") {
        // 内容产出 → 本轮思考结束
        return updateLast(messages, (m) => finishThinking({ ...m, content: m.content + ev.text }));
      }
      return appendAssistant(messages, { content: ev.text });
    }

    case "reasoning": {
      // 只标记「思考中」,不累积内容(内容一律不渲染)
      if (lastHasTools(messages)) return appendAssistant(messages, { reasoning: "thinking" });
      const last = lastMessage(messages);
      if (last && last.role === "assistant") {
        return updateLast(messages, (m) => ({ ...m, reasoning: "thinking" }));
      }
      return appendAssistant(messages, { reasoning: "thinking" });
    }

    case "tool": {
      const info: ToolActivity = { name: ev.name, status: ev.status };
      if (ev.status === "start") {
        if (lastHasTools(messages)) return appendAssistant(messages, { tools: [info] });
        const last = lastMessage(messages);
        if (last && last.role === "assistant") {
          // 进入工具阶段 → 本轮思考结束
          return updateLast(messages, (m) => finishThinking({ ...m, tools: [...(m.tools ?? []), info] }));
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
        copy[i] = finishThinking({
          ...m,
          tools: tools.map((x) => (x.name === info.name && x.status === "start" ? { ...x, ...info } : x)),
        });
        return copy;
      }
      const last = lastMessage(messages);
      if (last && last.role === "assistant") {
        return updateLast(messages, (m) => finishThinking({ ...m, tools: [...(m.tools ?? []), info] }));
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
    case "error": {
      // 透传(数组引用不变);仅当最后一条助手消息仍在「思考中」时翻转为「思考完成」
      // (流结束兜底:只有 reasoning 没有 delta/tool 的收尾轮不再悬挂「思考中」)。
      const last = lastMessage(messages);
      if (last && last.reasoning === "thinking") return updateLast(messages, finishThinking);
      return messages;
    }
  }
}
