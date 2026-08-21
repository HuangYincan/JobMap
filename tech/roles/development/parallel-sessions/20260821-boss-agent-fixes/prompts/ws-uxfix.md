# WS-uxfix — agent 前端 UX 修复:按轮交替输出 + 重放不再重复 + 定位点显眼(boss 派发)

## 背景

用户反馈(2026-08-21,三条):

1. **tag 点击后重复在地图上定位**:面板消息底部每个动作按钮(如「标记 2 个地点」「在地图上定位」)点击 = `replayAction`
   → `executor.handleEvent({type:'action'})` → `handleAction` **执行动作(地图重复定位)+ 回调 onAction → 面板又追加一个相同按钮**。
   每次点击按钮翻倍 + 地图反复跳。根因在 `server/src/components/agent-panel.tsx` 的 `replayAction` 与
   `server/src/components/agent-map-executor.ts` 的 `handleAction`(onAction 只应响应**流式** action 事件,不应响应重放)。
2. **输出格式**:目前一轮会话所有文本累积进一条消息、所有工具活动累积进同一个列表 → 显示成「先全部文本、后全部工具」。
   要求**按轮交替**:文本1、工具1、文本2、工具2、文本3…(服务端事件本来就是轮序:reasoning→delta→tool→…,前端把每轮拆成独立消息即可)。
3. **定位点太不显眼(白色易与地图混杂)**:`server/src/lib/agent-map-bridge.ts` 的 `addMarkers` 无 label 时用引擎默认样式、有 label 时白底标签。
   参照 `map-shell.tsx` 距离手柄的既有蓝色样式(`background:#007AFF;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,122,255,0.35)`),agent 定位点必须显眼可辨。

**并行批次提示**:ws-sanitize(后端公开面脱敏)同时在进行——SSE `tool` 事件的 `name` 字段值将变为**公开类别**
(`search`/`geocode`/`directions`/`weather`/`project`/`other`),summary 不再携带,error 的 code 收敛为
`LLM_UNCONFIGURED|RATE_LIMITED|ERROR`(message 置空)。**事件形状不变**,前端按新语义消费即可:
`ev.name` 现在是类别 → 渲染时映射 i18n 文案;tool 行不再显示 summary;error 按安全 code 集渲染。
本分支按此契约开发(sanitize 会先于本分支合并,dev 上无形状变化,typecheck 天然一致)。

