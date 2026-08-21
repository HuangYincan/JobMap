# Batch Manifest — 20260821-boss-agent-fixes

## 目标

agent-feature 批次(R1-R8)交付后的用户反馈修复轮(4 项):

1. **tag 点击重复定位** —— 重放动作经 handleEvent 触发 onAction → 按钮翻倍 + 地图反复定位(根因已定位)。
2. **输出格式** —— 要求按轮交替:文本1、工具1、文本2、工具2、文本3…(前端按轮拆消息)。
3. **安全脱敏** —— 不披露内部工具名/MCP 标识/调用参数/system prompt/实现细节(SSE 公开事件脱敏)。
4. **定位点显眼** —— agent 标记点白色与地图混杂,改蓝色主题样式(参照距离手柄)。

## Workstreams

| ws | 主题 | 分支 | worktree | prompt | report | 拥有文件 |
|---|---|---|---|---|---|---|
| sanitize | 后端公开面脱敏(工具事件类别化 + 错误收敛) | `feature/agent-sanitize` | `../dm-wt-agent-sanitize` | `prompts/ws-sanitize.md` | `reports/ws-sanitize.md` | `server/src/lib/agent/{types,run-agent}.ts` + `server/src/app/api/agent/chat/route.ts` + `agent-runner/agent-route-contract` 测试 |
| uxfix | 前端 UX:按轮交替输出 + 重放去重 + 定位点显眼 | `feature/agent-ux-fix` | `../dm-wt-agent-uxfix` | `prompts/ws-uxfix.md` | `reports/ws-uxfix.md` | `server/src/components/agent-{panel,map-executor}.ts`(或 .tsx)+ `server/src/lib/agent-map-bridge.ts` + 新 `server/src/lib/agent-panel-state.ts` + i18n 新键 + 相关测试 |

**契约衔接**(两 WS 并行,事件形状不变,只改值语义):
- `tool` 事件 `name` = 公开类别(`search`/`geocode`/`directions`/`weather`/`project`/`other`),summary 不携带;
- `error` code ∈ `LLM_UNCONFIGURED|RATE_LIMITED|ERROR`,message 置空。
- 合并顺序:**sanitize 先合**(dev 先获得新值语义),uxfix 后合(消费同语义,typecheck 天然一致)。

## 门禁(每 WS、每轮合并)

- `cd server && npm test`(973+ 全绿零漂移 + 新增测试)
- `cd server && npm run typecheck`
- 根 `make docs-check` + `git diff --check`

## 合并后(boss/merger)

全绿 → spawn merger 按序(sanitize → uxfix)`--no-ff` 合并 → push dev → 冒烟验证(SSE 无内部名/无 summary/无错误码;工具流正常)→ 批次入库 → 最终汇报(deferred:Playwright 视觉验证)。
