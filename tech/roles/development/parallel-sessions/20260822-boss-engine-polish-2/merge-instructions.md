# Merge Instructions(boss-agent 生成)— 轮 4 合并(ws-f r4)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2
- **本轮合并范围**:fix/baidu-r4(ws-f r4,tip bf1dd7c,worktree /Users/acccan/dm-wt-br4)。
- ws-f r4 boss 已亲自复核:1429/1427 pass;typecheck/docs-check/diff-check 全绿。分支基于 dev HEAD(含 agent-inputbar 合并)。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. `git merge --no-ff fix/baidu-r4`;跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停。
  3. 全绿:`git push origin dev`;清理 worktree br4 + 分支。
  4. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/ && git commit -m "chore: 20260822 boss engine-polish-2 轮4入库(ws-f r4 merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/merge-report.md`(追加轮4 段落),末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
