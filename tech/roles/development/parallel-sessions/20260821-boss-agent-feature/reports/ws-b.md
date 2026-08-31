# ws-b 汇报(2026-08-21)

WS-b — 后端工具层:MCP 客户端 + 三平台接入 + `/api/agent/chat` route。
worktree `/Users/acccan/dm-wt-agent-b`(分支 `feature/agent-backend-tools`),4 个 commit 叠在已并入的 ws-a 核心引擎之上。

## 实际改动(全部为新建,零改动既有文件)

| 文件 | 职责 |
|---|---|
| `server/src/lib/agent/mcp-endpoints.ts` | 三平台 MCP 端点常量(单点校准)。key 经 `amapWebKey()/tencentWebKey()/baiduWebKey()`(site-geocode.ts getter)惰性求值——用 getter 使 `MCP_ENDPOINTS` 保持 `Record<…, McpEndpoint\|null>` 形状同时可被测试 env 注入/还原驱动;null = key 未配。百度带 `fallbackUrl`(sse 备选)。文件零 console。 |
| `server/src/lib/agent/mcp-providers.ts` | 手写零依赖 MCP 客户端(核心,819 行):JSON-RPC 2.0 framing + id 自增;`initialize` 握手(`2025-06-18`)→ `notifications/initialized`(fire-and-forget);**legacy SSE transport**(GET 事件流 + POST 按 id 关联 + `Mcp-Session-Id` 回传 + 防御 POST 直返 JSON)+ **Streamable HTTP transport**(JSON / text/event-stream 双响应形态 + session 头回传);connect 15s / call 30s 超时;每 provider 3 并发信号量;失败 dispose 置空、下次请求重建重试;请求结束不 dispose(进程级保活);错误只含 host 与 status 绝不含 key;fetch 可注入。导出 `getMcpProvider` / `resetMcpProvidersForTest` / `normalizeTool`。 |
| `server/src/lib/agent/tools/builtin.ts` | `builtin__viewport`(回显 center/zoom/bounds)+ `builtin__listTools`(工厂注入 getter 读当前工具名,不暴露 secret)。 |
| `server/src/lib/agent/tools/rest-fallback.ts` | `rest__geocodeAddress` / `rest__placeSearch` / `rest__regeo`,只 import `site-geocode.ts` 三个 REST 函数(自带 AMap→百度→腾讯三级兜底,该文件零改动);输出统一转述纯文本 + `sanitizeToolText` 截断 3000(复用 ws-a);fetchImpl 可注入。 |
| `server/src/lib/agent/tools/baidu-agent-plan.ts` | baidu-ai-map skill 契约:5 工具(`baidu__place`/`direction`/`geocoding`/`reverse_geocoding`/`weather`),GET `api.map.baidu.com/agent_plan/v1/{…}` + `Authorization: Bearer`;`hasBaiduAgentPlan()` false → 导出空数组;必填/坐标格式校验(`lat,lng` 有限数);**响应不裁剪直接转述**;错误不含 token。 |
| `server/src/app/api/agent/chat/route.ts` | SSE 端点:`export const runtime = 'nodejs'`;校验顺序契约(限流 10 req/min 令牌桶 → body 32KB → messages 1..20/首条 user/单条 ≤4000 → viewport finite → LLM 配置 503)全部在 MCP/LLM 连接之前(工具集构建内联在 POST 内,保证源码行序 = 执行序);每请求构建工具集(builtin + 三平台 MCP 单 provider 失败跳过 + rest 兜底 + baidu 门控);ReadableStream + TextEncoder 逐事件 `data: <单行 JSON>\n\n`;SSE 输出 200KB 上限超 → `done, truncated`;`request.signal` 透传 run-agent 完整 abort 链路。 |
| `server/tests/agent-mcp.test.mjs` | 16 个用例:normalizeTool 矩阵;key 门控;streamable 全流程(JSON + SSE 双形态 + session 回传 + 缓存);legacy SSE 全流程(GET 流 + POST 关联 + 直返 JSON 防御);网络/500/超时 → isReady false 且错误不含 key;404 换备选 transport;abort 短路零请求;3 并发信号量;失败 dispose 重建。 |
| `server/tests/agent-route-contract.test.mjs` | 12 个契约用例(readFileSync 模式):runtime/SSE headers 三件套/事件 type 白名单/**「校验先于连接」行号定位断言**(5 个校验标记 < `getMcpProvider(`/`runAgent(`)+ 校验彼此顺序/限流/输入上限/无 console 无密钥。 |
| `server/tests/agent-tools.test.mjs` | 10 个用例:builtin 回显与工具列表;rest 三级兜底成功/失败/空结果/3000 截断;baidu skill 门控/Bearer 契约/响应不裁剪/token 不泄漏。 |

## 端点表(实现值)

| provider | transport | 端点(拼接规则) | auth | 备选 |
|---|---|---|---|---|
| amap | sse | `https://mcp.amap.com/sse?key=<AMAP_WEB_KEY>` | query `key` | 无 |
| tencent | sse | `https://mcp.map.qq.com/sse?key=<TENCENT_MAP_KEY>&format=0` | query `key` | 无 |
| baidu | streamable | `https://mcp.map.baidu.com/mcp?ak=<BAIDU_MAP_AK>` | query `ak` | `https://mcp.map.baidu.com/sse?ak=<ak>`(初始化 404/405/400 时自动换) |

## 门禁结果

- `npm test`(server):**854 通过 / 0 失败 / 2 skip**(基线 568 + ws-a 并入后新增 + 本 WS 38 个新用例全绿,零漂移)
- `npm run typecheck`(server):通过
- `make docs-check`(worktree 根):Documentation policy check passed
- `git diff --check`:通过

## 遇到的问题(均已解决)

1. **Node strip-only 模式不支持 TS parameter property**(`constructor(readonly code: number)`)→ 全部改为显式字段声明(ws-a 文件无此问题,纯属性声明)。教训:本仓库 `node --test` 直接跑 `.ts`,任何新 TS 文件禁用 parameter properties。
2. **legacy SSE 响应竞态**:mock/真实服务器可在 `waitFor` 注册 pending 之前把响应 push 进事件流 → 响应被丢 → connect 超时。修复:transport.request **先注册 pending 再发 POST**,直返 JSON 路径 `waiter.cancel()`。
3. **外部 abort 信号未穿透 connect 阶段**:`callTool(signal)` 里 `doConnect` 的 initialize 不带 signal → 已 abort 的请求仍会发起连接。修复:`connect(signal?)` 透传 initialize。
4. 测试期望笔误(中文 slug 下划线计数、`headers.accept` 大小写、字符串字面量内写 `.repeat()`)— 均为测试自身 bug,已修正。

## 证据

- 分支 tip:`4ab3223 test(agent): MCP 客户端 / route 契约 / 工具层单测`(4 个 commit,工作树干净)
- route 校验-连接行号实证:校验标记 L85–135 < `getMcpProvider(` L148 < `runAgent(` L204
- 测试输出摘要:`ℹ tests 854 / pass 852 / fail 0 / skipped 2`

门禁: PASSED
结论: OK
