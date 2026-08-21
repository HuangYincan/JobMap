// 手写零依赖 MCP 客户端(核心,tech/24 §5)。
//
// 会话权限 deny `npm install*`,不引 @modelcontextprotocol/sdk;协议是公开标准:
//   - legacy SSE transport(2024-11-05):GET 事件流 + POST JSON-RPC,按 id 关联
//   - Streamable HTTP transport(2025-06-18):单 POST 端点,JSON 或 SSE 响应
// 全部 fetch 可注入(fetchImpl),纯逻辑可单测。进程级保活:请求结束不 dispose;
// 连接失败 dispose 置空,下次请求重建重试。错误信息只含 host 与 status,绝不含 key。
//
// 注意:模块级单例 map + connect promise 缓存;测试用 resetMcpProvidersForTest()
// 清空后重造(getMcpProvider 的 opts 只在创建新实例时生效)。

import { MCP_ENDPOINTS } from './mcp-endpoints.ts';
import type { McpEndpoint } from './mcp-endpoints.ts';

export type ProviderId = 'amap' | 'tencent' | 'baidu';

/** MCP 工具元信息(listTools 返回,已净化成可注入 LLM 的形状)。 */
export interface McpToolMeta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpProviderHandle {
  id: ProviderId;
  /** 连接 + tools/list 成功后才为 true;失败置 false(dispose 后下次请求重建重试)。 */
  isReady(): boolean;
  /** 工具列表缓存;失败 → 置 not ready 并 throw(调用方跳过该 provider,不致命)。 */
  listTools(): Promise<McpToolMeta[]>;
  /** 调用工具(原工具名,非 LLM 名称);任何错误转成 {isError:true, text},text 不含 key。 */
  callTool(origName: string, args: unknown, signal?: AbortSignal): Promise<{ text: string; isError: boolean }>;
}

/** fetch 的窄接口(只依赖 ok/status/headers/body,便于 mock)。 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<FetchResponseLike>;

export interface ProviderOptions {
  /** 测试注入点:默认全局 fetch。 */
  fetchImpl?: FetchLike;
  timeouts?: { connectMs?: number; callMs?: number };
}

// ---------------------------------------------------------------------------
// 常量与错误
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 3;
const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'domain-map-agent', version: '1.0.0' };
/** 初始化失败换备选 transport 重试的状态码(tech/24 §5.1)。 */
const RETRY_STATUSES = new Set([404, 405, 400]);

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

/** 连接级失败(含 host 与 status;status null = 网络错误)。绝不包含 key。 */
class ConnectFailure extends Error {
  readonly status: number | null;
  constructor(providerId: ProviderId, host: string, status: number | null) {
    super(`mcp(${providerId}) connect failed: ${host}${status === null ? '' : ` status ${status}`}`);
    this.status = status;
  }
}

class McpTimeoutError extends Error {
  constructor(providerId: ProviderId, host: string, ms: number) {
    super(`mcp(${providerId}) timeout after ${ms}ms (${host})`);
  }
}

/** 事件流意外关闭(连接层问题 → 触发重建)。 */
class McpStreamClosedError extends Error {
  constructor(providerId: ProviderId, host: string) {
    super(`mcp(${providerId}) stream closed (${host})`);
  }
}

/** JSON-RPC error 响应;message 截断防任意内容回显。 */
class McpRpcError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(String(message ?? 'mcp rpc error').slice(0, 200));
    this.code = code;
  }
}

/** 外部 abort(用户停止)归一的错误,formatMcpError 按 name 识别。 */
class McpAbortError extends Error {
  constructor() {
    super('mcp request aborted');
    this.name = 'AbortError';
  }
}

// ---------------------------------------------------------------------------
// 纯函数:工具名归一化(tech/24 §5.3)
// ---------------------------------------------------------------------------

