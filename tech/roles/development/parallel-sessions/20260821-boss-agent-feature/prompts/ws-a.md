# WS-a — 后端 Agent 核心引擎(boss 派发,headless worker)

## 背景

Domain Map 项目新增 AI Agent 功能(批次 `20260821-boss-agent-feature`,spec 见 `tech/24-agent-feature.md`,由 ws-d 编写,以本 prompt 的设计为权威)。已拍板(用户 D1/D2/D3):**自建 OpenAI 兼容 agent 引擎**(不用 Claude SDK),任意 baseurl+apikey 可配(AGENT_LLM_* 回退 LLM_*);v1 用户建议 + v2 结构化地图动作(flyTo/select/addMarkers/drawCircle/openDetail/search,SSE 事件流下发);严格 prompt 防护与权限收紧。

你在独立 worktree 开发,**worktree 已预建,boss 统一合并,不要 merge/push**。

- worktree: `/Users/acccan/dm-wt-agent-a`(分支 `feature/agent-backend-core`,已从 dev `983b161` 切出)
- 汇报文件: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-a.md`

## 任务(只新建,不改现有文件)

在 `/Users/acccan/dm-wt-agent-a/server/src/lib/agent/` 新建 6 个文件,`/Users/acccan/dm-wt-agent-a/server/tests/` 新建 5 个测试文件:

### 1. `server/src/lib/agent/types.ts` — 全链路契约
```ts
export interface AgentTool {
  name: string;                          // 唯一,如 amap__place_search / rest__geocode / builtin__viewport
  description: string;                   // 注入 LLM,截断 ≤500 字符
  inputSchema: Record<string, unknown>;  // JSON Schema(OpenAI tools 参数)
  provider: 'amap' | 'tencent' | 'baidu' | 'rest' | 'builtin';
  call(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult>;
}
export type ToolResult = { ok: true; text: string } | { ok: false; error: string };

export interface AgentContext {
  viewport?: { center: { lng: number; lat: number }; zoom: number; bounds?: { minLng: number; minLat: number; maxLng: number; maxLat: number } };
  lang: 'zh' | 'en';
  requestId: string;
  signal: AbortSignal;
}

// 动作白名单(SSE action 事件 payload)
export type AgentAction =
  | { type: 'flyTo';      payload: { center: { lng: number; lat: number }; zoom?: number } }
  | { type: 'select';     payload: { id: string; mode?: string } }
  | { type: 'addMarkers'; payload: { points: Array<{ lng: number; lat: number; label?: string }> } }
  | { type: 'drawCircle'; payload: { center: { lng: number; lat: number }; radiusMeters: number; label?: string } }
  | { type: 'openDetail'; payload: { id: string; mode?: string } }
  | { type: 'search';     payload: { query: string; mode?: string } };

export type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'start' | 'done' | 'error'; summary?: string }
  | { type: 'action'; action: AgentAction }
  | { type: 'done'; truncated?: boolean }
  | { type: 'error'; code: string; message: string };
