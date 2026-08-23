# Batch Manifest — 20260823-boss-scan-fix-r2(扫描 r2 修复批次)

## 目标

r2 全库质量扫描(`tech/roles/development/quality-scans/20260823-all-r2/scan-report.md`,13 项 = Med 4 / Low 9)审批后,技术类自动批派出的修复批次。r1(20260823-all,17 项)已于批次 20260823-boss-scan-fix 全部修复合并。

- 扫描报告:`tech/roles/development/quality-scans/20260823-all-r2/scan-report.md`
- Boss 裁决:批次 A(后端:#1 XFF 统一 / #6 Nominatim memo / #7 Nominatim q 上限 / #11 contrast 死代码);批次 C(文档:#3 deploy/architecture / #8 D-20 台账 / #9 frontend-component-dev skill / #10 tech/README 编号);数据/口径类(#2 #5)→ `deferred-notes.md`;追踪 #4 #12 #13。

## workstream 表

| ws | 分支 | worktree | 主题 | 发现号 | 拥有 |
|---|---|---|---|---|---|
| a | feature/scan-r2-backend | /Users/acccan/dm-wt-r2-a | 限流 XFF 统一 + Nominatim 加固 + 死代码清理 | #1 #6 #7 #11 | otp/send 路由 / password/login 路由 / site-geocode.ts / (可选共享 client-ip helper)/ tests / contrast.ts(+test)删除 |
| c | feature/scan-r2-docs | /Users/acccan/dm-wt-r2-c | 文档事实同步 | #3 #8 #9 #10 | tech/15-deploy.md / tech/01-architecture.md / tech/roles/development/deferred-ledger.md / .claude/skills/frontend-component-dev/skill.md / tech/README.md / CHANGELOG.md(引用处)/ 测试计数 6 处 |

**不碰**:`server/data/**`(数据修正 deferred)、`map-shell.tsx`(#4 追踪)、Nominatim UA 常量值(#5 deferred)、agent/chat 路由行为(只可共享其 helper,语义不变)。

## 合并顺序

1. **本轮:ws-a(已合并 99281c1 + push)+ ws-c**(merger 幂等跳过 ws-a,只处理 ws-c)。
2. ws-c 已含 boss 补完 commit(`9059408` skill.md 同步;`tech/26-agent-memory.md` 删除已 deferred 给用户)。

## ⚠️ merger 注意(主树卫生)

- 主树存在**非本批未提交改动**(`.claude/skills/*`、`tech/roles/development/quality-scans/`、并行批次目录等,来自其他会话/工具)——preflight 的 `git status --short` 非空属**正常**,绝不 stash / reset / checkout 主树改动;`git merge --no-ff <branch>` 只产生合并提交,提交时只 add 合并涉及文件。
- 本地 dev 与 origin/dev 已同步(72cf016);合并前仍 `git pull --ff-only origin dev`。
- 无并发会话推 dev(4195c9b5 已不在线);若 pull 时 origin 前移(其他会话推送),属正常,ff 后继续。

## 门禁基线

- 测试:`cd server && npm test` 实跑全绿(ws-a 记录删除 contrast 测试后的权威数;ws-c 在 ws-a 合并后复测并同步文档计数)
- `npm run typecheck`(ws-a)、`make docs-check` + `git diff --check`(全部)

## 注意

- 扫描时 dev tip 72cf016;r1 deferred 项(#9 证劵 / #16 robots / #19 slug / #2 全局预算 / SESSION_SECRET 生产设值)继续沿用,不重派。
- 无并发会话推 dev(4195c9b5 已不在线);合并前 merger 仍一律 `git pull --ff-only origin dev`。
