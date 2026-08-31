# Batch Manifest — 20260822-boss-agent-panel-v2

## 目标

用户反馈:①记忆 UI 太丑 → liquid glass 重设计;②新增会话管理(多会话,本地存储,登录/guest 均可用)。

## Workstreams

| ws | 主题 | 分支 | worktree | prompt | report |
|---|---|---|---|---|---|
| panel2 | 记忆弹层重设计 + 会话管理 | `feature/agent-panel-v2` | `../dm-wt-agent-panelv2` | `prompts/ws-panel2.md` | `reports/ws-panel2.md` |

拥有:`server/src/components/agent-panel.tsx` + `agent-panel.module.css` + 新 `server/src/lib/agent-session-store.ts` + `server/src/lib/i18n.ts`(新键)+ `server/tests/agent-session-store.test.mjs` + 契约测试。

## 门禁

- `cd server && npm test`(零漂移 + 新增)+ `npm run typecheck`
- 根 `make docs-check` + `git diff --check`

## 合并后(boss/merger)

绿 → merger 合并 → 重建 3005 → 冒烟(会话 API 无后端;本地存储由前端自测/契约覆盖;视觉待 Playwright)→ 批次入库 → 汇报。
