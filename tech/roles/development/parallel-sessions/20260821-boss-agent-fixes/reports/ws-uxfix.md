# ws-uxfix 汇报(2026-08-21)

## 实际改动(4 commit,worktree `/Users/acccan/dm-wt-agent-uxfix`,分支 `feature/agent-ux-fix`,基于 dev `0052ed0`)

1. `d8823f9` `fix(agent-ui)`:重放动作改走 execute() 纯执行语义,不再回调 onAction
   - `server/src/components/agent-map-executor.ts` → 新增公开方法 `execute(action)`(validateAction 非法丢弃 → 500ms 同类型限流 → bridge.isReady → 执行 → 压 undo 栈,**不回调 onAction**);内部抽出 `executeAction(action, notify)` 供 `handleEvent` action 分支(notify=true,仍回调 onAction)与 `execute`(notify=false)共用;search 动作 execute 路径为空操作(无可执行地图副作用)
   - `server/src/components/agent-panel.tsx` → `replayAction` 改用 `executorRef.current?.execute(action)`:点按钮只执行一次地图动作,不再追加建议卡片、不再按钮翻倍
2. `6c7e38c` `feat(agent-ui)`:工具活动按公开类别显示,删除 friendlyToolName
   - `server/src/lib/i18n.ts` → **只新增** 8 键(zh/en):agentToolSearch/agentToolGeocode/agentToolDirections/agentToolWeather/agentToolProject/agentToolOther/agentToolFailed/agentRateLimited;旧键零改动
   - `server/src/components/agent-panel.tsx` → 新增 `toolCategoryName()`(name 类别 → i18n 文案,未知 → other);工具行/顶部状态条改渲染类别文案;tool 行不再渲染 summary,status=error 渲染通用「调用失败」弱提示(复用 toolSummary 样式);handleError 收敛错误 code:`LLM_UNCONFIGURED`→agentNotConfigured、`RATE_LIMITED`→agentRateLimited(新)、其余→agentError
   - `server/src/components/agent-map-executor.ts` → 删除 `friendlyToolName` 及 PROVIDER_NAMES
3. `a464211` `feat(agent-ui)`:消息按轮交替——reduceAgentEvent 纯状态机
   - **新** `server/src/lib/agent-panel-state.ts` → `reduceAgentEvent(messages, ev)` 纯函数(零 DOM):delta/reasoning 遇最后一条 assistant 消息已有 tools → 开新消息,否则追加;tool start 同轮归并、已有 tools 开新消息;tool done/error 从后往前定位「所在消息」内按 name 原位更新 start 项(找不到则挂到最后一条 assistant);action 追加到最终轮 actions;done/error 事件透传不拆消息;用户消息不进状态机
   - `server/src/components/agent-panel.tsx` → handleDelta/handleReasoning/handleTool/handleAction 改薄包装走 reducer;单条 assistant 消息渲染顺序改为 **思考折叠块 → 文本气泡 → 工具活动列表(从气泡上方移到下方)→ 动作按钮**(轮序=消息序,视觉即「文本1、工具1、文本2、工具2…」);AgentMessage/ToolActivity 类型迁至新 lib 并 re-export 保持模块表面稳定
   - `server/src/components/agent-panel.module.css` → 仅注释同步(无样式变更)
4. `b9e5d50` `fix(agent-ui)`:agent 定位点显眼
   - `server/src/lib/agent-map-bridge.ts` → addMarkers 每个点一律自定义 content,不再用引擎默认样式:20px `#007AFF` 圆点 + 2.5px 白边 + `box-shadow:0 2px 10px rgba(0,122,255,0.45)`(与 map-shell 距离手柄同款蓝);有 label 时蓝底白字 99px 圆角标签 flex column 叠在圆点上方(gap 2px),label 继续 escapeHtml

## 测试改动

- **新** `server/tests/agent-panel-state.test.mjs`(8 测试):单轮文本+工具同消息(done 原位更新)、两轮拆两条消息、tool start 拆轮 + 跨消息顺序 done 归位、tool error 原位更新 + 找不到 start 兜底、action 追加到最终轮(含无 assistant 新建)、reasoning 归属(先于本轮 delta、工具后开新轮)、用户消息不拆、done/error 透传不改引用
- `server/tests/agent-map-executor.test.mjs`:新增 execute() 不回调 onAction/限流(与 handleEvent 共享限流窗口)/非法丢弃/未就绪错误回调/search 空操作 + handleEvent(action) 仍回调 onAction 断言;删除 friendlyToolName 测试
- `server/tests/component-contracts.test.mjs`:工具行契约改 `toolCategoryName(toolItem.name, lang)`、`doesNotMatch toolItem.summary`、新增「工具列表在气泡下方」顺序断言与 reduceAgentEvent 引用断言

## 门禁结果

- npm test:**988 通过 / 0 失败**(2 skip,既有;全量 `node --test tests/*.test.mjs`)
- typecheck:通过(`tsc --noEmit` 无输出)
- docs-check:通过(Documentation policy check passed.)
- git diff --check:通过(无空白错误)

## 遇到的问题

- tool done/error 的作用域:按 prompt「所在消息内按 name 原位更新」实现为从后往前定位含对应 start 项的消息(比仅看最后一条更稳——两条工具 start 连续到达时 done 仍能归位到自己的消息),找不到 start 才挂到最后一条 assistant 消息(保留既有兜底语义);已用「跨消息顺序到达」测试锁定该行为
- 用户消息不进 reducer(非 AgentEvent):面板 send() 原样追加数组,测试以「面板追加用户消息后事件开新消息」模拟,未改动 send()
- 无其他问题;「不碰」清单零改动(后端 agent 目录、chat-client、ball、map-shell、map-engine 均未触碰;i18n 仅新增键)

## 证据

- 门禁输出摘要见上;全量测试输出:`/Users/acccan/.claude/projects/-Users-acccan-dm-wt-agent-uxfix/0d9623e6-3e54-4f2b-9434-f651cdd9aa33/tool-results/`(b7mg6gmu2.txt 为最终门禁运行)
- 提交序列:`0052ed0 → d8823f9 → 6c7e38c → a464211 → b9e5d50`(worktree 干净,未 merge 未 push)

门禁: PASSED
结论: OK
