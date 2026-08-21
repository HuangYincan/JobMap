// Agent 循环主体:LLM(OpenAI 兼容流式)↔ 白名单工具 ↔ AgentEvent 事件流。
//
// runAgent 是 AsyncGenerator,route 侧(ws-b)可直接消费为 SSE:
//   - delta / tool start 事件随 LLM 流式实时转发(内部用事件队列桥接回调→生成器)
//   - 流结束无 tool_calls → 容错提取文本内 {"actions":[...]} → 逐个校验后下发
//   - 有 tool_calls → 白名单查表、sanitize、执行、结果回流 → 下一轮
//     (assistant 消息附回本轮 reasoning_content 累计——DeepSeek 思考模式必需,否则 400)
//   - unsupported_tools → 无 tools 降级重跑一次(最多一次)
//   - 超 maxTurns → done truncated;signal.abort → 静默停止,不再发事件
//   - 公开面脱敏:tool 事件 name 收敛为公开类别(toolKind/search|geocode|…|other)、
//     summary 一律不携带;错误细节由 route 侧在 SSE 边界收敛(本模块保留内部码)

import { createLlmProvider } from './llm-provider.ts';
import type { AgentProviderError, ChatMessage, LLMProvider, StreamChatOptions } from './llm-provider.ts';
import { HttpError } from '../llm-validate.ts';
import { validateAction } from './action-schema.ts';
import { buildSystemPrompt } from './prompts.ts';
import type { AgentConfig } from './config.ts';
import type { AgentAction, AgentContext, AgentEvent, AgentTool, ToolKind, ToolResult } from './types.ts';

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
 * 清洗后的文本进 LLM 上下文(工具结果全文,内部面);公开 tool 事件不携带 summary。
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

// ---- 公开面脱敏(2026-08-21 安全要求):tool 事件 name → 公开类别,summary 不对外 ----

/** 供应商前缀(先剥掉再按关键词归类);未知前缀不剥,关键词照常匹配。 */
const TOOL_KIND_PREFIX_RE = /^(amap|tencent|baidu|rest|builtin)__/;
/** 后缀关键词 → 类别(顺序即优先级:search 先于 geocode/directions/weather/project)。 */
const TOOL_KIND_RULES: Array<[RegExp, ToolKind]> = [
  [/text_search|place|poi|suggestion|search|query/, 'search'],
  [/geo|geocode|regeo|revers/, 'geocode'],
  [/route|direction/, 'directions'],
  [/weather/, 'weather'],
  [/jobs|position|company|recruit|岗位/, 'project'],
];

/**
 * 纯函数:内部工具名 → 公开类别。先剥供应商前缀(amap__/tencent__/baidu__/rest__/builtin__),
 * 再按后缀关键词归类;未知前缀/未知后缀 → other。
 * 例:amap__maps_text_search → search、baidu__reverse_geocoding → geocode、builtin__viewport → other。
 */
export function toolKind(name: string): ToolKind {
  const bare = name.replace(TOOL_KIND_PREFIX_RE, '');
  for (const [re, kind] of TOOL_KIND_RULES) {
    if (re.test(bare)) return kind;
  }
  return 'other';
}

/**
 * 纯函数:内部工具事件 → 公开 tool 事件。name 收敛为公开类别 kind(不携带内部工具名);
 * summary 一律不携带——工具结果全文只进 LLM 历史(sanitizeToolText 后),不下发公开面。
 */
