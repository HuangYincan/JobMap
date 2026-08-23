# Merge Instructions(boss-agent 生成,豁免版 v2)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-mutex
- 读 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-mutex/README.md`(manifest:分支清单+合并顺序)与 `reports/ws-1.md`(确认分支完成、门禁自测通过)。
- 按 parallel-development 的 Merge orchestration 执行:
  1. Preflight:`git switch dev && git pull --ff-only origin dev`。**主树豁免说明(boss 裁决 2026-08-22)**:工作树存在两处未提交残留,按此处理——
     - `server/data/recruitment/official-career/蔚来.json`(M):Env-only AMap geocode 产物,**用户所有,绝不 clobber**(不 checkout --、不 stash、不提交、不 add);它与本批 merge 文件零重叠(git 允许),保留原样,全程不得触碰。
     - `server/next-env.d.ts`(M):Next.js 生成噪音,可 `git checkout -- server/next-env.d.ts` 还原。
     - 除上述两项外,其余工作树必须干净。若 git merge 因残留拒绝执行,报 BLOCKED 并说明,不得绕过。
  2. 按 manifest 顺序逐个 `git merge --no-ff <branch>` → 跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)→ 任一红则停。
  3. 每个成功分支:`git push origin dev`;`git worktree remove <worktree> 2>/dev/null || true`;`git branch -d <branch> 2>/dev/null || true`。
- 冲突以各分支 prompt 的「不碰」为据解决,解决后重跑完整门禁。
- Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)不做;蔚来.json 不得并入任何 commit。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-mutex/merge-report.md`(格式见 boss-merger agent 定义)。
- 末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
