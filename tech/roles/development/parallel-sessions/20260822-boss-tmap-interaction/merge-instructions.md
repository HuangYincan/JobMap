# Merge Instructions(boss-agent 生成)— 轮 2 合并(ws-e)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction
- **本轮合并范围**:fix/icon-cors-preflight(ws-e,tip 3124474)。
- ws-e boss 已亲自复核:1361/1359 pass;typecheck/docs-check/diff-check 全绿。
- **dev 已含轮1 四个 merge**(ws-a/b/c/d,0fac2eb 及其后);轮1 已 push。ws-e 从当前 dev(6b260c0)切出,应干净 fast-forward 式合并。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. `git merge --no-ff fix/icon-cors-preflight`;跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停。
  3. 全绿:`git push origin dev`;清理 worktree icon + 分支。
  4. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/ && git commit -m "chore: 20260822 boss tmap-interaction 轮2入库(ws-e icon-cors-preflight merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/merge-report.md`(追加轮2 段落),末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
