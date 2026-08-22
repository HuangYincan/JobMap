# Merge Instructions(boss-agent 生成)— 轮 2 合并(ws-e)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2
- **本轮合并范围**:fix/baidu-round2(ws-e,tip 230ff5c)。
- ws-e boss 已亲自复核:1397/1401 pass(2 失败为**既有 dev 基线数据域失败**——蔚来-site-绍兴 drop site、qqj split-city,轮1 已在 df4b26d 复现同款,boss 已裁决不计红;零新增失败);typecheck/docs-check/diff-check 全绿。
- dev 已含轮1(4 ws);ws-e 从 17cb454 切出。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. `git merge --no-ff fix/baidu-round2`;跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停(仅指新增失败;基线 2 项不计)。
  3. 全绿(零新增):`git push origin dev`;清理 worktree br2 + 分支。
  4. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/ && git commit -m "chore: 20260822 boss engine-polish-2 轮2入库(ws-e baidu-round2 merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/merge-report.md`(追加轮2 段落),末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
