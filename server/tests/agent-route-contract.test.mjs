// /api/agent/chat 契约测试(tech/24 §7,参照 tests/api-hardening.test.mjs 模式)。
// route.ts 使用 next/server + `@/` 别名(node:test 无法直接 import),沿用
// readFileSync + 正则断言守卫路径与常量;行为逻辑(限流/校验/SSE 转述)由
// route 源码内联实现 + 本文件锚定关键契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('事件 type 白名单:5 种(delta/tool/action/done/error)', () => {
  assert.match(route, /const SSE_EVENT_TYPES = \['delta', 'tool', 'action', 'done', 'error'\] as const/);
  // 端点只转述 run-agent 事件;自身唯一主动下发的事件是 done truncated
  assert.match(route, /\{ type: 'done', truncated: true \}/);
  assert.match(route, /type: 'error', code: 'internal'/);
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

test('限流:模块级内存令牌桶,每 IP 10 req/min,超限 429 RATE_LIMITED', () => {
  assert.match(route, /const RATE_LIMIT_PER_MIN = 10/);
  assert.match(route, /const buckets = new Map<string, \{ tokens: number; last: number \}>\(\)/);
  assert.match(route, /status: 429/);
  assert.match(route, /code: 'RATE_LIMITED'/);
  assert.match(route, /x-forwarded-for/);
});

test('输入上限:body 32KB / messages 20 条 / 单条 4000 字符 / SSE 输出 200KB', () => {
  assert.match(route, /const MAX_BODY_CHARS = 32 \* 1024/);
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

test('request.signal 透传 run-agent(停止/断开完整 abort 链路)', () => {
  assert.match(route, /signal: request\.signal/);
  assert.match(route, /request\.signal\.aborted/);
});

test('无 console.log / 无密钥明文(secret 纪律)', () => {
  assert.doesNotMatch(route, /console\./);
  assert.doesNotMatch(route, /AMAP_WEB_KEY|TENCENT_MAP_KEY|BAIDU_MAP_AK|BAIDU_MAP_AUTH_TOKEN/);
});
