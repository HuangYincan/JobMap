// MCP 客户端 —— 官方 @modelcontextprotocol/sdk(tech/24 §5 实现层)。
//
// 2026-08-21 批次:用户放行 npm install 后,由手写零依赖客户端替换为官方 SDK。
// 对外接口零变化(getMcpProvider / McpProviderHandle / normalizeTool / resetMcpProvidersForTest),
// 下游 run-agent / tools / route 不改。
//
// SDK 源码审查结论(dist/esm,SDK 1.30.0):
// 1. Client.connect() 自动做 initialize + notifications/initialized;SUPPORTED_PROTOCOL_VERSIONS
//    含 2025-11-25/2025-06-18/2025-03-26/2024-11-05/2024-10-07 —— 高德实测回 2025-03-26
//    在支持列表内,「协议版本容忍」天然满足;列表外版本会抛错(手写版容忍任意版本)。
// 2. Protocol.request() 的 options.timeout(默认 60s)是唯一请求级超时;transport 本身
//    (StreamableHTTPClientTransport / SSEClientTransport)无超时、start() 不做网络 I/O
//    (SSE 的 start() 挂在 `event: endpoint` 事件上,不发该事件的服务器会挂起)→ 本文件
//    在 connect 外层再包一层超时兜底(Promise.race + 失败后 close 拆掉挂起的 EventSource)。
// 3. SSE transport 基于 eventsource 包,POST 端点来自服务器 `event: endpoint`(旧手写版是
//    同 URL POST);事件流意外断开时 eventsource 自动重连(不通知 onclose),挂起的请求只能
//    等到请求超时 —— 原「stream closed → 本轮剔除」语义退化为超时剔除。
// 4. 响应一律经 zod schema 校验(Initialize/ListTools/CallTool):工具缺 inputSchema / content
//    非数组等非规范形态会整单失败(手写版宽松透传 + 兜底) —— 规范服务器不受影响。
// 5. 错误分类:非 2xx → StreamableHTTPError(status)/SseError(code=status);JSON-RPC error →
//    McpError(code,message);超时 → McpError(ErrorCode.RequestTimeout);close → McpError
//    (ConnectionClosed);外部 abort → DOMException(AbortError)或 McpError(RequestTimeout)。
//
// 保留语义:connect 超时 ≤15s、单例缓存、失败 → 本轮剔除且 dispose、下次请求重建、
// 请求结束不 dispose(进程级保活)、每 provider 3 并发信号量、错误信息只含 host 与
// status 绝不含 key、工具列表缓存(重复 listTools 不再发请求)。

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

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

/** fetch 的窄接口(转发给 SDK transport;SDK 内部只依赖标准 Response)。 */
export type FetchLike = typeof fetch;

export interface ProviderOptions {
  /** 测试注入点:默认全局 fetch。 */
  fetchImpl?: FetchLike;
  timeouts?: { connectMs?: number; callMs?: number };
  /** 测试专用:注入 SDK Transport(如 InMemoryTransport 客户端侧)替代按端点构建。 */
  transportFactory?: (kind: 'streamable' | 'sse', url: string) => Transport;
}

// ---------------------------------------------------------------------------
// 常量与错误
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 3;
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

/** 外部 abort(用户停止)归一的错误,formatMcpError 按 name 识别。 */
class McpAbortError extends Error {
  constructor() {
    super('mcp request aborted');
    this.name = 'AbortError';
  }
}

// ---------------------------------------------------------------------------
// 纯函数:工具名归一化(tech/24 §5.3,原样保留)
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
// 基础工具:信号量 / 超时包装
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

/**
 * 超时包装:Promise.race 兜底 —— 即使 fn 不响应 abort(如 SDK SSE transport 的
 * start() 挂在 `event: endpoint` 上、eventsource 不接外部 signal),超时也照常失败;
 * 失败方由调用方负责 close 拆掉挂起的连接。外部信号先 aborted → 直接 McpAbortError。
 */
