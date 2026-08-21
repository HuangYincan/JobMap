# WS-b — 后端工具层:MCP 客户端 + 三平台接入 + route(boss 派发,headless worker)

## 背景

AI Agent 功能批次 `20260821-boss-agent-feature`。ws-a(已派发)提供核心引擎:`server/src/lib/agent/{types,action-schema,config,prompts,llm-provider,run-agent}.ts`(接口以 ws-a prompt 为准,本 prompt 引用的 `AgentTool/ToolResult/AgentContext/AgentEvent/validateAction/readAgentConfig/hasBaiduAgentPlan` 均来自 ws-a)。你的任务:工具层(三平台 MCP 客户端 + 项目工具)+ `/api/agent/chat` route。

worktree: `/Users/acccan/dm-wt-agent-b`(分支 `feature/agent-backend-tools`);汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-b.md`

## 任务

### 1. `server/src/lib/agent/mcp-endpoints.ts` — 端点常量(单点校准处)

```ts
export interface McpEndpoint { url: string; transport: 'streamable' | 'sse'; auth: 'query' | 'bearer' | 'none'; authParam?: string; }
export const MCP_ENDPOINTS: Record<'amap' | 'tencent' | 'baidu', McpEndpoint | null>; // null = key 未配
```
- 高德:key=AMAP_WEB_KEY(经 `amapWebKey()` 判断)→ `https://mcp.amap.com/sse?key=<key>`,transport 'sse'(官方文档 SSE;实现期若确认有 streamable 端点可在此改)
- 腾讯:key=TENCENT_MAP_KEY → `https://mcp.map.qq.com/sse?key=<key>&format=0`,transport 'sse'(format=0 文本输出适合 LLM)
- 百度:ak=BAIDU_MAP_AK → `https://mcp.map.baidu.com/mcp?ak=<ak>`,transport 'streamable'(官方推荐);备选 `https://mcp.map.baidu.com/sse?ak=<ak>`
- auth 均为 query 参数;此文件**含真实 key 值时禁止 console.log**,只在内部拼 URL。

### 2. `server/src/lib/agent/mcp-providers.ts` — 手写零依赖 MCP 客户端(核心)

**为什么手写**:会话权限 deny `npm install*`,不能引入 @modelcontextprotocol/sdk(D5)。协议是公开标准,按以下要点实现,全部 fetch 可注入、纯逻辑可单测。

**MCP 协议要点(已核实规范,实现时按此)**:
- JSON-RPC 2.0 framing:`{jsonrpc:'2.0', id, method, params}`;id 数字自增。
- **初始化握手**:`initialize`(params:`{protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'domain-map-agent', version:'1.0.0'}}`)→ 服务器返回 `{protocolVersion, capabilities, serverInfo}`;随后发 `notifications/initialized`(id 为 null)。部分服务器容忍缺省,防御性实现:初始化失败(404/405/400)换备选 transport 重试一次。
- **legacy SSE transport(2024-11-05)**:GET 同一 URL 打开事件流(`Accept: text/event-stream`),响应头可能带 `Mcp-Session-Id`(后续请求必须回传该头);客户端 POST JSON-RPC 消息到同一 URL;响应经事件流以 `event: message` + `data: <json>` 到达,按 id 关联;**防御**:若 POST 直接返回 JSON-RPC 响应体(部分服务器实现),直接用。
- **Streamable HTTP transport(2025-06-18)**:单 POST 端点;请求头 `content-type: application/json`、`accept: application/json, text/event-stream`、`mcp-protocol-version: 2025-06-18`、`Mcp-Session-Id`(若收到过);响应可能是 application/json(直接 JSON-RPC 响应)或 text/event-stream(`event: message` 数据);initialize 响应若带 session id 头,后续请求回传。
- **tools/list**:`{method:'tools/list'}` → `result.tools[]`(name/description/inputSchema?)。
- **tools/call**:`{method:'tools/call', params:{name, arguments}}` → `result:{content:[{type:'text'|'image', text}], isError?}`(content 数组转述为纯文本)。
- 超时:connect 15s、每次 call 30s;错误只含 host 与 status,**绝不含 key**。

接口:
```ts
export interface McpProviderHandle {
  id: 'amap' | 'tencent' | 'baidu';
  isReady(): boolean;
  listTools(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>>; // 缓存,失败置 not ready
  callTool(origName: string, args: unknown): Promise<{ text: string; isError: boolean }>;
}
export function getMcpProvider(id: 'amap' | 'tencent' | 'baidu'): McpProviderHandle | null; // key 未配 → null
export function resetMcpProvidersForTest(): void;
export function normalizeTool(provider: 'amap'|'tencent'|'baidu', meta: { name: string; description?: string; inputSchema?: unknown }): { name: string; description: string; inputSchema: Record<string, unknown> };
```
`normalizeTool` 纯函数:`name = <provider>__<slug(orig)>`(slug:非 [a-z0-9_] 字符转 `_`,截断 60);description 截 500(缺失时用原 name 转述);inputSchema 缺失/非对象 → `{type:'object', properties:{}}` 兜底。实现细节:模块级单例 map、connect promise 缓存(幂等)、每 provider 3 并发信号量、失败后 `dispose()` 置空(下次请求重建重试)、请求结束**不 dispose**(进程级保活)。

### 3. `server/src/lib/agent/tools/builtin.ts` — 白名单无副作用工具
- `builtin__viewport`(回显请求带入的视野信息:center/zoom/bounds)
- `builtin__listTools`(列出当前可用工具名,不暴露 secret)

