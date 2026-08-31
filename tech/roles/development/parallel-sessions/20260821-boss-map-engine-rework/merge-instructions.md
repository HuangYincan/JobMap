# Merge Instructions(boss-agent 生成)— 轮 3 合并(ws-5,收尾)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework
- 轮1/轮2 已合入 dev(本地 tip 8abb1f9;origin 停 527e631,push 待用户授权,轮2 完成后同批 push)。
- **本轮合并范围**:feature/engine-search-cleanup(ws-5,tip fa9918f,单分支)。boss 已亲自复核:1096 tests / 0 fail,工作树干净;typecheck/diff-check worker 自报通过(合并后门禁兜底复核)。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`(可能无新内容;若拉取到其他会话 commit,正常合并即可);`git status --short` 主树干净。
  2. `git merge --no-ff feature/engine-search-cleanup` → 跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check` 基线红注明来源;`git diff --check`)。红则停。
  3. 绿:尝试 `git push origin dev`。若被权限分类器拦截(Out of Place Publication),**不要绕过**——在 merge-report 遗留问题注明「push 待用户授权」,其余照常完成。
  4. 清理:`git worktree remove /Users/acccan/dm-wt-rw5 2>/dev/null || true`;`git branch -d feature/engine-search-cleanup 2>/dev/null || true`。
- 冲突以 ws-5 prompt 的「不碰」为据解决。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/merge-report.md`(覆盖或追加轮3 段,含各轮结果总览)。
- 末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