function withTimeout<T>(
  timeoutMs: number,
  external: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
  makeTimeoutError: () => Error,
): Promise<T> {
  if (external?.aborted) return Promise.reject(new McpAbortError());
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(makeTimeoutError());
    }, timeoutMs);
  });
  const sig = external ? AbortSignal.any([ctrl.signal, external]) : ctrl.signal;
  const fnPromise = Promise.resolve().then(() => fn(sig));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle =
      (next: (v: unknown) => void) =>
      (v: unknown): void => {
        if (settled) return;
        settled = true;
        next(v);
      };
    // 败者 promise 的 rejection 由 settle 消费,避免 unhandled rejection。
    fnPromise.then(settle((v) => resolve(v as T)), settle((e: unknown) => reject(e)));
    timeoutPromise.catch(settle((e: unknown) => reject(e)));
  }).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// SDK transport 构建与 connect 包装
// ---------------------------------------------------------------------------

function createSdkTransport(kind: 'streamable' | 'sse', url: string, fetchImpl?: FetchLike): Transport {
  if (kind === 'sse') return new SSEClientTransport(new URL(url), { fetch: fetchImpl });
  return new StreamableHTTPClientTransport(new URL(url), { fetch: fetchImpl });
}

/** client.connect() 整段(transport.start + initialize + initialized 通知)包上 connect 超时。 */
function connectWithTimeout(
  client: Client,
  transport: Transport,
  connectMs: number,
  signal: AbortSignal | undefined,
  providerId: ProviderId,
  host: string,
): Promise<void> {
  return withTimeout(
    connectMs,
    signal,
    (sig) => client.connect(transport, { timeout: connectMs, signal: sig }),
    () => new McpTimeoutError(providerId, host, connectMs),
  );
}

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------

/** 把 SDK 错误归一到本模块的连接级错误(SDK 错误名含 URL/statusText 等,只取 host+status)。 */
function classifyConnectError(err: unknown, providerId: ProviderId, host: string): Error {
  if (err instanceof ConnectFailure || err instanceof McpTimeoutError || err instanceof McpError) return err;
  if (err instanceof Error && err.name === 'AbortError') return err;
  if (err instanceof Error && err.name === 'ZodError') return err;
  if (err instanceof Error && typeof (err as unknown as { code?: unknown }).code === 'number') {
    const code = (err as unknown as { code: number }).code;
    // StreamableHTTPError / SseError 的 code 即 HTTP status(SDK 内部 -1 = 协议层错误)。
    if (code > 0) return new ConnectFailure(providerId, host, code);
  }
  return new ConnectFailure(providerId, host, null);
}

function isRetryableConnectError(err: unknown): boolean {
  return err instanceof ConnectFailure && err.status !== null && RETRY_STATUSES.has(err.status);
}

