// /api/agent/chat 契约测试(tech/24 §7,参照 tests/api-hardening.test.mjs 模式)。
// route.ts 使用 next/server + `@/` 别名(node:test 无法直接 import),沿用
// readFileSync + 正则断言守卫路径与常量;行为逻辑(限流/校验/SSE 转述)由
// route 源码内联实现 + 本文件锚定关键契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterPublicSseEvent, SSE_EVENT_TYPES } from '../src/lib/agent/public-sse.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const route = readFileSync(join(srcRoot, 'app/api/agent/chat/route.ts'), 'utf8');

function lineOf(idx) {
  return route.slice(0, idx).split('\n').length;
}

test('runtime = nodejs(显式)', () => {
  assert.match(route, /export const runtime = 'nodejs'/);
});

test('SSE 响应常量:headers 三件套 + ReadableStream/TextEncoder + data 行格式', () => {
  assert.match(route, /'Content-Type': 'text\/event-stream; charset=utf-8'/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /'X-Accel-Buffering': 'no'/);
  assert.match(route, /new ReadableStream/);
  assert.match(route, /new TextEncoder/);
  assert.match(route, /data: \$\{JSON\.stringify\(event\)\}/);
  assert.match(route, /\\n\\n/);
});

test('事件 type 白名单:5 种(delta/tool/action/done/error),网络边界过滤 reasoning', () => {
  assert.deepEqual(SSE_EVENT_TYPES, ['delta', 'tool', 'action', 'done', 'error']);
  assert.doesNotMatch(route, /const SSE_EVENT_TYPES =/);
  assert.match(route, /const publicEvent = filterPublicSseEvent\(event\)/);
  assert.match(route, /if \(!publicEvent\) continue/);
  // 端点只转述公开事件;自身唯一主动下发的事件是 done truncated
  assert.match(route, /\{ type: 'done', truncated: true \}/);
  // 流异常兜底只发安全码 ERROR
  assert.match(route, /\{ type: 'error', code: 'ERROR', message: '' \}/);
});

test('SSE 网络边界:reasoning 不出流,合法事件仍可逐事件流式转述', () => {
  const allowed = [
    { type: 'delta', text: '回答' },
    { type: 'tool', name: 'search', status: 'start' },
    { type: 'action', action: { type: 'search', payload: { query: '杭州' } } },
    { type: 'done' },
    { type: 'error', code: 'ERROR', message: '' },
  ];
  for (const event of allowed) assert.deepEqual(filterPublicSseEvent(event), event);
  assert.equal(filterPublicSseEvent({ type: 'reasoning', text: '内部推理' }), null);
});

test('前置校验先于任何 MCP/LLM 连接(行号定位)', () => {
  const markers = ["'BODY_TOO_LARGE'", "'BAD_MESSAGES'", "'BAD_VIEWPORT'", "'RATE_LIMITED'", "'LLM_UNCONFIGURED'", 'status: 400', 'status: 503'];
  const connMarkers = ['getMcpProvider(', 'runAgent('];
  for (const m of markers) {
    const i = route.indexOf(m);
    assert.ok(i !== -1, `校验标记 ${m} 必须存在`);
    for (const c of connMarkers) {
      const j = route.indexOf(c);
      assert.ok(j !== -1, `连接标记 ${c} 必须存在`);
      assert.ok(i < j, `校验 ${m} (行 ${lineOf(i)}) 必须先于连接 ${c} (行 ${lineOf(j)})`);
    }
  }
});

test('校验顺序契约:body 大小 < messages < viewport < LLM 配置', () => {
  const order = ["'BODY_TOO_LARGE'", "'BAD_MESSAGES'", "'BAD_VIEWPORT'", "'LLM_UNCONFIGURED'"];
  const idxs = order.map((m) => route.indexOf(m));
  for (let i = 1; i < idxs.length; i++) {
    assert.ok(idxs[i - 1] !== -1 && idxs[i] !== -1 && idxs[i - 1] < idxs[i], `${order[i - 1]} 必须在 ${order[i]} 之前`);
  }
});