/**
 * `name = <provider>__<slug(原工具名)>`;slug:非 [a-z0-9_] 字符转 `_`(先小写),
 * 截断 60;description 截 500(缺失时用原 name 转述);inputSchema 缺失/非对象 →
 * `{type:'object', properties:{}}` 兜底。
 */
export function normalizeTool(
  provider: ProviderId,
  meta: { name: string; description?: string; inputSchema?: unknown },
): { name: string; description: string; inputSchema: Record<string, unknown> } {
  const rawName = typeof meta.name === 'string' ? meta.name : '';
  let slug = rawName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!slug) slug = 'unnamed';
  if (slug.length > 60) slug = slug.slice(0, 60);
  const name = `${provider}__${slug}`;
  const description = (
    typeof meta.description === 'string' && meta.description.trim().length > 0 ? meta.description : rawName || name
  ).slice(0, 500);
  const schema =
    meta.inputSchema && typeof meta.inputSchema === 'object' && !Array.isArray(meta.inputSchema)
      ? meta.inputSchema
      : { type: 'object', properties: {} };
  return { name, description, inputSchema: schema as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// 基础工具:信号量 / SSE 解析 / 超时包装
// ---------------------------------------------------------------------------

/** 每 provider 3 并发信号量。 */
class Semaphore {
  private readonly limit: number;
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(limit: number) {
    this.limit = limit;
  }

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}

interface SseEvent {
  event: string;
  data: string;
}

/** SSE 行解析:按空行分帧,data 多行以 '\n' 连接;支持 CRLF 与注释行。 */
class SseParser {
  private buffer = '';
  private currentEvent: string | null = null;
  private currentData: string[] | null = null;

  push(text: string): SseEvent[] {
    this.buffer += text;
    const out: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (clean === '') {
        if (this.currentData !== null) out.push({ event: this.currentEvent ?? 'message', data: this.currentData.join('\n') });
        this.currentEvent = null;
        this.currentData = null;
        continue;
      }
      if (clean.startsWith(':')) continue; // 注释
      const colon = clean.indexOf(':');
      const field = colon === -1 ? clean : clean.slice(0, colon);
      const value = colon === -1 ? '' : clean.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') this.currentEvent = value;
      else if (field === 'data') {
        if (this.currentData === null) this.currentData = [];
        this.currentData.push(value);
      }
    }
    return out;
  }
}

/** 把 fetch 调用包上超时 + 外部信号;超时 → makeTimeoutError()。 */
function withTimeout<T>(
  timeoutMs: number,
  external: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
  makeTimeoutError: () => Error,
): Promise<T> {
  if (external?.aborted) return Promise.reject(new McpAbortError());
  const ctrl = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => ctrl.abort(), timeoutMs);
  const sig = external ? AbortSignal.any([ctrl.signal, external]) : ctrl.signal;
  return fn(sig)
    .finally(() => clearTimeout(timer))
    .catch((err: unknown) => {
      if (ctrl.signal.aborted) throw makeTimeoutError();
      throw err;
    });
}

async function readAll(res: FetchResponseLike): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

interface RpcResponse {
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function rpcResult(msg: RpcResponse, id: number): unknown {
  if (msg.error) throw new McpRpcError(String(msg.error.message ?? 'mcp rpc error'), msg.error.code ?? -1);
  return msg.result;
}

function parseRpcBody(text: string, id: number): unknown {
  let msg: RpcResponse;
  try {
    msg = JSON.parse(text) as RpcResponse;
  } catch {
    throw new McpRpcError('invalid json-rpc response', -32700);
  }
  return rpcResult(msg, id);
}

// ---------------------------------------------------------------------------
// Transport:legacy SSE(2024-11-05)与 Streamable HTTP(2025-06-18)
// ---------------------------------------------------------------------------

interface TransportContext {
  timeoutMs: number;
  signal?: AbortSignal;
}

interface Transport {
  request(method: string, params: unknown, id: number, ctx: TransportContext): Promise<unknown>;
  /** JSON-RPC notification(id 缺省),fire-and-forget,内部吞错。 */
  notify(method: string, params: unknown): Promise<void>;
  close(): void;
}

/**
 * legacy SSE transport:GET 同一 URL 打开事件流(Accept: text/event-stream),
 * 响应头可能带 Mcp-Session-Id(后续 POST 必须回传);JSON-RPC 消息 POST 到同一
 * URL,响应经事件流 `event: message` + `data: <json>` 到达,按 id 关联。
 * 防御:若 POST 直接返回 JSON-RPC 响应体(部分服务器实现),直接用。
 */
class LegacySseTransport implements Transport {
  private sessionId: string | null = null;
  private openPromise: Promise<void> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private parser = new SseParser();
  private readonly host: string;
  private readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly providerId: ProviderId;

