// AI Agent 面板消息状态机(纯函数,零 DOM,可单测)。
//
// 服务端事件按轮序流式下发(reasoning → delta → tool → …,一轮 = 一次模型生成 +
// 工具调用),面板经 reduceAgentEvent 把每轮拆成独立 assistant 消息,视觉上呈现
// 「文本1、工具1、文本2、工具2…」交替(轮序 = 消息序)。
//
// 轮边界规则:
// - delta:最后一条 assistant 消息已有 tools → 开新消息(下一轮),否则追加;
// - tool start:同轮归并到当前消息;最后一条 assistant 消息已有 tools → 开新消息;
// - tool done/error:在「所在消息」(含对应 start 项的消息,从后往前找)内原位更新;
//   找不到 start → 挂到最后一条 assistant 消息(没有则新建);
// - action:追加到最后一条 assistant 消息的 actions(没有则新建)——最终轮文本+动作同消息;
// - done/error(事件级):透传不拆消息、不改内容(数组引用不变);
// - reasoning(2026-08-22 ws-bubble):**整体忽略**——事件到达即丢弃(no-op),不产生
//   消息、不存状态、不参与拆轮(后端照发,前端不再消费思考内容与状态)。
//
// 用户消息不进本状态机(面板 send 时原样追加);事件流中的 assistant 事件永远
// 面向新的用户消息之后的消息序列。

import type { AgentAction, AgentEvent } from "./agent/types.ts";
import { normalizeAgentImages, type AgentImage } from "./agent/result-images.ts";

export interface ToolActivity {
  name: string;
  status: "start" | "done" | "error";
  summary?: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  actions?: AgentAction[];
  /** 工具活动列表(tool 事件;⟳ 开始 / ✓ 完成 / ✗ 失败)。 */
  tools?: ToolActivity[];
  /** 搜索结果图片,渲染在最终回答气泡下方。 */
  images?: AgentImage[];
}

function lastMessage(messages: AgentMessage[]): AgentMessage | undefined {
  return messages[messages.length - 1];
}

/** 从 start(必须是 '{')开始做花括号配对,返回配对的 '}' 下标;失败 -1。
 * 与后端 run-agent.ts extractActions 同款扫描(客户端侧复刻,不 import 服务端模块)。 */
function matchJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 纯函数:从助手正文中移除 LLM 复述的动作 JSON 块({"actions": [...]})。
 * 与后端 extractActions 同款花括号配对扫描;整块连同前置换行一并移除,多块全清;
 * 配对失败(残缺)保守移除到最近可配对位置或保留原文不破坏。正文渲染前调用,
 * 动作本身仍由后端从原始文本提取执行,这里只负责 UI 面不再裸奔 JSON。
 */
export function stripActionJsonBlocks(text: string): string {
  if (!text) return text;
  const re = /\{\s*"actions"\s*:/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = matchJsonEnd(text, m.index);
    if (end === -1) break; // 残缺块:保留原文不破坏
    let cutStart = m.index;
    while (cutStart > last && (text[cutStart - 1] === '\n' || text[cutStart - 1] === '\r')) cutStart--;
    out += text.slice(last, cutStart);
    last = end + 1;
    re.lastIndex = last; // 跳过块体(避免嵌套 actions 二次匹配)
  }
  out += text.slice(last);
  return out;
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

    case "reasoning":
      // 2026-08-22 ws-bubble:思考内容与状态前端整体不消费——事件到达即丢弃(no-op),
      // 不产生消息、不存状态、不触发拆轮(后端照发不变)。
      return messages;

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

    case "images": {
      const incoming = normalizeAgentImages(ev.images);
      if (incoming.length === 0) return messages;
      const last = lastMessage(messages);
      if (last && last.role === "assistant") {
        return updateLast(messages, (m) => ({
          ...m,
          images: normalizeAgentImages([...(m.images ?? []), ...incoming]),
        }));
      }
      return appendAssistant(messages, { images: incoming });
    }

    case "done":
    case "error":
      // 透传(数组引用不变),不拆消息、不改内容。
      return messages;
  }
}
