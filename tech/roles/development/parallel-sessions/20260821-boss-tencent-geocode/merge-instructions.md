# Merge Instructions(boss-agent 生成)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-tencent-geocode
- 读 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-tencent-geocode/README.md`(manifest)与 `reports/w1.md`。
- 按 parallel-development 的 Merge orchestration 执行:
  1. Preflight:`git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. `git merge --no-ff feat/geocode-tencent-fallback`(分支含 7358a13 测试补丁;dev 已含腾讯实现 21c430e)→ 跑门禁(`cd server && npm test && npm run typecheck`;`git diff --check`)→ npm test 红则停。**docs-check 已知红**(dev 既有问题:agent-thinkfix merge-report 自匹配行,非本批改动)—— 若仅因此红,记录并继续。
  3. 门禁绿(或仅 docs-check 已知红):`git push origin dev`;`git worktree remove <worktree> 2>/dev/null || true`;`git branch -d <branch> 2>/dev/null || true`。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-tencent-geocode/merge-report.md`。
- 末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
