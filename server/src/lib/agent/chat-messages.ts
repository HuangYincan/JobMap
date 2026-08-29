// Agent 对话请求消息整形:会话本地可存 30 条,发送时可能再追加 1 条。
// 必须裁到 cap、补齐 content、丢掉前导 assistant,否则 POST /api/agent/chat 会 400。

/** 与 `SESSION_MESSAGES_CAP` 对齐;契约测试断言二者相等。 */
export const AGENT_CHAT_MAX_MESSAGES = 30;
/** 与 `MESSAGE_CONTENT_MAX` 对齐。 */
export const AGENT_CHAT_MAX_CHARS = 4000;

export interface AgentChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * 把任意历史整理成可 POST 的 messages:
 * - 只保留 user|assistant;
 * - 缺 content / 非字符串 → "";
 * - 丢掉前导非 user(接口要求首条 user);
 * - 超出 cap 从最旧裁,裁完若首条仍非 user 则继续前移。
 */
export function toAgentChatMessages(
  messages: unknown,
  cap = AGENT_CHAT_MAX_MESSAGES,
): AgentChatTurn[] {
  if (!Array.isArray(messages) || cap < 1) return [];
  const out: AgentChatTurn[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as { role?: unknown; content?: unknown };
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : "";
    out.push({ role: m.role, content: content.slice(0, AGENT_CHAT_MAX_CHARS) });
  }
  while (out.length > 0 && out[0].role !== "user") out.shift();
  if (out.length <= cap) return out;
  let start = out.length - cap;
  while (start < out.length && out[start].role !== "user") start += 1;
  return start < out.length ? out.slice(start) : [];
}
