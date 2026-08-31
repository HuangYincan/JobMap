# Merge Instructions(boss-agent 生成,git rm 收尾版)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-nofly
- 读 README.md(manifest)与 reports/ws-1.md(确认完成、门禁自测通过)。
- 按 parallel-development 的 Merge orchestration 执行:
  1. Preflight:`git switch dev && git pull --ff-only origin dev`。主树若有与本批无关的未提交残留(如 server/data/.../蔚来.json,Env-only geocode 产物用户所有),**不 clobber、不提交、不 stash**,保留原样;仅 `server/next-env.d.ts`(生成噪音)可还原。其余须干净。
  2. `git merge --no-ff fix/saved-layer-nofly`。
  3. **收尾(必做)**:`git rm server/src/lib/saved-camera-sync.ts`(退役零导出桩,worker 沙箱未删,消费者已清零,typecheck 已证无引用),随后 `git commit`(message 如 `chore(saved-layer): 删除退役桩 saved-camera-sync.ts`)。
  4. 跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)→ 任一红则停并报 BLOCKED。
  5. `git push origin dev`;`git worktree remove /Users/acccan/dm-wt-saved-nofly 2>/dev/null || true`;`git branch -d fix/saved-layer-nofly 2>/dev/null || true`。
- Env-only 步骤不做。
- 写 merge-report.md(格式见 boss-merger agent 定义)。
- 末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