export function publicToolEvent(internal: {
  name: string;
  status: 'start' | 'done' | 'error';
  summary?: string;
}): Extract<AgentEvent, { type: 'tool' }> {
  return { type: 'tool', name: toolKind(internal.name), status: internal.status };
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
      let turnReasoning: string;
      try {
        ({ text, calls, reasoning: turnReasoning } = yield* streamRound(llmTools));
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

      // 执行工具,结果回流(入 history 前一律经 sanitizeToolText 净化:截断 3000、剔除
      // script/超长 URL——否则一条 MCP 结果瞬间打爆 maxHistoryChars 预算,见 tech/24 §6.2)
      const toolMessages: ChatMessage[] = [];
      for (const call of calls) {
        if (req.signal.aborted) return;
        const result = await runTool(call);
        const summary = sanitizeToolText(result.ok ? result.text : result.error);
        // 公开 tool 事件:name 收敛为类别,summary 不携带(结果全文只进 toolMessages 回流 LLM)
        yield result.ok
          ? publicToolEvent({ name: call.name, status: 'done', summary })
          : publicToolEvent({ name: call.name, status: 'error', summary });
        toolMessages.push({ role: 'tool', tool_call_id: call.id, content: summary });
      }
      if (req.signal.aborted) return;
      history.push({
        role: 'assistant',
        content: text,
        tool_calls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
        // DeepSeek 思考模式要求 tool_calls 消息回传该轮 reasoning_content,否则下一轮 400。
        // 仅非空时附加(非推理模型不污染请求);若某 provider 空 reasoning + tool_calls 仍 400,
        // 改为总是附加(空串):turnReasoning || ''。
        ...(turnReasoning ? { reasoning_content: turnReasoning } : {}),
      });
      history.push(...toolMessages);
      trimHistory();
    }
    yield { type: 'done', truncated: true };
  }

  /** 一轮 LLM 流式往返:转发 delta / tool start 事件,返回完整文本、工具调用与本轮 reasoning 累计。 */
  async function* streamRound(
    llmTools: StreamChatOptions['tools'],
  ): AsyncGenerator<AgentEvent, { text: string; calls: PendingToolCall[]; reasoning: string }> {
    const queue = new EventQueue<AgentEvent>();
    let text = '';
    let turnReasoning = ''; // 本轮 reasoning_content 累计(provider 轮末 onTurnReasoning 回传全文)
    const callsById = new Map<string, PendingToolCall>();
    const order: string[] = [];

    let resolveRound: (v: { text: string; calls: PendingToolCall[]; reasoning: string }) => void = () => {};
    const round = new Promise<{ text: string; calls: PendingToolCall[]; reasoning: string }>((res) => {
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
          // (仅限转发给前端的 reasoning 事件;回传用全文由 onTurnReasoning 提供,不受此上限)
          const remaining = REASONING_MAX - reasoningSent;
          if (remaining <= 0) return;
          const slice = r.slice(0, remaining);
          if (slice.length > 0) {
            reasoningSent += slice.length;
            queue.push({ type: 'reasoning', text: slice });
          }
        },
        onTurnReasoning: (r) => {
          // 轮末回传:本轮 reasoning_content 累计全文(供 tool_calls 消息回传,不截断)
          turnReasoning = r;
        },
        onToolCall: (tc) => {
          if (!callsById.has(tc.id)) {
            callsById.set(tc.id, { id: tc.id, name: tc.name, arguments: tc.arguments });
            order.push(tc.id);
            queue.push(publicToolEvent({ name: tc.name, status: 'start' }));
          } else {
            // 参数增量:保留最新累计
            callsById.set(tc.id, { id: tc.id, name: tc.name || callsById.get(tc.id)!.name, arguments: tc.arguments });
          }
        },
        onDone: () => {
          queue.close();
          resolveRound({ text, calls: order.map((id) => callsById.get(id)!), reasoning: turnReasoning });
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

  /**
   * 每轮后按 maxHistoryChars 裁剪历史:以「轮」为单位从最前删除——每轮 = 一个 user 消息 +
   * 其后的 assistant(可能带 tool_calls)+ 该 assistant 之后连续的 tool 消息组;system 永不删。
   * 最近一轮(本轮刚追加的 assistant(tool_calls)+ 其 tool 结果组)永远保留,保证
   * tool_calls↔tool 配对不破(逐条删 user/assistant 会留下孤儿 tool 消息 → DeepSeek 400
   * "role 'tool' must be a response to 'tool_calls'")。预算计算沿用 maxHistoryChars
   * (content.length 求和)。
   */
  function trimHistory(): void {
    const limit = req.config.maxHistoryChars;
    if (limit <= 0) return;
    // 最近一轮起点:从尾部 tool 消息回退到其 assistant(tool_calls);该起点之后永不删
    let keepFrom = history.length - 1;
    while (keepFrom > 1 && history[keepFrom].role === 'tool') keepFrom--;
    const total = () => history.reduce((sum, m) => sum + m.content.length, 0);
    while (total() > limit && keepFrom > 1) {
      const end = frontDeletableEnd(keepFrom);
      if (end <= 1) break;
      history.splice(1, end - 1); // 删除 [1, end):system 之后的整轮
      keepFrom -= end - 1;
    }
  }

  /** 从最前找可整轮删除的区间终点(区间 [1, end),不越过最近一轮起点 keepFrom);无可删 → 1。
   * 轮 = user + 其后的 assistant(可能带 tool_calls)+ assistant 之后连续的 tool 消息组;
   * 轮不完整时(历史被外部截断/轮起点缺失)保守处理:删除该轮全部可识别部分。 */
  function frontDeletableEnd(keepFrom: number): number {
    if (keepFrom <= 1) return 1;
    const first = history[1];
    if (!first) return 1;
    if (first.role === 'user') {
      // 该 user 之后的第一个 assistant(或下一个 user 标记新轮起点)
      let i = 2;
      let asstIdx = -1;
      for (; i < history.length && i < keepFrom; i++) {
        if (history[i].role === 'assistant') {
          asstIdx = i;
          break;
        }
        if (history[i].role === 'user') break; // 无 assistant 的不完整轮
      }
      if (asstIdx === -1) return i; // 不完整轮:只删到可识别部分(该 user)
      const asst = history[asstIdx];
      let end = asstIdx + 1;
      if (asst.tool_calls && asst.tool_calls.length > 0) {
        // assistant 之后连续的 tool 消息组(整组随轮删除,不拆散配对)
        while (end < history.length && end < keepFrom && history[end].role === 'tool') end++;
      }
      return end;
    }
    if (first.role === 'assistant' || first.role === 'tool') {
      // 轮起点缺失(孤立 assistant/tool,如外部截断):删除该段全部可识别部分(含其后连续 tool)
      let end = 2;
      while (end < history.length && end < keepFrom && history[end].role === 'tool') end++;
      return end;
    }
    return 1;
  }
}
