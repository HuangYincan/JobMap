# Merge Instructions(boss-agent 生成)— 轮 8 合并(ws-i)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2
- **本轮合并范围**:fix/tmap-badge-overlap(ws-i,tip c16e0d5,worktree /Users/acccan/dm-wt-tov)。
- ws-i boss 已亲自复核:1461/1461 pass(实测 npm test 复验)/0 fail/2 skip;typecheck/docs-check/diff-check 全绿;真机验收(5/5 reload 徽章全渲染、零 34×14 扁块、点击弹卡、缩放/pan 完整、预检链式第二会话 0 错误、AMap/Baidu 零回归)。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. `git merge --no-ff fix/tmap-badge-overlap`;跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停。
  3. 全绿:`git push origin dev`;清理 worktree tov + 分支。
  4. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/ && git commit -m "chore: 20260822 boss engine-polish-2 轮8入库(ws-i tmap-badge-overlap merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/merge-report.md`(追加轮8 段落),末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
