# Batch Manifest — 20260822-boss-agent-memory

## 目标

用户要求:agent 个性化记忆(每个用户独立记忆,对话中个性化)。

架构(Explore + boss 裁决):身份 = `dm_session` cookie → `readSessionUser()`;DB = pg + `withDbRead/Write`,
migration 018;记忆 = user_memories 表(事实条目);agent 侧 system prompt 注入「用户记忆」段 + `builtin__memory_save`
工具(LLM 自主保存;guest 拒绝);前端 agent-panel header 记忆入口(列表/删除/清除)。

## Workstreams(派发顺序约束)

| ws | 主题 | 分支 | worktree | prompt | report | 拥有文件 |
|---|---|---|---|---|---|---|
| mem-a | 后端核心(migration/store/agent 注入/工具/route/tech26) | `feature/agent-memory-core` | (已清理) | `prompts/ws-mem-a.md` | `reports/ws-mem-a.md` | db/migrations/018 + server/src/lib/{memory-store.ts,agent/*} + route.ts + /api/me/memories + tech/26 + 测试 |
| mem-b | 前端管理 UI(入口/列表/删除/清除) | `feature/agent-memory-ui` | `../dm-wt-agent-memb` | `prompts/ws-mem-b.md` | `reports/ws-mem-b.md` | agent-panel.tsx + agent-ball.tsx + map-shell.tsx(接线)+ i18n + 契约测试 |

**合并顺序**:mem-a(已绿,待合)→ mem-b(运行中)。

## 门禁

- `cd server && npm test`(零漂移 + 新增)+ `npm run typecheck`
- 根 `make docs-check` + `git diff --check`

## 合并后(boss/merger)

全绿 → 按序合并(mem-a → mem-b)→ 重建 3005 → 冒烟(登录态注入记忆段/工具可用/API 通)→ 批次入库 → 终态汇报。
Env-only:migration 018 apply(`make db-up` + apply.sh)留给用户(记 deferred)。
