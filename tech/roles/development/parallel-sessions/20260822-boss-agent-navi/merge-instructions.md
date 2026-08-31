# Merge Instructions(boss-agent 生成)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-navi
- 读 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-navi/README.md`(manifest:分支清单+合并顺序)与 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-navi/reports/<ws>.md`(确认每分支完成、门禁自测通过)。
- 按 parallel-development 的 Merge orchestration 执行:
  1. Preflight:`git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. 按 manifest 顺序逐个 `git merge --no-ff <branch>` → 跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)→ 任一红则停。
  3. 每个成功分支:`git push origin dev`;`git worktree remove <worktree> 2>/dev/null || true`;`git branch -d <branch> 2>/dev/null || true`。
- 冲突以各分支 prompt 的「不碰」为据解决,解决后重跑完整门禁。
- Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)不做。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-navi/merge-report.md`(格式见 boss-merger agent 定义)。
- 末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
