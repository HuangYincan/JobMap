# Batch Manifest — 20260823-boss-scan-fix(扫描修复批次)

## 目标

全库质量扫描(20260823-all,19 项 = High 1 / Med 9 / Low 9)审批后,技术类自动批派出的首个修复批次。

- 扫描报告:`tech/roles/development/quality-scans/20260823-all/scan-report.md`
- Boss 裁决:批次 A(安全)/ B(API 边界)/ C(文档事实同步)并行;数据/口径类(#9 #19 #16 #2 全局预算)入 `deferred-notes.md`;追踪项 #10 #15。

## workstream 表

| ws | 分支 | 目录 | 主题 | 发现号 | 拥有 |
|---|---|---|---|---|---|
| a | feature/scan-auth-hardening | /Users/acccan/dm-wt-scan-a | 认证安全加固 | #1 #2 #3 #4 #17 | account-store.ts / otp 路由 / password login 路由 / session-store.ts(+oauth-state 对齐)/ 对应测试 / tech/15,27 + environment-variables 关键段 |
| b | feature/scan-api-boundaries | /Users/acccan/dm-wt-scan-b | API 输入/限流边界 | #11 #12 #13 #18 | agent/chat 路由 / api/pois 路由 / public-cache.ts / api/auth/me 路由 / 对应测试 |
| c | feature/scan-docs-factsync | /Users/acccan/dm-wt-scan-c | 文档事实同步 | #5 #6 #7 #8 | server/README.md / README.md / CLAUDE.md / agent.md / CONTRIBUTING.md / CHANGELOG.md / tech/05-milestones.md / tech/roles/data/data-quality.md |

**不碰**:`server/data/**`(数据修正 deferred)、`map-shell.tsx`、`map-engine/**(4195c9b5 会话会话活跃区)、其他 tech 文档(除非 prompt 显式列出)。

## 合并顺序

1. ws-a(安全优先)→ 2. ws-b → 3. ws-c(文档最后)。全部绿后 merger 逐个 `--no-ff` 合并,pull 最新 dev,门禁绿 push origin/dev。

## 门禁基线

- 测试:以 `cd server && npm test` 实跑为准(全绿;新增不得回归)
- `npm run typecheck`(ws-a/ws-b)、`make docs-check` + `git diff --check`(全部)

## 注意

- 4195c9b5 会话仍在运行并可能继续推进 dev(engine-polish-2 系列);各 worktree 从建树时 dev 切出,合并前 merger 一律 `git pull --ff-only origin dev`。