### 4. `server/src/lib/agent/tools/rest-fallback.ts` — REST 兜底(常备)
只 **import** `server/src/lib/site-geocode.ts` 的 `geocodeAddressRest` / `placeTextSearchRest` / `regeoCityRest`(签名:`(query, city='杭州', fetchImpl?)` / `(lng, lat, fetchImpl?)`,自带 AMap→百度→腾讯三级兜底,**不改该文件**):
- `rest__geocodeAddress`(参数:address, city?)、`rest__placeSearch`(query, city?)、`rest__regeo`(lng, lat)
- 输出统一转述纯文本 + 截断 3000(复用 ws-a 的 `sanitizeToolText`)。

### 5. `server/src/lib/agent/tools/baidu-agent-plan.ts` — baidu-ai-map skill 契约(env 门控)
按百度官方 skill(baidu-ai-map)契约实现,`hasBaiduAgentPlan()` 为 false 时该工具组**不注册**(导出空数组):
- 端点:`https://api.map.baidu.com/agent_plan/v1/{place|direction|geocoding|reverse_geocoding|weather}`,GET,header `Authorization: Bearer $BAIDU_MAP_AUTH_TOKEN`
- 工具:`baidu__place`(user_raw_request 必填**完整用户需求**,region 可选)、`baidu__direction`(user_raw_request 含起终点,location 可选)、`baidu__geocoding`(address)、`baidu__reverse_geocoding`(location: 'lat,lng' gcj02)、`baidu__weather`(region 与 location 至少一个)
- 契约红线:不得编造坐标;坐标至少 6 位小数;坐标/center/location 仅来自用户明确提供或可信来源;响应不裁剪(直接转述)。

### 6. `server/src/app/api/agent/chat/route.ts` — SSE 端点

```
POST /api/agent/chat
body: { messages: Array<{role:'user'|'assistant'; content:string}>, viewport?: {center:{lng,lat}, zoom:number, bounds?}, lang?: 'zh'|'en' }
```
- `export const runtime = 'nodejs'`(显式);返回 `new Response(readableStream, {headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'}})`,ReadableStream + TextEncoder,逐事件 `data: <单行 JSON>\n\n`。
- **前置校验(顺序契约,契约测试断言:校验必须发生在任何 MCP/LLM 连接之前)**:body >32KB → 400 `BODY_TOO_LARGE`;messages 空/首条非 user/条数>20/单条>4000 字符 → 400 `BAD_MESSAGES`;viewport 坐标非 finite → 400 `BAD_VIEWPORT`;`readAgentConfig()` fail → 503 `LLM_UNCONFIGURED`。
- 工具集构建(每请求):builtin + `getMcpProvider` 非 null 的 provider(单个 listTools 失败 → 跳过该 provider,不致命)+ rest 兜底 + baidu-agent-plan(门控)。
- `request.signal` → 透传 run-agent(用户停止/断开的完整 abort 链路)。
- 限流:模块级内存令牌桶,每 IP 10 req/min(超限 → 429 `RATE_LIMITED`);SSE 输出字节上限 200KB(超 → `done, truncated`)。
- **先读 `/Users/acccan/dm-wt-agent-b/server/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` 与 streaming 相关文档(Next.js 16 有 breaking changes)**。

### 7. 测试(`/Users/acccan/dm-wt-agent-b/server/tests/`)
- `agent-mcp.test.mjs` — normalizeTool 矩阵(前缀/slug/截断/兜底);key 缺失 → getMcpProvider null;mock fetchLike:streamable transport 握手→listTools→callTool 全流程(含 SSE 响应形态与 JSON 响应形态);legacy SSE transport 全流程(GET 流 + POST 关联,含 Mcp-Session-Id 回传);超时/连接失败 → isReady false;并发信号量。**用 node:test 内嵌 http server 或 mock fetchLike 均可**(node:test 文件内可用 `node:http` 建 mock 服务器,跑在 npm test 下)。
- `agent-route-contract.test.mjs` — 契约测试(参考 `tests/api-hardening.test.mjs` 模式,readFileSync 读 route.ts 源文件):`runtime = 'nodejs'`、SSE headers 常量、事件 type 白名单、**「校验先于连接」定位断言**(校验函数调用行号 < getMcpProvider/runAgent 引用行号)、限流存在。

## 文件边界

- **拥有**:`mcp-endpoints.ts`、`mcp-providers.ts`、`tools/{builtin,rest-fallback,baidu-agent-plan}.ts`、`api/agent/chat/route.ts`、2 个测试文件。
- **不碰**:`site-geocode.ts`(只 import)、`llm-validate.ts`、`map-engine/**`、`map-shell.tsx`、`hooks/*`、`layers-panel.tsx`、`i18n.ts`、`.env.example`、`tech/**`、`server/src/lib/agent/{types,action-schema,config,prompts,llm-provider,run-agent}.ts`(ws-a 拥有;你只 import)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-b/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-b && make docs-check && git diff --check
```

## 纪律

- 小步 Conventional Commits;可 `git merge dev`(ws-a 合并后自动带入核心引擎)。
- 禁止:push/切分支/rebase/npm install/npx/Env-only/改现有 UI。
- `site-geocode.ts` 含 NUL 字节,grep 用 `grep -a`。

## 回报

写 `reports/ws-b.md`(实现摘要、端点表、遇到的问题、门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
