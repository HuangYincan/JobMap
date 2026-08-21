# 合并报告(2026-08-21,Round 7 + Round 8)

## 结果总览

- 成功合并: 2 个 WS — **本轮 R7:`feature/agent-trim-fix`(ws-trimfix,工具结果 sanitize 落位 + 整轮历史裁剪 + 400 分类修正)** merge `e39e69b` + **`feature/agent-snap-fix`(ws-nfix,悬浮球四向吸附 + 面板垂直锚定)** merge `bb4252a`,均已 push origin/dev。
- **追加轮 R8:`feature/agent-action-prompt`(ws-afix,prompts 内嵌完整动作契约 zh/en 逐字对齐 validateAction)** merge `5218c92`,已 push origin/dev(bb4252a..5218c92)。
- 失败/遗留: 无。
- 批次全貌: R1–R6 九个分支(ws-a / ws-d / ws-b / ws-c / ws-b-fix / ws-mcp-sdk / ws-c-enhance / ws-rfix / ws-shapefix)+ R7 两分支(ws-trimfix / ws-nfix)+ R8(ws-afix)已全部并入 dev,批次 **12/12 WS 全部并入**,dev HEAD `5218c92` 已同步 origin/dev。

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| tfix | feature/agent-trim-fix | `e39e69b`(--no-ff,4 文件 +165/-12,零冲突) | **953 tests / 951 pass / 0 fail / 2 skip**(与 ws-trimfix 汇报一致);typecheck 零错误;docs-check tracked-only 零匹配(全树仅未跟踪批次文件自匹配误报,见遗留 1);git diff --check 通过 | 无冲突(分支基 92f3e68 在 dev 历史内,ort 三向零冲突) |
| nfix | feature/agent-snap-fix | `bb4252a`(--no-ff,6 文件 +316/-37,零冲突) | **972 tests / 970 pass / 0 fail / 2 skip**(953 + nfix 新增 19 = 972,与 ws-nfix 汇报一致);typecheck 零错误;docs-check tracked-only 零匹配(同上);git diff --check 通过 | 无冲突(分支基 7f33be4 = trim-fix 合并后 dev HEAD,零交集) |
| afix | feature/agent-action-prompt | `5218c92`(--no-ff,3 文件 +57,零冲突) | **975 tests / 973 pass / 0 fail / 2 skip**(972 + afix 新增 3 = 975,与 ws-afix 汇报一致);typecheck 零错误;docs-check tracked-only 零匹配(同上);git diff --check 通过 | 无冲突(分支基 bb4252a = dev HEAD,零交集) |

合并内容核验(与各汇报一致):

- **trim-fix**:`run-agent.ts` 工具循环 ok/error 结果入 history 与 tool 事件前均经 `sanitizeToolText`(截断 3000/剔 script/剔超长 URL);`trimHistory` 重写为按整轮删除(user + assistant[tool_calls] + 其 tool 结果组),system 永不删、最近一轮永保,预算仍按 maxHistoryChars;`llm-provider.ts` 400/422 分类收窄为 `UNSUPPORTED_TOOLS_BODY`(仅「tools 参数不支持」触发降级重跑,其余含 tool 配对错误归 HttpError)。测试 +4(agent-runner 2 + agent-llm-provider 2)。
- **snap-fix**:新增 `agent-panel-placement.ts` 纯函数 `computeBallSnap`(球心最近边四向吸附,平局 左→右→上→下,正交坐标保留+clamp);`computePanelPlacement` 补可选第 4 参 `edge`(top/bottom 垂直锚定 + 翻转 + sheet 兜底 + 水平居中 clamp;left/right 强制分侧;缺省旧语义不变);`agent-ball.tsx` 松手吸附走新纯函数,localStorage 持久化格式扩展并向后兼容;`agent-panel.tsx` 新增 `snapEdge` prop;`component-contracts.test.mjs` 断言同步新调用形态。测试 +19(agent-panel-placement 32/32)。`tech/24-agent-feature.md` §9.1/§9.3/§9.10/§6.4/§10 同步(含 trim-fix §6.4 文档滞后修补)。
- **action-prompt(afix)**:`prompts.ts` 动作纪律节后追加完整动作契约(中英文各一份,6 种动作 flyTo/select/addMarkers/drawCircle/openDetail/search 逐字与 `action-schema.ts` validateAction 对齐,含可复制 JSON 示例 + 字段说明;节首强调 payload 必须嵌套、禁止扁平替代);`agent-prompts.test.mjs` +3(契约含 6 动作示例 / 禁扁平 lng-lat / 边界数字 1..50、10..50000 与 schema 一致);`tech/24-agent-feature.md` §4.3 补注「LLM 所见动作契约由 prompts.ts 承载,以 validateAction 为准」。

