# Merge Instructions — job-navigation-ws4（boss-agent 生成）

- 批次目录：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws4`
- 读本目录 `README.md` 与 `reports/ws4-frontend.md`（已确认 `门禁: PASSED` / `结论: OK`）。
- 合并唯一分支：`feature/job-navigation-ws4-frontend`（独立核过 tip `ebd8bbe`）。
- 基线：主树 `dev == origin/dev == 673502d`；若仍相等，合并前不必网络 pull。
- 按 parallel-development Merge orchestration：`--no-ff`，红则停；Env-only / live provider 不做；不 push main、不 force-push。

## 主树脏文件协议（必须遵守）

下列路径属于用户、必须保持字节级未改、未暂存、未 checkout/stash/reset/clean：

- 已修改：`server/next-env.d.ts`
- 未跟踪：`.agents/`、`AGENTS.md`、`server/tech/`、以及 git status 列出的全部更旧批次/扫描目录
- 两个既有 worktree/分支不得删除：`feature/job-navigation-ws0-review-spec`、`feature/job-navigation-ws0-review-standards`

禁止 `git add .` / `git add -A`。只显式 add 本批授权路径。

## 安全编排

1. 核对主树在 `dev` 且 `dev == origin/dev == 673502d`；feature worktree 干净；汇报末两行 PASSED/OK。
2. 仅显式 add 本批证据：`README.md`、`prompts/ws4-frontend.md`、`reports/ws4-frontend.md`、`boss-state.md`、`deferred-notes.md`、`merge-instructions.md`。在 `dev` 上提交 `docs(development): dispatch job navigation ws4`。
3. `git merge --no-ff feature/job-navigation-ws4-frontend`，Conventional merge subject。预期无冲突；若冲突碰到用户既有脏文件则停。
4. 合并后门禁（串行）：专项 `tests/agent-map-executor.test.mjs` + `tests/commute-filter.test.mjs`；全量 `npm test -- --test-concurrency=1`；`npm run typecheck`；`make docs-check`；`git diff --check`。独立记录实际计数。
5. 全绿后：把 `tech/31` WS4 从「本分支已实现」收口为「已完成并合并」（生产仍 estimate-only）。更新 `boss-state.md` 为 VERIFY/MERGED，写 `merge-report.md`。仅显式提交这些文档为 `docs(development): record job navigation ws4 merge`。
6. `git push origin dev`（绝不 push main、绝不 force）。然后只移除本批 feature worktree `/Users/acccan/dm-wt-job-navigation-ws4-frontend` 并删除已合并本地分支；不要碰两个 `feature/job-navigation-ws0-review-*` worktree/分支。
7. 再跑主树 `git status --short --branch`：用户既有脏路径仍在；本批目录已跟踪；无新残留。

不补开发代码。不跑 Env-only / live provider。
