# 批次 Manifest — 20260820-boss-scan-optimize

目标:全库代码扫描(quality-scans/20260820-all,15 项发现:High 0/Med 6/Low 9)+ 自主优化。
发现 0 High;审批结论:

**批准派发(5 批,文件互不相交,可并行):**

| ws | 分支 | worktree | 主题 | 覆盖 scan # | 合并顺序 |
|---|---|---|---|---|---|
| ws-docs | fix/docs-sync-20260820 | /Users/acccan/dm-wt-docs | 测试计数/版本号统一 + CHANGELOG 补 2 条 + agent.md 路径标注 | #1 #2 #9 #10 #12 #15 | 1 |
| ws-api | fix/poi-id-route | /Users/acccan/dm-wt-api | /api/pois/[id] 双重解码 500 + id 长度上限 | #7 | 2 |
| ws-data | fix/radar-double-https | /Users/acccan/dm-wt-data | 双 https:// 前缀修正 + import 校验器 URL 断言 | #4 | 3 |
| ws-hygiene | ~~chore/repo-hygiene~~ | (无 commit) | ~~删根产物+目录入库~~ **boss 主树直接完成**(dev b8d5fc1),分支无 commit,跳过 | #13 | 跳过 |
| ws-frontend | refactor/map-shell-hooks | /Users/acccan/dm-wt-frontend | map-shell 继续抽 hooks(降复杂度) | #6 | 4(最后,风险最高) |

> ⚠️ merger 注意:chore/repo-hygiene 分支**无 commit**(tip = 933f972),不要 merge;scan #13 已由 boss 在主树直接完成并提交(dev b8d5fc1:9 批次目录 + 2 扫描报告入库、.gitignore 排除 logs、根 Playwright 产物已删)。合并前 dev 可能领先 worker 分支 1 个 commit(b8d5fc1,只动 tech/roles/ + .gitignore,与各分支无冲突)。

**Deferred(需用户决策 / Env-only,见 deferred-notes.md):**
- #3 同公司 slug 合并口径(用户拍板)
- #5 slug/显示名改名(用户拍板)
- #8 robots 失败策略(采集口径,用户拍板)
- #14 串味行 DB 数据修正(数据批 + import apply 执行窗口)
- #4 的 import apply(Env-only)

门禁(每批):`cd server && npm test` 全绿 + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/<ws>.md,末两行 token(`门禁: PASSED|FAILED` / `结论: OK|BLOCKED: …`)。
Worker 不 merge、不 push、不碰主树,worktree 已预建。