  constructor(url: string, fetchImpl: FetchLike, providerId: ProviderId) {
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.providerId = providerId;
    this.host = hostOf(url);
  }

  request(method: string, params: unknown, id: number, ctx: TransportContext): Promise<unknown> {
    return withTimeout(
      ctx.timeoutMs,
      ctx.signal,
      async (sig) => {
        await this.open(sig);
        const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        // 先注册 pending 再发 POST:响应可能极快到达(先于 waitFor 注册即丢)
        const waiter = this.waitFor(id, ctx.timeoutMs);
        try {
          const res = await this.post(body, sig);
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('application/json')) {
            // 防御:部分服务器直接返回 JSON-RPC 响应体
            waiter.cancel();
            return parseRpcBody(await readAll(res), id);
          }
        } catch (err) {
          waiter.cancel();
          throw err;
        }
        return waiter.promise;
      },
      () => new McpTimeoutError(this.providerId, this.host, ctx.timeoutMs),
    );
  }

  async notify(method: string, params: unknown): Promise<void> {
    try {
      await this.open(new AbortController().signal);
      const body = JSON.stringify({ jsonrpc: '2.0', method, params });
      await this.post(body, new AbortController().signal);
    } catch {
      /* 通知失败不致命(部分服务器容忍缺省初始化通知) */
    }
  }

  close(): void {
    if (this.reader) {
      const r = this.reader;
      this.reader = null;
      try {
        void r.cancel().catch(() => {});
      } catch {
        /* 已关 */
      }
    }
    this.failAll(new McpStreamClosedError(this.providerId, this.host));
  }

  // ---- 内部 ----

  private open(sig: AbortSignal): Promise<void> {
    if (this.openPromise) return this.openPromise;
    this.openPromise = this.doOpen(sig);
    return this.openPromise;
  }