## 冲突解决清单

- 无冲突,无取舍。红线核验:R7 两分支均未触碰 map-engine/**、site-geocode.ts、layers-panel.tsx、hooks/*、map-shell.tsx(仅历史轮 ws-c 已加的 seam)、server/docs/environment-variables.md、tech/23-map-engines.md、llm-validate.ts、types.ts;afix 仅触碰 prompts.ts + 其测试 + tech/24(均在 ws-a/ws-d 拥有文件内),未越界。merger 侧未触碰红线文件。三分支文件集合零交集(boss-state 确认)。

## 遗留问题

1. **`make docs-check` 全树 grep 误报(既有,非本轮引入,不入门禁红)**:未跟踪批次目录自引正则自匹配(`20260821-candcat-list/merge-report.md:19` 等)。已用 `git ls-files '*.md' | xargs grep`(仅 tracked)复验零匹配(exit 1)。批次目录自身入库后自然消失(boss 侧操作)。
2. **R6 遗留(纪律外未擅改)**:`tech/24-agent-feature.md:155` amap MCP 端点仍写 `https://mcp.amap.com/sse?key=<key>`(sse),与代码实测校准后的 `/mcp`(streamable)不符;docs-check 只查格式不查内容故通过。需 boss 安排文档同步。
3. **R6 遗留**:`route.ts` 的 `SSE_EVENT_TYPES` 白名单常量未含 `'reasoning'`(`api/**` 属「不碰」边界未改;常量当前未启用,reasoning 实际可送达)。
4. **ws-trimfix 问题 2(已按任务定义实现)**:裁剪后可能形成 [system, assistant(tool_calls), tool] 开头(无 user)——配对完整,不再 400;若冒烟再遇「首个消息须为 user」类 400,需再拆 fix 轮(连带保留最近 user 或 user 摘要化)。ws-nfix 已在 §6.4 同步整轮删除语义。
5. Env-only 步骤未做(留用户 + deferred-notes):BAIDU_MAP_AUTH_TOKEN 申请、AGENT_LLM_* 覆盖项、迁移 apply / import:seed:apply / AMap geocode。
6. 主仓库根遗留 `map-898-check.png`(未跟踪,非本批次产物,未删除;项目规范截图应存 `.playwright-mcp/`)。
7. **ws-afix 问题 1(已按 brief 裁决规则实现)**:addMarkers 点数 brief 写「1..5」,schema/执行器实为 `1..50`,prompt 按「逐字与 validateAction 对齐,以 action-schema.ts 为准」写 1..50。若 boss 本意是产品策略性收紧 LLM 输出,需改 schema 或另行指示。

## 最终 dev 状态

- HEAD `5218c92`(merge: feature/agent-action-prompt),已 push origin/dev(`bb4252a..5218c92`;仅本批次 R8 合并,无夹带)
- 修改:R7 = trim-fix 4 文件(agent/llm-provider.ts、agent/run-agent.ts、2 测试文件)+ snap-fix 6 文件(agent-ball.tsx、agent-panel.tsx、agent-panel-placement.ts、2 测试文件、tech/24-agent-feature.md);R8 = afix 3 文件(agent/prompts.ts、agent-prompts.test.mjs、tech/24-agent-feature.md);无新增文件
- 门禁抽验:npm test 975 / 973 pass / 0 fail / 2 skip;typecheck 零错误;docs-check tracked-only 零匹配;git diff --check 通过
- worktree/分支清理:`dm-wt-agent-tfix`、`dm-wt-agent-nfix`、`dm-wt-agent-afix` 均已 remove;`feature/agent-trim-fix`(was ea54440)、`feature/agent-snap-fix`(was f8393e3)、`feature/agent-action-prompt`(was d591222)均已 `git branch -d`;`dm-dev-merge` 留原地(其他批次遗留,容忍)
- 未 push main、未 force-push;Env-only 步骤留给用户

门禁: ALL_GREEN
结论: MERGED_ALL