/** 连接层错误(网络/HTTP/流关闭/连接被关)→ 置 not ready + dispose 重建;RPC/超时/abort 保留连接。 */
function isConnectionError(err: unknown): boolean {
  if (err instanceof ConnectFailure) return true;
  if (err instanceof McpTimeoutError) return false;
  if (err instanceof McpError) return err.code === ErrorCode.ConnectionClosed;
  if (err instanceof Error) {
    // 外部 abort / 响应 schema 校验失败(zod)→ 非连接层
    if (err.name === 'AbortError' || err.name === 'ZodError') return false;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Provider 门面:单例 map + connect 缓存 + 3 并发信号量 + 失败 dispose
// ---------------------------------------------------------------------------

class McpProviderInstance implements McpProviderHandle {
  private client: Client | null = null;
  private connectPromise: Promise<Client> | null = null;
  private toolsCache: McpToolMeta[] | null = null;
  private readyFlag = false;
  private readonly semaphore: Semaphore;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly transportFactory: ProviderOptions['transportFactory'];
  private readonly connectMs: number;
  private readonly callMs: number;
  /** public:McpProviderHandle 契约要求(id: ProviderId)。 */
  readonly id: ProviderId;
  private readonly endpoint: McpEndpoint;
  disposed = false;

  constructor(id: ProviderId, endpoint: McpEndpoint, opts?: ProviderOptions) {
    this.id = id;
    this.endpoint = endpoint;
    this.fetchImpl = opts?.fetchImpl;
    this.transportFactory = opts?.transportFactory;
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
      const client = await this.connect();
      // 工具元信息已由 SDK 的 ListToolsResultSchema 校验(name/description/inputSchema 形状);
      // normalizeTool 的兜底逻辑保留在 route 侧(本模块不归一化)。
      const result = await client.listTools(undefined, { timeout: this.callMs });
      this.toolsCache = result.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema as Record<string, unknown>,
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
      const client = await this.connect(signal);
      if (signal?.aborted) return { text: `mcp(${this.id}) request aborted`, isError: true };
      const result = await client.callTool(
        { name: origName, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { timeout: this.callMs, signal },
      );
      return { text: contentToText(result), isError: result.isError === true };
    } catch (err) {
      // 连接层失败 → 重建;RPC/超时/abort → 保留连接
      if (isConnectionError(err)) this.dispose();
      const classified = classifyConnectError(err, this.id, hostOf(this.endpoint.url));
      return { text: formatMcpError(this.id, classified, signal, this.callMs), isError: true };
    } finally {
      this.semaphore.release();
    }
  }

  /** 进程级保活:请求结束不 dispose;仅失败时 dispose 置空以便重建。 */
  dispose(): void {
    this.disposed = true;
    const client = this.client;
    this.client = null;
    this.connectPromise = null;
    this.toolsCache = null;
    this.readyFlag = false;
    if (client) {
      // close() 终止 SDK 侧连接(abort fetch / 关 EventSource / 清重连定时器)。
      void client.close().catch(() => {});
    }
  }

  private connect(signal?: AbortSignal): Promise<Client> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect(signal).catch((err: unknown) => {
      this.connectPromise = null;
      throw err;
    });
    return this.connectPromise;
  }

  private async doConnect(signal?: AbortSignal): Promise<Client> {
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
      const client = new Client(CLIENT_INFO, { capabilities: {} });
      try {
        const transport: Transport = this.transportFactory
          ? this.transportFactory(a.transport, a.url)
          : createSdkTransport(a.transport, a.url, this.fetchImpl);
        // connect 超时由外层 withTimeout 兜底(见头注释第 2 条);协议版本容忍由 SDK 原生支持
        // (SUPPORTED_PROTOCOL_VERSIONS 含 2025-03-26);仅 404/405/400 换备选端点重试一次。
        await connectWithTimeout(client, transport, this.connectMs, signal, this.id, hostOf(a.url));
        this.client = client;
        return client;
      } catch (err) {
        const classified = classifyConnectError(err, this.id, hostOf(a.url));
        lastErr = classified;
        // close() 拆掉本次失败的 client/transport(含挂起的 SSE EventSource),再决定是否重试。
        await client.close().catch(() => {});
        if (!isRetryableConnectError(classified)) throw classified;
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
function formatMcpError(providerId: ProviderId, err: unknown, signal?: AbortSignal, callMs?: number): string {
  if (err instanceof ConnectFailure || err instanceof McpTimeoutError) return err.message;
  if (err instanceof McpError) {
    if (err.code === ErrorCode.RequestTimeout) {
      // SDK 请求级超时;若同时外部 signal 已 aborted,归为「用户停止」而非超时。
      return signal?.aborted
        ? `mcp(${providerId}) request aborted`
        : `mcp(${providerId}) call timeout after ${callMs ?? '?'}ms`;
    }
    if (err.code === ErrorCode.ConnectionClosed) return `mcp(${providerId}) connection closed`;
    return `mcp(${providerId}) rpc error: ${String(err.message ?? 'mcp rpc error').slice(0, 200)}`;
  }
  if (err instanceof Error && err.name === 'AbortError') return `mcp(${providerId}) request aborted`;
  return `mcp(${providerId}) error`;
}