  private async doOpen(sig: AbortSignal): Promise<void> {
    let res: FetchResponseLike;
    try {
      res = await this.fetchImpl(this.url, { method: 'GET', headers: { Accept: 'text/event-stream' }, signal: sig });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new ConnectFailure(this.providerId, this.host, null);
    }
    if (!res.ok) throw new ConnectFailure(this.providerId, this.host, res.status);
    if (!res.body) throw new ConnectFailure(this.providerId, this.host, null);
    this.sessionId = res.headers.get('mcp-session-id');
    this.reader = res.body.getReader();
    void this.readLoop().catch(() => {
      /* failAll 已在 readLoop 内处理 */
    });
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    const reader = this.reader;
    if (!reader) return;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          this.failAll(new McpStreamClosedError(this.providerId, this.host));
          return;
        }
        for (const ev of this.parser.push(decoder.decode(value, { stream: true }))) {
          if (ev.event === 'message') this.dispatch(ev.data);
        }
      }
    } catch {
      this.failAll(new McpStreamClosedError(this.providerId, this.host));
    }
  }

  private dispatch(raw: string): void {
    let msg: RpcResponse;
    try {
      msg = JSON.parse(raw) as RpcResponse;
    } catch {
      return;
    }
    const id = msg.id;
    if (typeof id !== 'number') return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new McpRpcError(String(msg.error.message ?? 'mcp rpc error'), msg.error.code ?? -1));
    else p.resolve(msg.result);
  }

  private waitFor(id: number, timeoutMs: number): { promise: Promise<unknown>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const promise = new Promise<unknown>((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpTimeoutError(this.providerId, this.host, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    return {
      promise,
      cancel: () => {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
      },
    };
  }

  private async post(body: string, sig: AbortSignal): Promise<FetchResponseLike> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    let res: FetchResponseLike;
    try {
      res = await this.fetchImpl(this.url, { method: 'POST', headers, body, signal: sig });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new ConnectFailure(this.providerId, this.host, null);
    }
    if (!res.ok) throw new ConnectFailure(this.providerId, this.host, res.status);
    return res;
  }

  private failAll(err: Error): void {
    const pend = [...this.pending.entries()];
    this.pending.clear();
    for (const [, p] of pend) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }
}

/**
 * Streamable HTTP transport:单 POST 端点;请求头 content-type/accept/
 * mcp-protocol-version/Mcp-Session-Id(若收到过);响应可能是 application/json
 * (直接 JSON-RPC 响应)或 text/event-stream(`event: message` 数据);initialize
 * 响应若带 Mcp-Session-Id 头,后续请求回传。
 */
class StreamableTransport implements Transport {
  private sessionId: string | null = null;
  private readonly host: string;
  private readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly providerId: ProviderId;

  constructor(url: string, fetchImpl: FetchLike, providerId: ProviderId) {
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.providerId = providerId;
    this.host = hostOf(url);
  }

  request(method: string, params: unknown, id: number, ctx: TransportContext): Promise<unknown> {
    return withTimeout(
      ctx.timeoutMs,
      ctx.signal,
      async (sig) => {
        const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL_VERSION,
        };
        if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
        let res: FetchResponseLike;
        try {
          res = await this.fetchImpl(this.url, { method: 'POST', headers, body, signal: sig });
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') throw err;
          throw new ConnectFailure(this.providerId, this.host, null);
        }
        if (!res.ok) throw new ConnectFailure(this.providerId, this.host, res.status);
        const session = res.headers.get('mcp-session-id');
        if (session) this.sessionId = session;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('text/event-stream')) return this.readSse(res, id);
        return parseRpcBody(await readAll(res), id);
      },
      () => new McpTimeoutError(this.providerId, this.host, ctx.timeoutMs),
    );
  }

  async notify(method: string, params: unknown): Promise<void> {
    try {
      const body = JSON.stringify({ jsonrpc: '2.0', method, params });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_VERSION,
      };
      if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      const res = await this.fetchImpl(this.url, { method: 'POST', headers, body, signal: new AbortController().signal });
      if (res.ok && res.body) {
        try {
          await readAll(res);
        } catch {
          /* 忽略 */
        }
      }
    } catch {
      /* 通知失败不致命 */
    }
  }

  close(): void {
    /* 无长连接:每次请求独立 POST */
  }

  private async readSse(res: FetchResponseLike, id: number): Promise<unknown> {
    if (!res.body) throw new McpStreamClosedError(this.providerId, this.host);
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
        if (ev.event === 'message') return parseRpcBody(ev.data, id);
      }
    }
    throw new McpStreamClosedError(this.providerId, this.host);
  }
}

// ---------------------------------------------------------------------------
// Provider 门面:单例 map + connect 缓存 + 3 并发信号量 + 失败 dispose
// ---------------------------------------------------------------------------

const INIT_PARAMS = { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO };
let rpcSeq = 0;

function rpc(t: Transport, method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const id = ++rpcSeq;
  return t.request(method, params, id, { timeoutMs, signal });
}

