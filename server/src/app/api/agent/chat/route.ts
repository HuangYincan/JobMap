// POST /api/agent/chat — AI Agent SSE 端点(tech/24 §7)。
//
// 校验顺序契约:前置校验(body 大小 / messages 形状 / viewport / LLM 配置 /
// 限流)**必须发生在任何 MCP/LLM 连接之前**——contract 测试以「校验函数调用
// 行号 < getMcpProvider/runAgent 引用行号」断言(工具集构建内联在 POST 内、
// 位于全部校验之后,保证源码行序 = 执行序)。
//
// 事件公开白名单由 `lib/agent/public-sse.ts` 统一定义;本端点在网络发送前逐事件过滤,
// reasoning 仅保留在服务端 run-agent/provider tool-call replay 链路,error 事件经公开面脱敏
// (code/message 收敛到安全集合)后下发。

import { NextResponse } from 'next/server';
import { BoundedRateStore } from '@/lib/bounded-rate-store';
import { RequestBodyTooLargeError, readJsonBody } from '@/lib/request-body';
import { readSessionToken, readSessionUser } from '@/lib/http-session';
import { clientIpBucketKey } from '@/lib/client-ip';
import { readAgentConfig, hasBaiduAgentPlan } from '@/lib/agent/config';
import { runAgent } from '@/lib/agent/run-agent';
import { getMcpProvider, normalizeTool } from '@/lib/agent/mcp-providers';
import type { ProviderId } from '@/lib/agent/mcp-providers';
import type { AgentTool } from '@/lib/agent/types';
import { AGENT_CHAT_MAX_MESSAGES, toAgentChatMessages } from '@/lib/agent/chat-messages';
import { parseAgentUserLocation, parseAgentViewport } from '@/lib/agent/search-origin';
import { filterPublicSseEvent } from '@/lib/agent/public-sse';
import { builtinTools, memorySaveTool } from '@/lib/agent/tools/builtin';
import { restFallbackTools } from '@/lib/agent/tools/rest-fallback';
import { preferLocalPlaceSearch } from '@/lib/agent/local-place-search';
import { baiduAgentPlanTools } from '@/lib/agent/tools/baidu-agent-plan';
import { workTools } from '@/lib/agent/tools/work';
import { navigationTools } from '@/lib/agent/tools/navigation';
import {
  createNavigationSessionToken,
  fingerprintNavigationSession,
  readNavigationSessionToken,
  serializeNavigationSessionCookie,
} from '@/lib/navigation/navigation-session';

export const runtime = 'nodejs';

// ---- 输入上限(tech/24 §6.5)----
const MAX_BODY_CHARS = 32 * 1024;
/** SSE 输出字节上限;超 → `done, truncated`(为终态事件保留余量)。 */
const MAX_SSE_BYTES = 200 * 1024;
const SSE_TAIL_RESERVE = 512;

// ---- 限流:模块级内存令牌桶,每桶 10 req/min(tech/24 §6.5)----
const RATE_LIMIT_PER_MIN = 10;
const RATE_REFILL_MS = 60_000 / RATE_LIMIT_PER_MIN;
const RATE_BUCKET_TTL_MS = 2 * 60_000;
/** Request keys are attacker-controlled; cap process-local bucket memory. */
const RATE_BUCKET_CAPACITY = 10_000;
const buckets = new BoundedRateStore<{ tokens: number; last: number }>(RATE_BUCKET_CAPACITY);

// ---- 代理信任开关(quality-scan #11 落点,2026-08-23;语义抽至 lib/client-ip)----
// x-forwarded-for 由网络代理注入;客户端直连 Next 时可任意伪造并轮换该头,仅凭首段
// 取 IP 会让「10 req/min」桶被绕过(LLM 费用滥用)。因此仅当部署在可信反代之后
// (配置 TRUSTED_PROXY_IPS,逗号分隔的代理出站地址)才信任转发头;未配置时完全
// 忽略转发头,桶键改用会话指纹(登录用户按会话 cookie 哈希;匿名无 cookie 归入
// 固定桶)——伪造 XFF 不再换桶。SSE 端点保持公开可达,但限流键不再可被请求头操纵。

function rateLimit(key: string): boolean {
  const now = Date.now();
  let b = buckets.get(key, now);
  if (!b) {
    buckets.set(key, { tokens: RATE_LIMIT_PER_MIN - 1, last: now }, RATE_BUCKET_TTL_MS, now);
    return true;
  }
  b.tokens = Math.min(RATE_LIMIT_PER_MIN, b.tokens + (now - b.last) / RATE_REFILL_MS);
  b.last = now;
  let allowed = false;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    allowed = true;
  }
  buckets.set(key, b, RATE_BUCKET_TTL_MS, now);
  return allowed;
}