test('限流:模块级内存令牌桶 10 req/min,超限 429 RATE_LIMITED', () => {
  assert.match(route, /const RATE_LIMIT_PER_MIN = 10/);
  assert.match(route, /import \{ BoundedRateStore \} from '@\/lib\/bounded-rate-store'/);
  assert.match(route, /const RATE_BUCKET_CAPACITY = 10_000/);
  assert.match(route, /const buckets = new BoundedRateStore<\{ tokens: number; last: number \}>\(RATE_BUCKET_CAPACITY\)/);
  assert.match(route, /buckets\.set\(key, b, RATE_BUCKET_TTL_MS, now\)/);
  assert.match(route, /status: 429/);
  assert.match(route, /code: 'RATE_LIMITED'/);
});

test('#11 限流键:经 lib/client-ip 统一解析 — 仅可信代理(TRUSTED_PROXY_IPS)门控后才信任 XFF;否则会话指纹', () => {
  // XFF 读取与门控已抽至 lib/client-ip(quality-scan r2 #1 三路由统一);行为级
  // 契约(伪造 XFF 不换桶 / 会话指纹)在 tests/rate-limit-xff.test.mjs 直测。
  assert.match(route, /import \{[^}]*clientIpBucketKey[^}]*\} from '@\/lib\/client-ip'/);
  // 桶键派生:route 不再直接读转发头,统一经 clientIpBucketKey(request, token)
  assert.match(route, /clientIpBucketKey\(request, await readSessionToken\(\)\)/);
  // 未配置可信代理 → 指纹 = 会话 cookie 哈希(匿名无 cookie 归固定桶),见 helper
  assert.match(route, /readSessionToken\(\)/);
  // 限流仍是最前置(读 body 之前),且经 rateLimitKey 取键
  assert.match(route, /rateLimit\(await rateLimitKey\(request\)\)/);
  const rateIdx = route.indexOf('rateLimit(await rateLimitKey(request))');
  const tooLargeIdx = route.indexOf("'BODY_TOO_LARGE'");
  assert.ok(rateIdx !== -1 && tooLargeIdx !== -1 && rateIdx < tooLargeIdx, '限流必须先于 body 读取');
});

test('输入上限:body 32KB / messages 20 条 / 单条 4000 字符 / SSE 输出 200KB', () => {
  assert.match(route, /const MAX_BODY_CHARS = 32 \* 1024/);
  assert.match(route, /readJsonBody<ChatBody>\(request, MAX_BODY_CHARS\)/);
  assert.doesNotMatch(route, /await request\.text\(\)/, 'chunked bodies must be stream-bounded');
  assert.match(route, /const MAX_MESSAGES = 20/);
  assert.match(route, /const MAX_MESSAGE_CHARS = 4000/);
  assert.match(route, /const MAX_SSE_BYTES = 200 \* 1024/);
  // body 超限必须在校验阶段拦截(先于任何连接)
  const tooLargeIdx = route.indexOf("'BODY_TOO_LARGE'");
  assert.ok(tooLargeIdx < route.indexOf('getMcpProvider('));
});

test('消息形状校验:空/首条非 user/条数超限/单条超长', () => {
  assert.match(route, /msgs\.length === 0/);
  assert.match(route, /msgs\[0\]\?\.role !== 'user'/);
  assert.match(route, /msgs\.length > MAX_MESSAGES/);
  assert.match(route, /m\.content\.length > MAX_MESSAGE_CHARS/);
});

test('viewport 校验:center/zoom/bounds 非 finite → 400', () => {
  assert.match(route, /isFiniteNum\(vp\.center\?\.lng\)/);
  assert.match(route, /isFiniteNum\(vp\.center\?\.lat\)/);
  assert.match(route, /isFiniteNum\(vp\.zoom\)/);
  assert.match(route, /isFiniteNum\(vp\.bounds\.minLng\)/);
});

