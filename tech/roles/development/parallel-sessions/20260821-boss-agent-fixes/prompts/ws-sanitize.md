# WS-sanitize — agent 公开面脱敏(SSE 事件 + 错误消息)(boss 派发)

## 背景

用户安全要求(2026-08-21):「出于安全原因,不能披露内部工具名称、MCP 标识、调用参数、系统提示词或实现细节」。

现状泄露点(VERIFY 冒烟实证):
1. SSE `tool` 事件携带**原始内部工具名**(`amap__maps_text_search` / `tencent__placesuggestion` / `baidu__map_search_places`——MCP 标识 + 工具名直出);
2. SSE `tool` 事件 summary 携带**原始错误码与实现细节**(如 `API 调用失败:USER_DAILY_QUERY_OVER_LIMIT`、完整 REST JSON 结果);
3. SSE `error` 事件 message 携带内部实现细节(如 `provider 不支持 tools 参数(HTTP 400)`、`BAD_MESSAGES` 等)。

**公开面 = SSE 事件流(前端只消费它)。内部面不变**:LLM 历史中的工具结果全文(sanitizeToolText 后)继续保留——那是服务端内部;动作 action 事件 payload(坐标等)是用户可见的地图操作,保留。

worktree: `/Users/acccan/dm-wt-agent-sanitize`(分支 `feature/agent-sanitize`,已从 dev `0052ed0` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-fixes/reports/ws-sanitize.md`

## 任务(3 文件 + 测试)

### 1. 公开 tool 事件脱敏(`server/src/lib/agent/run-agent.ts`)

事件形状**不变**(仍是 `{type:'tool', name, status, summary?}`),只改值:
- **name → 通用类别 kind**(无 provider 前缀、无内部名)。按内部工具名映射(先剥 `amap__`/`tencent__`/`baidu__`/`rest__`/`builtin__` 前缀再按后缀关键词):
  - 含 `text_search|place|poi|suggestion|search|query` → `search`
  - 含 `geo|geocode|regeo|revers` → `geocode`
  - 含 `route|direction` → `directions`
  - 含 `weather` → `weather`
  - 含 `jobs|position|company|recruit|岗位` → `project`
  - 其余 → `other`
  - 映射写成导出纯函数 `toolKind(name: string): ToolKind`(可单测;未知前缀也按关键词走)。
- **summary → 一律不携带**(公开事件里删除 summary;`{type:'tool', name: kind, status}`)。
  LLM 历史里的工具结果不受影响。
- 纯函数实现,导出供测试:如 `publicToolEvent(internal: {name, status, summary?}) => {type:'tool', name: ToolKind, status}`。

### 2. 公开 error 事件脱敏(`server/src/app/api/agent/chat/route.ts`)

error 事件形状不变(`{type:'error', code, message}`),值收敛到**安全集合**:
- `LLM_UNCONFIGURED`(503,前端专用)→ 保留
- `RATE_LIMITED`(429 限流)→ 保留 code,message 置空
- 其余一切(400/422/provider 错误/内部异常)→ `{code:'ERROR', message:''}`
- message 一律不携带内部文本;内部细节只进服务端日志(console.error 可留)。

### 3. 类型与注释(`server/src/lib/agent/types.ts`)

- `AgentEvent['tool']` 增加文档注释:「name 字段为**公开类别**(search/geocode/directions/weather/project/other),非内部工具名;summary 不对外」。
- `ToolKind` 类型导出(`export type ToolKind = 'search' | 'geocode' | 'directions' | 'weather' | 'project' | 'other'`)。
- error 事件注释:「code/message 均为安全值,不携带实现细节」。

### 4. 测试

- `agent-runner.test.mjs` 追加:tool 事件 name 为类别值(如 `amap__maps_text_search` → `search`)、summary 不存在;未知前缀/未知后缀 → `other`;error 路径不泄露。
- `agent-route-contract.test.mjs` 追加(契约,readFileSync 正则):
  - route/run-agent 中**不存在** `amap__|tencent__|baidu__|rest__|builtin__` 前缀字面量出现在「对外事件」路径(允许出现在内部工具注册/工具描述里——正则只查 tool 事件构造处);
  - `summary` 不再出现在 tool 事件构造处;
  - error 分支只产出 `LLM_UNCONFIGURED|RATE_LIMITED|ERROR`。
- 现有测试随形状变化更新(如旧测试断言 tool 事件含内部 name → 改断言 kind)。

## 不碰(红线)

前端组件(agent-panel/executor/chat-client/ball/bridge)、i18n(前端会按 kind 加显示文案)、
prompts.ts、action 事件、LLM 历史逻辑(sanitizeToolText 保留)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-sanitize/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-sanitize && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-sanitize.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