class McpProviderInstance implements McpProviderHandle {
  private transport: Transport | null = null;
  private connectPromise: Promise<Transport> | null = null;
  private toolsCache: McpToolMeta[] | null = null;
  private readyFlag = false;
  private readonly semaphore: Semaphore;
  private readonly fetchImpl: FetchLike;
  private readonly connectMs: number;
  private readonly callMs: number;
  /** public:McpProviderHandle 契约要求(id: ProviderId)。 */
  readonly id: ProviderId;
  private readonly endpoint: McpEndpoint;
  /** 协商出的服务器协议版本;容忍任意值,仅记录诊断用,绝不因不匹配失败。 */
  private negotiatedProtocol: string | null = null;
  disposed = false;

  constructor(id: ProviderId, endpoint: McpEndpoint, opts?: ProviderOptions) {
    this.id = id;
    this.endpoint = endpoint;
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.connectMs = opts?.timeouts?.connectMs ?? CONNECT_TIMEOUT_MS;
    this.callMs = opts?.timeouts?.callMs ?? CALL_TIMEOUT_MS;
    this.semaphore = new Semaphore(MAX_CONCURRENCY);
  }

  isReady(): boolean {
    return this.readyFlag;
  }

  async listTools(): Promise<McpToolMeta[]> {
    await this.semaphore.acquire();
    try {
      if (this.toolsCache) return this.toolsCache;
      const t = await this.connect();
      const result = (await rpc(t, 'tools/list', {}, this.callMs)) as { tools?: unknown };
      const raw = Array.isArray(result?.tools) ? result.tools : [];
      this.toolsCache = raw
        .filter((m): m is { name?: unknown; description?: unknown; inputSchema?: unknown } => !!m && typeof m === 'object')
        .map((m) => ({
          name: String(m.name ?? ''),
          description: String(m.description ?? ''),
          inputSchema:
            m.inputSchema && typeof m.inputSchema === 'object' && !Array.isArray(m.inputSchema)
              ? (m.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} },
        }));
      this.readyFlag = true;
      return this.toolsCache;
    } catch (err) {
      // 失败 → 置 not ready + dispose(下次请求重建重试)
      this.dispose();
      throw err;
    } finally {
      this.semaphore.release();
    }
  }

  async callTool(origName: string, args: unknown, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
    await this.semaphore.acquire();
    try {
      const t = await this.connect(signal);
      const result = (await rpc(t, 'tools/call', { name: origName, arguments: args ?? {} }, this.callMs, signal)) as {
        content?: unknown;
        isError?: unknown;
      };
      return { text: contentToText(result), isError: result?.isError === true };
    } catch (err) {
      // 连接层失败 → 重建;RPC/超时/abort → 保留连接
      if (err instanceof ConnectFailure || err instanceof McpStreamClosedError) this.dispose();
      return { text: formatMcpError(this.id, err), isError: true };
    } finally {
      this.semaphore.release();
    }
  }

  /** 进程级保活:请求结束不 dispose;仅失败时 dispose 置空以便重建。 */
  dispose(): void {
    this.disposed = true;
    const t = this.transport;
    this.transport = null;
    this.connectPromise = null;
    this.toolsCache = null;
    this.readyFlag = false;
    this.negotiatedProtocol = null;
    if (t) {
      try {
        t.close();
      } catch {
        /* 忽略 */
      }
    }
  }

  private connect(signal?: AbortSignal): Promise<Transport> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect(signal).catch((err: unknown) => {
      this.connectPromise = null;
      throw err;
    });
    return this.connectPromise;
  }

  private async doConnect(signal?: AbortSignal): Promise<Transport> {
    const attempts: Array<{ url: string; transport: 'streamable' | 'sse' }> = [
      { url: this.endpoint.url, transport: this.endpoint.transport },
    ];
    if (this.endpoint.fallbackUrl) {
      attempts.push({
        url: this.endpoint.fallbackUrl,
        transport: this.endpoint.transport === 'streamable' ? 'sse' : 'streamable',
      });
    }
    let lastErr: unknown;
    for (const a of attempts) {
      try {
        const transport: Transport =
          a.transport === 'sse'
            ? new LegacySseTransport(a.url, this.fetchImpl, this.id)
            : new StreamableTransport(a.url, this.fetchImpl, this.id);
        // 协议版本容忍(2026-08-21 实测校准):客户端发 2025-06-18,高德服务器
        // 实测回 2025-03-26。服务器可回任意版本 —— 记录协商结果但绝不因版本
        // 不匹配失败(仅 404/405/400 才换备选端点重试)。
        const initResult = (await rpc(transport, 'initialize', INIT_PARAMS, this.connectMs, signal)) as {
          protocolVersion?: unknown;
        };
        this.negotiatedProtocol = typeof initResult?.protocolVersion === 'string' ? initResult.protocolVersion : null;
        if (this.negotiatedProtocol !== null && this.negotiatedProtocol !== PROTOCOL_VERSION) {
          console.warn(
            `[mcp-agent] ${this.id} negotiated protocol ${String(this.negotiatedProtocol).slice(0, 40)} (client ${PROTOCOL_VERSION}); accepting server version`,
          );
        }
        void transport.notify('notifications/initialized', {}).catch(() => {});
        this.transport = transport;
        return transport;
      } catch (err) {
        lastErr = err;
        // 仅 404/405/400 换备选 transport 重试一次;其它错误直接失败(dispose 后下次重建)
        if (!(err instanceof ConnectFailure) || err.status === null || !RETRY_STATUSES.has(err.status)) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new ConnectFailure(this.id, hostOf(this.endpoint.url), null);
  }
}

// ---------------------------------------------------------------------------
// 单例出口
// ---------------------------------------------------------------------------

const providers = new Map<ProviderId, McpProviderInstance>();

/**
 * 取 provider 句柄;key 未配(MCP_ENDPOINTS 为 null)→ null。句柄进程级缓存;
 * 测试重置后重建。opts 仅在创建新实例时生效(已有缓存句柄时忽略)。
 */
export function getMcpProvider(id: ProviderId, opts?: ProviderOptions): McpProviderHandle | null {
  const endpoint = MCP_ENDPOINTS[id];
  if (!endpoint) return null;
  let p = providers.get(id);
  if (!p || p.disposed) {
    p = new McpProviderInstance(id, endpoint, opts);
    providers.set(id, p);
  }
  return p;
}

/** 测试专用:清空全部单例(下次 getMcpProvider 重建)。 */
export function resetMcpProvidersForTest(): void {
  for (const p of providers.values()) p.dispose();
  providers.clear();
}

// ---------------------------------------------------------------------------
// 结果转述
// ---------------------------------------------------------------------------

/** tools/call 的 content 数组转述为纯文本(text 项拼接;image 项占位)。 */
function contentToText(result: unknown): string {
  if (result === null || result === undefined) return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    if (typeof result === 'string') return result;
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      parts.push(String(item));
      continue;
    }
    const it = item as { type?: unknown; text?: unknown; data?: unknown };
    if (it.type === 'image') {
      const bytes = typeof it.data === 'string' ? it.data.length : 0;
      parts.push(`[image ${bytes} bytes]`);
    } else if (typeof it.text === 'string') {
      parts.push(it.text);
    } else {
      try {
        parts.push(JSON.stringify(item));
      } catch {
        parts.push('[unserializable content]');
      }
    }
  }
  return parts.join('\n');
}

/** 错误转述:只含 host/status/错误类别,绝不含 key 与 URL。 */
function formatMcpError(providerId: ProviderId, err: unknown): string {
  if (err instanceof ConnectFailure || err instanceof McpTimeoutError || err instanceof McpStreamClosedError) return err.message;
  if (err instanceof McpRpcError) return `mcp(${providerId}) rpc error: ${err.message}`;
  if (err instanceof Error && err.name === 'AbortError') return `mcp(${providerId}) request aborted`;
  return `mcp(${providerId}) error`;
}
