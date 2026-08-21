# Batch Manifest — 20260821-boss-agent-thinkfix

## 目标

用户反馈:隐藏 agent 思考过程内容,只留「思考中」与「思考完成」两个状态。
后端不改(reasoning 事件照发,回传机制必需),前端内容不渲染、状态行替代折叠块。

## Workstreams

| ws | 主题 | 分支 | worktree | prompt | report |
|---|---|---|---|---|---|
| thinkfix | 思考状态化(内容隐藏) | `feature/agent-think-hide` | `../dm-wt-agent-thinkfix` | `prompts/ws-thinkfix.md` | `reports/ws-thinkfix.md` |
| pinfix | 定位点显式锚定(缩放漂移修复) | `feature/agent-pin-anchor` | `../dm-wt-agent-pinfix` | `prompts/ws-pinfix.md` | `reports/ws-pinfix.md` |

thinkfix 拥有:`server/src/components/agent-panel.tsx` + `server/src/lib/agent-panel-state.ts` + `agent-panel.module.css` + `server/src/lib/i18n.ts`(新键)+ 测试。
pinfix 拥有:`server/src/lib/agent-map-bridge.ts` + 契约测试。文件不相交,可并行。

## 门禁

- `cd server && npm test`(988+ 零漂移 + 新增)+ `npm run typecheck`
- 根 `make docs-check` + `git diff --check`

## 合并后(boss/merger)

绿 → merger 合并 → 冒烟(SSE reasoning 事件仍在,前端状态行)→ 批次入库 → 汇报(deferred:Playwright 视觉验证)。
