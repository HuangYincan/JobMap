// OpenAI 兼容流式 chat-completions 客户端(agent 引擎用)。
//
// 复用 llm-validate.ts 的 HttpError / isRetryableStatus 语义(只 import 这两个,
// 不 import 其函数)。SSE 解析按 `data: ` 行,兼容 choices[0].delta.content
// 与 delta.tool_calls 两种 chunk;工具参数跨 chunk 增量拼接;推理模型思考内容
// (delta.reasoning_content)经 onReasoning 回调转发(可选,缺省不回调)。
//
// 超时与重试(参数可注入以便测试,默认值即 spec):
//   - 30s 首包超时(每次尝试:收到首个 chunk 后取消定时器)
//   - 120s 整体上限(整个 streamChat 调用)
//   - 首包前 408/429/5xx/网络错:2 次重试,指数退避 500ms → 1s
//   - 400/422 且响应体涉及 tools → kind 'unsupported_tools'(供降级重跑)
//   - 调用方 signal.abort → kind 'aborted';超时 → kind 'timeout'
// 错误一律原样抛出(HttpError / AbortError / AgentProviderError / 网络 Error),
// 由调用方(run-agent)分类;重试判定只认 HttpError 状态与网络错。

import { HttpError, isRetryableStatus } from '../llm-validate.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_call_id?: string;
}

export type AgentProviderErrorKind = 'unsupported_tools' | 'http' | 'network' | 'timeout' | 'aborted';

export interface AgentProviderError extends Error {
  kind: AgentProviderErrorKind;
}

export function providerError(kind: AgentProviderErrorKind, message: string): AgentProviderError {
  const err = new Error(message) as AgentProviderError;
  err.name = 'AgentProviderError';
  err.kind = kind;
  return err;
}

export interface StreamChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>;
  signal: AbortSignal;
  onDelta(text: string): void;
  /** 推理模型思考内容(delta.reasoning_content,如 DeepSeek);非推理模型缺省不回调。 */
  onReasoning?(text: string): void;
  onToolCall(tc: { id: string; name: string; arguments: string }): void;
  onDone(): void;
}

export interface LLMProvider {
  streamChat(opts: StreamChatOptions): Promise<void>;
}

/** 可注入的超时/重试参数(默认即 spec;测试注入小值避免真实等待)。 */
export interface LlmProviderOptions {
  firstPacketTimeoutMs?: number;
  overallTimeoutMs?: number;
  retryDelaysMs?: number[];
}

const DEFAULT_FIRST_PACKET_MS = 30_000;
const DEFAULT_OVERALL_MS = 120_000;
const DEFAULT_RETRY_DELAYS = [500, 1000];

/**
 * 纯函数:解析一条 SSE 行。`data: <payload>` → payload 字符串(含 [DONE]);
 * 注释行 / 事件行 / 空行 → null。
 */