worktree: `/Users/acccan/dm-wt-agent-uxfix`(分支 `feature/agent-ux-fix`,已从 dev `0052ed0` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-fixes/reports/ws-uxfix.md`

## 任务(4 文件 + 1 新 lib + 测试)

### 1. 重放不再重复(agent-map-executor.ts + agent-panel.tsx)

- 执行器新增公开方法 `execute(action: AgentAction): void`(纯执行语义):
  `validateAction`(非法丢弃)→ 500ms 同类型限流 → `bridge.isReady()` → 执行 → 压 undo 栈,
  **不回调 onAction**(与 handleEvent 的 action 分支共用实现;handleEvent 分支 = execute + onAction)。
- 面板 `replayAction` 改用 `executorRef.current?.execute(action)`,不再 handleEvent。
- 效果:点按钮只执行一次动作(地图定位一次),不再追加按钮、不再翻倍。

### 2. 按轮交替输出(agent-panel.tsx,抽纯函数)

把消息状态机抽成纯函数放 `server/src/lib/agent-panel-state.ts`(零 DOM,可单测),面板 setMessages 改走它:

```
reduceAgentEvent(messages: AgentMessage[], ev: AgentEvent): AgentMessage[]
```

- **轮边界规则**(assistant 消息按轮拆分,用户消息原样追加):
  - `delta`:若最后一条 assistant 消息**已有 tools** → 开新 assistant 消息(内容=text);否则追加到最后的 assistant 消息。
  - `reasoning`:同 delta 规则(若最后的 assistant 消息已有 tools → 开新消息装 reasoning;否则追加)——reasoning 总在其轮的 delta 之前。
  - `tool`:status='start' 且最后一条 assistant 消息**已有 tools** → 开新消息装 tools;否则挂到最后的 assistant 消息(没有 assistant 消息则新建);
    status='done'/'error' → 在所在消息内**原位更新**对应的 start 项(按同一消息内 name 匹配,现有逻辑,但作用域改为当前消息)。
  - `action`:追加到最后一条 assistant 消息的 actions(没有则新建)——最终轮的文本+动作同消息。
  - `done`/`error`:透传标记,不拆消息。
- **渲染顺序**(agent-panel.tsx JSX,单条 assistant 消息内):思考折叠块 → 文本气泡 → 工具活动列表(从气泡上方移到下方)→ 动作按钮。
  轮序即消息序,视觉上就是「文本1、工具1、文本2、工具2、文本3…」。
- 面板中 `handleDelta/handleReasoning/handleTool/handleAction` 改为薄包装调用 `reduceAgentEvent`(经 setMessages(prev => …));
  tool 顶部状态条逻辑保留(基于最新 tool 事件)。

### 3. 工具活动按类别显示(agent-panel.tsx + agent-map-executor.ts + i18n.ts)

- `ev.name` 现为类别(search/geocode/directions/weather/project/other):
  - 新增 i18n 键 `agentToolSearch/agentToolGeocode/agentToolDirections/agentToolWeather/agentToolProject/agentToolOther`(zh/en);
  - 工具行/顶部状态条改渲染类别文案(如 zh:「搜索地点」「地理编码」「路线规划」「天气查询」「项目数据」「其他操作」;en 对应),
    不再显示内部名;**删除 `friendlyToolName` 及其 PROVIDER_NAMES**(同时删 executor 里对它的引用与相关测试);
  - tool 行不再渲染 summary(公开事件已不携带;status 失败时渲染通用「调用失败」弱提示,可复用现有样式)。
- 错误提示:error code 安全集 `LLM_UNCONFIGURED`(现有 agentNotConfigured)/`RATE_LIMITED`(新增 i18n agentRateLimited)/`ERROR`(现有 agentError)。

### 4. 定位点显眼(agent-map-bridge.ts)

`addMarkers` 每个点**一律**渲染自定义 content(不再用引擎默认样式):
- 圆点:`<div style="width:20px;height:20px;border-radius:50%;background:#007AFF;border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,122,255,0.45)"></div>`(与距离手柄一致的蓝 + 白边 + 蓝影);
- 有 label 时在圆点上方叠加蓝底白字标签(`background:#007AFF;color:#fff;border-radius:99px;padding:2px 10px;font-size:12px;box-shadow:…;transform:translateY(-30px)`),label 继续 escapeHtml;
- 圆点与标签组合为单条 content(布局:标签在上、圆点在下,可用 flex column + align-items:center,或沿用 translateY 叠加)。

### 5. 测试

- 新文件 `server/tests/agent-panel-state.test.mjs`:`reduceAgentEvent` 纯函数矩阵——
  单轮文本+工具同消息;两轮文本+工具拆两条消息;tool start 拆轮/done 原位更新;action 追加到最终轮;
  reasoning 归属正确;用户消息不拆。
- `agent-map-executor.test.mjs` 追加:`execute()` 不回调 onAction、限流生效、非法丢弃;`handleEvent(action)` 仍回调 onAction。
- `agent-panel-placement` 不涉及;`component-contracts` 若引用 friendlyToolName/工具行结构 → 同步更新。

## 不碰(红线)

后端 agent(types/run-agent/route/llm-provider/mcp-*/tools/*——脱敏由 ws-sanitize 负责)、
chat-client、ball、map-shell、map-engine/**。i18n 只加新键不改旧键。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-uxfix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-uxfix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-uxfix.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