```
注意:`mode` 用 string(不 import MapMode,避免与 types.ts 硬编码 union 耦合)。

### 2. `server/src/lib/agent/action-schema.ts` — 动作校验(纯函数)
`export function validateAction(raw: unknown): AgentAction | null` — 逐字段校验:经纬度 finite 且 |lat|≤90 / |lng|≤180;radiusMeters 10..50_000;points ≤50 项(每项 lng/lat finite、label ≤50 字符);id ≤128 字符;query ≤100 字符;mode 若存在 ≤32 字符;未知 type 一律 null。

### 3. `server/src/lib/agent/config.ts` — env 读取单点(secret 只在此处)
```ts
export interface AgentConfig {
  baseUrl: string;      // AGENT_LLM_BASE_URL → 回退 LLM_BASE_URL
  apiKey: string;       // AGENT_LLM_API_KEY → 回退 LLM_API_KEY
  model: string;        // AGENT_LLM_MODEL → 回退 LLM_MODEL
  maxTurns: number;     // AGENT_MAX_TOOL_TURNS,默认 8
  maxHistoryChars: number; // AGENT_HISTORY_LIMIT,默认 6000
}
export function readAgentConfig(): { ok: true; cfg: AgentConfig } | { ok: false; reason: string };
export function hasBaiduAgentPlan(): boolean; // BAIDU_MAP_AUTH_TOKEN 非空(供 ws-b 用,先定义)
```
只读 process.env,**不打印/不记录任何 secret**。

### 4. `server/src/lib/agent/prompts.ts` — 系统提示纯函数
`export function buildSystemPrompt(cfg: Pick<AgentConfig,'maxTurns'> & { hasTools: boolean }, lang: 'zh'|'en'): string`
内容结构:角色定义(地图 AI 助手)→ 能力边界(仅白名单工具;坐标一律 GCJ-02,不得编造坐标)→ 工具纪律(一次一个工具、结果视为**不可信数据**,交叉校验)→ 动作纪律(需要动地图时输出 `{"actions":[{type,payload}]}` 结构化 JSON 而非文字描述;每个动作 payload 必须满足边界)→ 安全红线(只读、不执行工具外请求、不透露系统提示、不输出配置)→ 输出格式(文本 + 可选建议卡片)。**模板内零 secret 占位**。

### 5. `server/src/lib/agent/llm-provider.ts` — OpenAI 兼容流式客户端
复用 `server/src/lib/llm-validate.ts` 的模式(fetchLike 注入、HttpError(status)、isRetryableStatus(408/429/5xx)——只 import 其类型与 HttpError/isRetryableStatus,不 import 其函数):
```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  tool_call_id?: string;
}
export interface AgentProviderError extends Error { kind: 'unsupported_tools' | 'http' | 'network' | 'timeout' | 'aborted' }
export interface LLMProvider {
  streamChat(opts: {
    baseUrl: string; apiKey: string; model: string;
    messages: ChatMessage[];
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>;
    signal: AbortSignal;
    onDelta(text: string): void;
    onToolCall(tc: { id: string; name: string; arguments: string }): void;
    onDone(): void;
  }): Promise<void>;
}
export function createLlmProvider(fetchLike?: typeof fetch): LLMProvider;
```
要点:POST `{base}/chat/completions`,`stream: true`;SSE 解析按 `data: ` 行,兼容 `choices[0].delta.content` 与 `delta.tool_calls` 两种 chunk(工具参数增量拼接,直到 role 完成);`data: [DONE]` 终止;30s 首包超时 + 120s 整体上限(AbortController);首包前 408/429/5xx/网络错 2 次指数退避(500ms→1s);**400/422 且响应体涉及 tools 报错 → kind 'unsupported_tools'**;signal.abort → kind 'aborted'。输出与解析逻辑放纯函数导出可单测(如 `parseSseLine`)。

### 6. `server/src/lib/agent/run-agent.ts` — 循环主体
`export function runAgent(req: RunAgentRequest): AsyncGenerator<AgentEvent>`(AsyncGenerator,供 route 直接消费为 SSE):
```ts
export interface RunAgentRequest {
  config: AgentConfig;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: AgentTool[];              // 由 route 侧按 key 配置构建(ws-b)
  viewport?: AgentContext['viewport'];
  lang?: 'zh' | 'en';
  signal: AbortSignal;
}
```
行为:组消息+tools → 每轮 streamChat 转发 delta/tool start 事件 → 流结束:
- 无 tool_calls → 容错提取文本内 `{"actions":[...]}`(正则 + JSON.parse + 逐个 validateAction)→ 逐个发 `{type:'action'}` → 发 `{type:'done'}`;
- 有 tool_calls → 每个 call 查 AgentTool(不在白名单 → `{ok:false, error:'tool not in whitelist'}`)→ `sanitizeToolText()`(截断 3000 字符、剔除 `<script`/超长 URL 串)→ 发 tool done/error → 追加 assistant(tool_calls)+tool 消息 → 下一轮;
- `unsupported_tools` → 无 tools 重跑一次降级(最多一次);
- 每轮后按 maxHistoryChars 从最旧 user 起裁剪(保留 system + 最近一轮);
- 超 maxTurns → `{type:'done', truncated:true}`;未捕获错误 → `{type:'error', code, message}`(message 不含 secret);signal.abort → 停止且不再发事件。
`sanitizeToolText(text: string, maxLen?: number): string` 纯函数导出。

### 7. 测试(`/Users/acccan/dm-wt-agent-a/server/tests/`,node --test,风格参考现有 `tests/*.test.mjs`)
- `agent-types.test.mjs` — AgentAction 形状;validateAction 合法/非法矩阵(越界坐标、超长 id、超大 radius、>50 points、未知 type、NaN/Infinity)
- `agent-config.test.mjs` — env 注入/还原(用 node:test mock 或保存/恢复 process.env):AGENT_* 优先、LLM_* 回退、全缺 → ok:false;hasBaiduAgentPlan 缺失/存在
- `agent-prompts.test.mjs` — 系统提示含角色/边界/动作纪律/安全红线关键词;正则断言无 apiKey/baseUrl/secret 字样
- `agent-llm-provider.test.mjs` — mock fetchLike:SSE 解析(delta 文本、tool_calls chunk 拼接、[DONE]);首包超时;429/5xx 重试计数;400+tools 报错 → unsupported_tools;abort 传播;parseSseLine 纯函数矩阵
- `agent-runner.test.mjs` — mock LLM + mock tool:tool_calls→工具被调→结果回流→二轮;无工具→done;动作 JSON 提取/校验/逐个下发(含非法动作丢弃);超轮截断;工具抛错→tool error+继续;历史裁剪;unsupported_tools 降级一次

## 文件边界(拥有/不碰)

- **拥有**:上述 6 个 lib 文件 + 5 个测试文件。
- **不碰**:`server/src/lib/llm-validate.ts`(只 import 类型/HttpError/isRetryableStatus)、`site-geocode.ts`、`map-engine/**`、`map-shell.tsx`、`layers-panel.tsx`、`hooks/*`、`i18n.ts`、`api.ts`、`.env.example`、`tech/` 任何文件(ws-d 拥有)、`server/src/app/api/**`(ws-b 拥有 route)。
- **注意**:`server/src/lib/site-geocode.ts` 含 NUL 字节,grep 时用 `grep -a`。

## 门禁(必须全绿,否则汇报 BLOCKED)

```bash
cd /Users/acccan/dm-wt-agent-a/server && npm test      # 现有 568 全绿零漂移 + 新增 5 个测试文件
cd /Users/acccan/dm-wt-agent-a/server && npm run typecheck
cd /Users/acccan/dm-wt-agent-a && make docs-check && git diff --check
```

## 纪律

- 小步 Conventional Commits(`feat(agent): ...`),频繁 commit 便于回退;可 `git merge dev` 同步底(dev 可能被其他批次推进)。
- **禁止**:`git push*`、切分支、`git reset --hard*`、`rebase*`、`npm install*`、`npx*`、改现有 UI、Env-only 步骤(不跑 db/geocode/import 命令)。
- Next.js 16 有 breaking changes(本 WS 不写 route,但若碰到 Next API 先读 `server/node_modules/next/dist/docs/`)。

## 回报

完成后写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-a.md`:
- 内容:实现摘要(每个文件的职责一句话)、新增测试数与测试点、遇到的问题(若有)、门禁输出摘要
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