export function parseSseLine(line: string): string | null {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (!trimmed.startsWith('data:')) return null;
  return trimmed.slice('data:'.length).trim();
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export function createLlmProvider(fetchLike?: typeof fetch, options?: LlmProviderOptions): LLMProvider {
  const doFetch = fetchLike ?? fetch;
  const firstPacketMs = options?.firstPacketTimeoutMs ?? DEFAULT_FIRST_PACKET_MS;
  const overallMs = options?.overallTimeoutMs ?? DEFAULT_OVERALL_MS;
  const retryDelays = options?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;

  return {
    async streamChat(opts: StreamChatOptions): Promise<void> {
      if (opts.signal.aborted) throw providerError('aborted', 'request aborted before start');

      const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const body = JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
        stream: true,
      });

      // 整体上限:任一尝试超出即中止
      const overallAbort = new AbortController();
      const overallTimer = setTimeout(() => overallAbort.abort(), overallMs);
      const onCallerAbort = () => overallAbort.abort();
      opts.signal.addEventListener('abort', onCallerAbort);

      try {
        for (let attempt = 0; ; attempt++) {
          try {
            await runAttempt();
            return;
          } catch (err) {
            if (isRetryableProviderError(err)) {
              const delay = retryDelays[attempt];
              if (delay === undefined) throw classifyNonRetryable(err); // 重试耗尽:归类为终态错误
              await sleep(delay, opts.signal);
              continue;
            }
            throw classifyNonRetryable(err);
          }
        }
      } finally {
        clearTimeout(overallTimer);
        opts.signal.removeEventListener('abort', onCallerAbort);
      }

      async function runAttempt(): Promise<void> {
        const attemptAbort = new AbortController();
        const onOverallAbort = () => attemptAbort.abort();
        overallAbort.signal.addEventListener('abort', onOverallAbort);
        const onCallerAbort2 = () => attemptAbort.abort();
        opts.signal.addEventListener('abort', onCallerAbort2);
        const firstPacketTimer = setTimeout(() => attemptAbort.abort(), firstPacketMs);

        const clearAttempt = () => {
          clearTimeout(firstPacketTimer);
          overallAbort.signal.removeEventListener('abort', onOverallAbort);
          opts.signal.removeEventListener('abort', onCallerAbort2);
        };

        let res: Response;
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${opts.apiKey}`,
            },
            body,
            signal: attemptAbort.signal,
          });
        } catch (err) {
          clearAttempt();
          throw err; // 网络错 / AbortError(超时或调用方 abort),原样抛出
        }

        if (!res.ok) {
          clearAttempt();
          if (res.status === 400 || res.status === 422) {
            let bodyText = '';
            try {
              bodyText = await res.text();
            } catch {
              /* 读 body 失败不改变判定 */
            }
            if (/tool/i.test(bodyText)) {
              throw providerError('unsupported_tools', `provider 不支持 tools 参数(HTTP ${res.status})`);
            }
          }
          throw new HttpError(res.status, `chat completions HTTP ${res.status}`);
        }

        try {
          await consumeStream(res, firstPacketTimer);
          clearAttempt();
          opts.onDone();
        } catch (err) {
          clearAttempt();
          throw err;
        }
      }

      async function consumeStream(res: Response, firstPacketTimer: ReturnType<typeof setTimeout>): Promise<void> {
        if (!res.body) throw new Error('no response body');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sawFirstPacket = false;
        const calls = new Map<number, ToolCallAccumulator>();
        let streamDone = false;

        while (!streamDone) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!sawFirstPacket) {
            sawFirstPacket = true;
            clearTimeout(firstPacketTimer);
          }
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (handleLine(line)) {
              streamDone = true;
              break;
            }
          }
        }
        // 收尾:可能没有尾随换行的最后一行
        if (buffer.trim().length > 0) handleLine(buffer);

        /** 处理一行 SSE;返回 true 表示遇到 [DONE] 终止流。 */
        function handleLine(line: string): boolean {
          const payload = parseSseLine(line);
          if (payload === null || payload === '') return false;
          if (payload === '[DONE]') return true;
          applyPayload(payload);
          return false;
        }

        function applyPayload(payload: string): void {
          let data: unknown;
          try {
            data = JSON.parse(payload);
          } catch {
            return; // 无法解析的数据行(keep-alive 等)直接忽略
          }
          const delta = (data as { choices?: Array<{ delta?: unknown }> })?.choices?.[0]?.delta;
          if (!delta || typeof delta !== 'object') return;
          const d = delta as Record<string, unknown>;
          if (typeof d.content === 'string' && d.content.length > 0) opts.onDelta(d.content);
          // 推理内容(reasoning_content)与 content/tool_calls 并列;顺序 = chunk 内字段顺序
          if (typeof d.reasoning_content === 'string' && d.reasoning_content.length > 0) {
            opts.onReasoning?.(d.reasoning_content);
          }
          const toolCalls = d.tool_calls;
          if (!Array.isArray(toolCalls)) return;
          for (const tc of toolCalls) {
            if (!tc || typeof tc !== 'object') continue;
            const t = tc as Record<string, unknown>;
            const index = typeof t.index === 'number' ? t.index : calls.size;
            let acc = calls.get(index) ?? { id: '', name: '', arguments: '' };
            if (typeof t.id === 'string' && t.id) acc.id = t.id;
            const fn = t.function as Record<string, unknown> | undefined;
            if (fn && typeof fn === 'object') {
              if (typeof fn.name === 'string' && fn.name) acc.name = fn.name;
              if (typeof fn.arguments === 'string') acc.arguments += fn.arguments;
            }
            calls.set(index, acc);
            if (acc.id) opts.onToolCall({ id: acc.id, name: acc.name, arguments: acc.arguments });
          }
        }
      }

      /** 只重试:408/429/5xx 与网络错。超时/abort/已分类错误不重试。 */
      function isRetryableProviderError(err: unknown): boolean {
        if (err instanceof HttpError) return isRetryableStatus(err.status);
        if (err instanceof Error) {
          if (err.name === 'AbortError') return false;
          if ((err as AgentProviderError).kind !== undefined) return false;
          return true; // 网络错
        }
        return false;
      }

      /** 终态错误分类:HttpError 原样(带 status);AbortError → timeout/aborted;网络错 → network。 */
      function classifyNonRetryable(err: unknown): unknown {
        if (err instanceof HttpError) return err;
        if (err instanceof Error && err.name === 'AbortError') {
          return opts.signal.aborted
            ? providerError('aborted', 'request aborted by caller')
            : providerError('timeout', 'LLM 响应超时');
        }
        if ((err as AgentProviderError).kind !== undefined) return err;
        return providerError('network', String(err instanceof Error ? err.message : err));
      }
    },
  };
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
}
