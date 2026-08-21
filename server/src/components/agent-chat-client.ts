// SSE 客户端(纯逻辑,可单测)。
//
// POST /api/agent/chat → response.body.getReader() → 按 \n\n 切块 →
// data: 行 JSON.parse(容错:跳过非 JSON/空行)→ yield AgentEvent。
// signal.abort() 即 abort fetch(停止链路,见 tech/24 §7.3)。
// 事件可能跨 chunk 切分:消费端缓冲残余,只有以 \n\n 结束的完整块才解析。
// AgentEvent/AgentAction 类型从 lib/agent/types import(同构,前端可 import lib 类型)。

import type { AgentEvent } from "../lib/agent/types.ts";

export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatViewport {
  center: { lng: number; lat: number };
  zoom: number;
  bounds?: { minLng: number; minLat: number; maxLng: number; maxLat: number };
}

export interface AgentChatRequest {
  messages: AgentChatMessage[];
  viewport?: AgentChatViewport;
  lang?: "zh" | "en";
}

/**
 * 解析 SSE 文本中的完整事件块(以 \n\n 分隔):
 * - 每块取 `data:` 行(SSE 规范,多 data 行按 \n 拼接),其余行忽略;
 * - JSON.parse 失败(坏 JSON / [DONE] 哨兵 / 跨 chunk 的残缺尾部)→ 跳过,不抛错。
 */
export function parseSseChunk(chunk: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const block of chunk.split("\n\n")) {
    if (!block.trim()) continue;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(dataLines.join("\n"));
      if (parsed && typeof parsed === "object" && typeof (parsed as { type?: unknown }).type === "string") {
        events.push(parsed as AgentEvent);
      }
    } catch {
      // 坏 JSON / [DONE] 哨兵 / 残缺尾部:跳过
    }
  }
  return events;
}

/** 流式消费 POST /api/agent/chat 的 SSE 事件流;abort → 静默结束。 */
export async function* streamAgentChat(
  req: AgentChatRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  let response: Response;
  try {
    response = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return; // 用户停止:静默结束
    throw err;
  }

  // 非 2xx(400/429/503 等):body 为 JSON {code, message} → 统一转 error 事件
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let message = "";
    try {
      const body = (await response.json()) as { code?: unknown; message?: unknown };
      if (typeof body.code === "string") code = body.code;
      if (typeof body.message === "string") message = body.message;
    } catch {
      // 非 JSON 错误体:用状态码兜底
    }
    yield { type: "error", code, message };
    return;
  }

  if (!response.body) {
    yield { type: "error", code: "NO_STREAM", message: "SSE response has no body" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 只消费以 \n\n 结束的完整块;残余留在 buffer(事件可能跨 chunk 切分)
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep + 2);
        buffer = buffer.slice(sep + 2);
        for (const ev of parseSseChunk(block)) yield ev;
      }
    }
    // 流结束:尾部残余(无 \n\n 结尾)容错再解析一次(部分实现最后一块没有空行)
    for (const ev of parseSseChunk(buffer)) yield ev;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return; // signal.abort → 静默结束
    throw err;
  }
}
