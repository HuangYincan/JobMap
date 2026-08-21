// Agent 循环主体:LLM(OpenAI 兼容流式)↔ 白名单工具 ↔ AgentEvent 事件流。
//
// runAgent 是 AsyncGenerator,route 侧(ws-b)可直接消费为 SSE:
//   - delta / tool start 事件随 LLM 流式实时转发(内部用事件队列桥接回调→生成器)
//   - 流结束无 tool_calls → 容错提取文本内 {"actions":[...]} → 逐个校验后下发
//   - 有 tool_calls → 白名单查表、sanitize、执行、结果回流 → 下一轮
//   - unsupported_tools → 无 tools 降级重跑一次(最多一次)
//   - 超 maxTurns → done truncated;signal.abort → 静默停止,不再发事件

import { createLlmProvider } from './llm-provider.ts';
import type { AgentProviderError, ChatMessage, LLMProvider, StreamChatOptions } from './llm-provider.ts';
import { HttpError } from '../llm-validate.ts';
import { validateAction } from './action-schema.ts';
import { buildSystemPrompt } from './prompts.ts';
import type { AgentConfig } from './config.ts';
import type { AgentAction, AgentContext, AgentEvent, AgentTool, ToolResult } from './types.ts';

export interface RunAgentRequest {
  config: AgentConfig;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 白名单工具,由 route 侧按 key 配置构建(ws-b)。 */
  tools: AgentTool[];
  viewport?: AgentContext['viewport'];
  lang?: 'zh' | 'en';
  signal: AbortSignal;
  /** 测试注入点:默认 createLlmProvider()。 */
  provider?: LLMProvider;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

const TOOL_DESC_MAX = 500;
const TOOL_TEXT_MAX = 3000;
const URL_MAX_LEN = 150;
/** 思考内容(reasoning 事件)总量上限:超出截断且不再转发(与 delta 顺序保持)。 */
const REASONING_MAX = 4000;

/** 事件队列:把 provider 的回调事件桥接为 async iterable,供生成器实时 yield。 */
class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;

  push(e: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: e, done: false });
    else this.items.push(e);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as T, done: true });
  }

  fail(err: unknown): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ error: err } as unknown as IteratorResult<T>);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise((resolve, reject) => {
          this.waiters.push((v) => {
            if (v && (v as unknown as { error?: unknown }).error !== undefined) reject((v as unknown as { error: unknown }).error);
            else resolve(v);
          });
        });
      },
    };
  }
}

/**
 * 纯函数:从 LLM 文本中容错提取 {"actions": [...]} JSON(花括号配对扫描,
 * 容忍围栏/前后缀文字),逐项 validateAction,非法项丢弃。
 */
export function extractActions(text: string): AgentAction[] {
  if (!text) return [];
  const out: AgentAction[] = [];
  const re = /\{\s*"actions"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = matchJsonEnd(text, m.index);
    if (end === -1) break;
    re.lastIndex = end + 1;
    try {
      const parsed: unknown = JSON.parse(text.slice(m.index, end + 1));
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { actions?: unknown }).actions)) {
        for (const raw of (parsed as { actions: unknown[] }).actions) {
          const action = validateAction(raw);
          if (action) out.push(action);
        }
      }
    } catch {
      /* 片段损坏:跳过该段 */
    }
  }
  return out;
}

/** 从 start(必须是 '{')开始做花括号配对,返回配对的 '}' 下标;失败 -1。 */
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
 * 纯函数:工具结果文本清洗。剔除 <script 及其内容、超长 URL 串,再截断。
 * 清洗后的文本才会进 LLM 上下文与 tool 事件。
 */
export function sanitizeToolText(text: string, maxLen: number = TOOL_TEXT_MAX): string {
  let out = String(text ?? '');
  // 剔除 script 标签(含内容)
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<script/gi, '');
  // 超长 URL 串 → [url]
  out = out.replace(/https?:\/\/\S+/gi, (u) => (u.length > URL_MAX_LEN ? '[url]' : u));
  if (out.length > maxLen) return out.slice(0, maxLen);
  return out;
}

/** 错误消息清洗:不含 secret(防 Bearer/sk- 泄漏),截断长度。 */
function sanitizeErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  return raw
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .slice(0, 300);
}