test('工具集构建:builtin + MCP(失败跳过) + rest 兜底 + baidu-agent-plan 门控', () => {
  assert.match(route, /builtinTools\(/);
  assert.match(route, /restFallbackTools\(\)/);
  assert.match(route, /hasBaiduAgentPlan\(\) \? baiduAgentPlanTools\(\)/);
  assert.match(route, /getMcpProvider\(id\)/);
  assert.match(route, /normalizeTool\(id, meta\)/);
  // 单个 provider listTools 失败不致命
  assert.match(route, /跳过该 provider/);
});

test('request abort/output budget 传播到 run-agent(停止/断开完整 abort 链路)', () => {
  assert.match(route, /const upstreamAbort = new AbortController\(\)/);
  assert.match(route, /request\.signal\.addEventListener\('abort', propagateRequestAbort\)/);
  assert.match(route, /signal: upstreamAbort\.signal/);
  assert.match(route, /upstreamAbort\.abort\(new Error\('SSE output budget exhausted'\)\)/);
});

test('SSE error 事件公开面脱敏:只产出 LLM_UNCONFIGURED/RATE_LIMITED/ERROR,message 置空', () => {
  // 安全集合映射存在(内部码一律收敛;LLM_UNCONFIGURED/RATE_LIMITED 前端专用码保留)
  assert.match(route, /const PUBLIC_ERROR_CODES = new Set\(\['LLM_UNCONFIGURED', 'RATE_LIMITED'\]\)/);
  // SSE 循环内 error 事件必须经 publicErrorEvent 收敛,不允许原样转述内部错误
  assert.match(route, /publicEvent\.type === 'error'/);
  assert.match(route, /out = publicErrorEvent\(publicEvent\)/);
  // 除安全集合外,SSE error 事件构造处不存在其它 code 字面量(不泄露 http_401/llm_network_error 等内部码)
  assert.doesNotMatch(route, /type: 'error', code: '(?!LLM_UNCONFIGURED|RATE_LIMITED|ERROR)[A-Za-z_0-9]+'/);
  // message 一律置空:SSE error 事件构造处不携带内部文本
  assert.doesNotMatch(route, /type: 'error'[^\n]*message: '[^']+'/);
});

test('公开面不出现内部工具名前缀字面量 / tool 事件不携带 summary(脱敏契约)', () => {
  const runAgent = readFileSync(join(srcRoot, 'lib/agent/run-agent.ts'), 'utf8');
  // 公开构造函数存在(toolKind / publicToolEvent 纯函数)
  assert.match(runAgent, /export function toolKind\(/);
  assert.match(runAgent, /export function publicToolEvent\(/);
  // tool 事件构造处:name 一律经公开构造函数(toolKind),不再直出内部工具名
  assert.doesNotMatch(runAgent, /\{ type: 'tool', name: (call|tc)\.name/);
  // tool 事件构造行不携带 summary 与供应商前缀字面量(amap__/tencent__/baidu__/rest__/builtin__)
  assert.doesNotMatch(runAgent, /type: 'tool'[^\n]*(summary|amap__|tencent__|baidu__|rest__|builtin__)/);
  // route 侧(对外转述路径)不存在供应商前缀字面量
  assert.doesNotMatch(route, /amap__|tencent__|baidu__|rest__|builtin__/);
});

test('无 console.log / 无密钥明文(secret 纪律)', () => {
  assert.doesNotMatch(route, /console\.(log|warn|info|debug)/);
  assert.doesNotMatch(route, /AMAP_WEB_KEY|TENCENT_MAP_KEY|BAIDU_MAP_AK|BAIDU_MAP_AUTH_TOKEN/);
});

test('身份读取在 MCP/LLM 连接之前(记忆注入,2026-08-22 ws-mem-a)', () => {
  const identIdx = route.indexOf('readSessionUser(');
  assert.ok(identIdx !== -1, 'route 必须调用 readSessionUser()');
  // 身份读取位于全部前置校验(最后一个标记 LLM_UNCONFIGURED)之后
  const lastCheck = Math.max(
    route.indexOf("'BODY_TOO_LARGE'"),
    route.indexOf("'BAD_MESSAGES'"),
    route.indexOf("'BAD_VIEWPORT'"),
    route.indexOf("'RATE_LIMITED'"),
    route.indexOf("'LLM_UNCONFIGURED'"),
  );
  assert.ok(lastCheck !== -1 && identIdx > lastCheck, `身份读取(行 ${lineOf(identIdx)})必须在全部前置校验(行 ${lineOf(lastCheck)})之后`);
  // 身份读取先于任何 MCP/LLM 连接(不破坏既有行序契约)
  for (const c of ['getMcpProvider(', 'runAgent(']) {
    const j = route.indexOf(c);
    assert.ok(j !== -1 && identIdx < j, `身份读取(行 ${lineOf(identIdx)})必须先于连接 ${c} (行 ${lineOf(j)})`);
  }
  // 登录后追加 memory_save 工具:经 builtin 模块导出追加,route 内无供应商前缀字面量
  assert.match(route, /memorySaveTool\(\)/);
  assert.match(route, /sessionUser \? \[memorySaveTool\(\)\] : \[\]/);
  assert.match(route, /userId: sessionUser\?\.id/);
});