/** 限流桶键:可信反代之后 → 转发头首段(代理注入,客户端不可控);否则 → 会话指纹
 *  (cookie 哈希;匿名固定桶)——轮换 x-forwarded-for 对桶键零影响。解析统一在
 *  lib/client-ip(quality-scan r2 #1,与 OTP/密码登录路由同语义)。 */
async function rateLimitKey(request: Request): Promise<string> {
  return clientIpBucketKey(request, await readSessionToken());
}

interface ChatBody {
  messages?: Array<{ role?: string; content?: unknown }>;
  viewport?: {
    center?: { lng?: unknown; lat?: unknown };
    zoom?: unknown;
    bounds?: { minLng?: unknown; minLat?: unknown; maxLng?: unknown; maxLat?: unknown };
  };
  userLocation?: { lng?: unknown; lat?: unknown };
  lang?: unknown;
}

function bad(code: string, message: string) {
  return NextResponse.json({ code, message }, { status: 400 });
}

export async function POST(request: Request) {
  // 1. 限流(最前置,读 body 之前;超限 → 429)
  if (!rateLimit(await rateLimitKey(request))) {
    return NextResponse.json({ code: 'RATE_LIMITED', message: 'too many requests, retry later' }, { status: 429 });
  }

  // 2. body 大小(先看 content-length 快速路径,再读全文;超限 → 400)
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_CHARS) {
    return bad('BODY_TOO_LARGE', `request body must be ≤ ${MAX_BODY_CHARS} bytes`);
  }

  // 3. JSON 解析 + messages 整形(空/首条非 user → 400;超 cap 从最旧裁,缺 content 补 "")
  let body: ChatBody;
  try {
    body = await readJsonBody<ChatBody>(request, MAX_BODY_CHARS);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return bad('BODY_TOO_LARGE', `request body must be ≤ ${MAX_BODY_CHARS} bytes`);
    }
    return bad('BAD_MESSAGES', 'invalid JSON body');
  }
  // 会话 cap 30 + 本轮新 user 会到 31 条;缺 content 的空助手气泡 JSON 也会丢掉字段。
  // 裁剪/补齐后为空才 400,不因略超上限整轮失败。
  if (!Array.isArray(body.messages)) {
    return bad('BAD_MESSAGES', `messages must be 1..${AGENT_CHAT_MAX_MESSAGES} items`);
  }
  const messages = toAgentChatMessages(body.messages);
  if (messages.length === 0) {
    return bad('BAD_MESSAGES', `messages must be 1..${AGENT_CHAT_MAX_MESSAGES} items`);
  }
  if (messages[0].role !== 'user') {
    return bad('BAD_MESSAGES', 'first message must have role "user"');
  }

  // 4. 可选 viewport / userLocation:解析失败则省略,不 400 整轮对话。
  // 地图快照缺 zoom、定位坐标被 JSON 成 null/字符串时仍应能提问。
  const viewport = parseAgentViewport(body.viewport);
  const userLocation = parseAgentUserLocation(body.userLocation);

  // 5. LLM 配置缺失 → 503(tech/24 §5.4 #4)
  const cfgRes = readAgentConfig();
  if (!cfgRes.ok) {
    return NextResponse.json({ code: 'LLM_UNCONFIGURED', message: cfgRes.reason }, { status: 503 });
  }

  // 6. 身份读取(会话 cookie → userId;guest = null)。位于全部前置校验之后、
  //    任何 MCP/LLM 连接之前(保持既有行序契约):登录 → 注入用户记忆段并追加
  //    memory_save 工具;guest → userId 不传、不加工具(tech/30-agent-memory.md §5)。
  const sessionUser = await readSessionUser();

  // Navigation session cookie is shared with /api/navigation/routes/* (Path=/api,
  // HttpOnly, SameSite=Lax, Secure in production). Mint after request validation
  // and before MCP/LLM. The raw cookie never enters JSON, SSE, or logs; only the
  // SHA-256 fingerprint is placed on AgentContext.
  const existingNavigationToken = readNavigationSessionToken(request);
  const navigationToken = existingNavigationToken ?? createNavigationSessionToken();
  const navigationSetCookie = existingNavigationToken
    ? undefined
    : serializeNavigationSessionCookie(navigationToken);
  const navigationFingerprint = fingerprintNavigationSession(navigationToken);

  // ---- 公开 error 事件脱敏(2026-08-21 安全要求):code 收敛到安全集合,message 一律置空 ----
  // 内部细节(provider 错误码 / HTTP 状态 / 内部异常)只进服务端日志(console.error),
  // 不随 SSE 下发;前端按 code 分支展示。注意:本块位于全部前置校验之后(勿前移,
  // 否则破坏「校验顺序契约」的源码行序断言)。
  const PUBLIC_ERROR_CODES = new Set(['LLM_UNCONFIGURED', 'RATE_LIMITED']);

  /** 内部 error 事件 → 公开 error 事件:LLM_UNCONFIGURED(503 前端专用)/RATE_LIMITED(429)
   *  保留 code,其余一律 ERROR;message 一律置空(不携带内部文本)。 */
  function publicErrorEvent(err: { code: string; message: string }): { type: 'error'; code: string; message: string } {
    const code = PUBLIC_ERROR_CODES.has(err.code) ? err.code : 'ERROR';
    return { type: 'error', code, message: '' };
  }

  // ---- 前置校验全部通过,才开始构建工具集(连接 MCP/LLM)----
  const toolNamesState: { names: string[] } = { names: [] };
  const tools: AgentTool[] = [
    ...builtinTools(() => toolNamesState.names),
    ...restFallbackTools(),
    ...workTools(),
    ...navigationTools(),
    ...(hasBaiduAgentPlan() ? baiduAgentPlanTools() : []),
    ...(sessionUser ? [memorySaveTool()] : []),
  ];
  // MCP 三平台:key 未配 → 不注册;单个 listTools 失败 → 跳过该 provider,不致命(tech/24 §5.4)
  const mcpIds: ProviderId[] = ['amap', 'tencent', 'baidu'];
  for (const id of mcpIds) {
    const p = getMcpProvider(id);
    if (!p) continue;
    try {
      for (const meta of await p.listTools()) {
        const t = normalizeTool(id, meta);
        tools.push(preferLocalPlaceSearch({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          provider: id,
          call: async (input, ctx) => {
            const r = await p.callTool(meta.name, input ?? {}, ctx.signal);
            return r.isError
              ? { ok: false, error: r.text }
              : { ok: true, text: r.text, ...(r.images && r.images.length > 0 ? { images: r.images } : {}) };
          },
        }));
      }
    } catch {
      /* 跳过该 provider */
    }
  }
  toolNamesState.names = tools.map((t) => t.name);

  const lang: 'zh' | 'en' = body.lang === 'en' ? 'en' : 'zh';

  const upstreamAbort = new AbortController();
  const propagateRequestAbort = () => upstreamAbort.abort(request.signal.reason);
  if (request.signal.aborted) propagateRequestAbort();
  else request.signal.addEventListener('abort', propagateRequestAbort);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let bytes = 0;
      // 单事件 `data: <单行 JSON>\n\n`;返回 false = 输出预算耗尽。
      const send = (event: unknown, allowOverflow = false): boolean => {
        const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
        if (!allowOverflow && bytes + chunk.length > MAX_SSE_BYTES - SSE_TAIL_RESERVE) return false;
        bytes += chunk.length;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          return false; // 客户端已断开
        }
      };
      try {
        for await (const event of runAgent({
          config: cfgRes.cfg,
          messages,
          tools,
          viewport,
          userLocation,
          lang,
          signal: upstreamAbort.signal,
          userId: sessionUser?.id,
          navigationSession: { fingerprint: navigationFingerprint },
        })) {
          if (upstreamAbort.signal.aborted) break;
          // 网络发送边界显式 allowlist:reasoning/未知事件只留在服务端,不得进入 SSE。
          const publicEvent = filterPublicSseEvent(event);
          if (!publicEvent) continue;
          // 公开面脱敏:error 事件 code/message 收敛到安全集合;内部细节只进服务端日志
          let out: unknown = publicEvent;
          if (publicEvent.type === 'error') {
            console.error(`[agent] 内部错误 code=${publicEvent.code} message=${publicEvent.message}`);
            out = publicErrorEvent(publicEvent);
          }
          if (!send(out)) {
            // 输出超限 → done, truncated(tech/24 §6.5)
            upstreamAbort.abort(new Error('SSE output budget exhausted'));
            send({ type: 'done', truncated: true }, true);
            return;
          }
        }
      } catch (err) {
        // 内部异常细节只进服务端日志;公开 error 事件收敛到安全集合
        console.error('[agent] SSE 流异常', err);
        send({ type: 'error', code: 'ERROR', message: '' });
      } finally {
        request.signal.removeEventListener('abort', propagateRequestAbort);
        // The response is terminal; don't leave an LLM/MCP round running because
        // a client disappeared or the public byte budget was reached.
        upstreamAbort.abort(new Error('SSE response finished'));
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      ...(navigationSetCookie ? { 'Set-Cookie': navigationSetCookie } : {}),
    },
  });
}