export async function* runAgent(req: RunAgentRequest): AsyncGenerator<AgentEvent> {
  const provider = req.provider ?? createLlmProvider();
  const lang = req.lang ?? 'zh';
  const toolMap = new Map(req.tools.map((t) => [t.name, t]));
  const systemPrompt = buildSystemPrompt({ maxTurns: req.config.maxTurns, hasTools: req.tools.length > 0 }, lang);
  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const ctx: AgentContext = {
    viewport: req.viewport,
    lang,
    requestId: globalThis.crypto?.randomUUID?.() ?? String(Math.random()),
    signal: req.signal,
  };

  let noTools = false; // unsupported_tools 降级标志(最多一次)
  let reasoningSent = 0; // 思考内容累计转发量(总量上限 REASONING_MAX,超限截断;streamRound 共用)
  try {
    yield* runConversation();
  } catch (err) {
    if (req.signal.aborted) return; // 调用方取消:静默停止,不再发事件
    const providerErr = err as AgentProviderError;
    if (providerErr.kind === 'aborted') return;
    let code: string;
    if (err instanceof HttpError) code = `http_${err.status}`;
    else if (providerErr.kind === 'timeout') code = 'timeout';
    else if (providerErr.kind === 'network') code = 'llm_network_error';
    else if (providerErr.kind === 'unsupported_tools') code = 'unsupported_tools';
    else if (err instanceof Error && err.name === 'AbortError') code = 'timeout'; // 防御:非调用方 abort
    else code = 'llm_error';
    yield { type: 'error', code, message: sanitizeErrorMessage(err, 'agent 内部错误') };
    return;
  }

  async function* runConversation(): AsyncGenerator<AgentEvent, void> {
    let turns = 0;
    for (; turns < req.config.maxTurns; turns++) {
      const llmTools: StreamChatOptions['tools'] =
        noTools || req.tools.length === 0
          ? undefined
          : req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description.slice(0, TOOL_DESC_MAX), parameters: t.inputSchema },
            }));

      let text: string;
      let calls: PendingToolCall[];
      try {
        ({ text, calls } = yield* streamRound(llmTools));
      } catch (err) {
        const providerErr = err as AgentProviderError;
        if (providerErr.kind === 'unsupported_tools' && !noTools) {
          noTools = true; // 无 tools 降级重跑当前轮(不消耗轮数)
          turns--;
          continue;
        }
        throw err;
      }

      if (calls.length === 0) {
        // 无工具调用:提取动作 JSON 逐个下发,然后 done
        for (const action of extractActions(text)) yield { type: 'action', action };
        yield { type: 'done' };
        return;
      }

      // 末轮仍要工具 → 截断
      if (turns === req.config.maxTurns - 1) {
        yield { type: 'done', truncated: true };
        return;
      }

      // 执行工具,结果回流
      const toolMessages: ChatMessage[] = [];
      for (const call of calls) {
        if (req.signal.aborted) return;
        const result = await runTool(call);
        const summary = result.ok ? result.text : result.error;
        yield result.ok
          ? { type: 'tool', name: call.name, status: 'done', summary }
          : { type: 'tool', name: call.name, status: 'error', summary };
        toolMessages.push({ role: 'tool', tool_call_id: call.id, content: summary });
      }
      if (req.signal.aborted) return;
      history.push({
        role: 'assistant',
        content: text,
        tool_calls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
      });
      history.push(...toolMessages);
      trimHistory(history.length - toolMessages.length);
    }
    yield { type: 'done', truncated: true };
  }

  /** 一轮 LLM 流式往返:转发 delta / tool start 事件,返回完整文本与工具调用。 */
  async function* streamRound(llmTools: StreamChatOptions['tools']): AsyncGenerator<AgentEvent, { text: string; calls: PendingToolCall[] }> {
    const queue = new EventQueue<AgentEvent>();
    let text = '';
    const callsById = new Map<string, PendingToolCall>();
    const order: string[] = [];

    let resolveRound: (v: { text: string; calls: PendingToolCall[] }) => void = () => {};
    const round = new Promise<{ text: string; calls: PendingToolCall[] }>((res) => {
      resolveRound = res;
    });

    const streamPromise = provider
      .streamChat({
        baseUrl: req.config.baseUrl,
        apiKey: req.config.apiKey,
        model: req.config.model,
        messages: history,
        tools: llmTools,
        signal: req.signal,
        onDelta: (d) => {
          text += d;
          queue.push({ type: 'delta', text: d });
        },
        onReasoning: (r) => {
          // 总量上限:剩余额度为 0 → 不再转发;不足整段 → 截断只转剩余额度
          const remaining = REASONING_MAX - reasoningSent;
          if (remaining <= 0) return;
          const slice = r.slice(0, remaining);
          if (slice.length > 0) {
            reasoningSent += slice.length;
            queue.push({ type: 'reasoning', text: slice });
          }
        },
        onToolCall: (tc) => {
          if (!callsById.has(tc.id)) {
            callsById.set(tc.id, { id: tc.id, name: tc.name, arguments: tc.arguments });
            order.push(tc.id);
            queue.push({ type: 'tool', name: tc.name, status: 'start' });
          } else {
            // 参数增量:保留最新累计
            callsById.set(tc.id, { id: tc.id, name: tc.name || callsById.get(tc.id)!.name, arguments: tc.arguments });
          }
        },
        onDone: () => {
          queue.close();
          resolveRound({ text, calls: order.map((id) => callsById.get(id)!) });
        },
      });
    streamPromise.catch((err: unknown) => {
      queue.fail(err);
    });

    try {
      for await (const e of queue) yield e;
    } catch (err) {
      await streamPromise.catch(() => {}); // 确保拒绝已被消费
      throw err;
    }
    return await round;
  }

  /** 查白名单 + 解析参数 + 调用工具;任何失败 → {ok:false, error}。 */
  async function runTool(call: PendingToolCall): Promise<ToolResult> {
    const tool = toolMap.get(call.name);
    if (!tool) return { ok: false, error: 'tool not in whitelist' };
    let args: Record<string, unknown>;
    try {
      const raw = call.arguments.trim() || '{}';
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('args must be object');
      args = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'invalid tool arguments JSON' };
    }
    try {
      return await tool.call(args, ctx);
    } catch (err) {
      return { ok: false, error: `tool error: ${String(err instanceof Error ? err.message : err)}` };
    }
  }

  /** 每轮后按 maxHistoryChars 裁剪历史:从最旧 user 起删,保留 system 与最近一轮。 */
  function trimHistory(keepFromIndex: number): void {
    const limit = req.config.maxHistoryChars;
    if (limit <= 0) return;
    const total = () => history.reduce((sum, m) => sum + m.content.length, 0);
    while (total() > limit && keepFromIndex > 1) {
      const idx = history.slice(0, keepFromIndex).findIndex((m) => m.role !== 'system');
      if (idx === -1) break;
      history.splice(idx, 1);
      keepFromIndex--;
    }
  }
}
