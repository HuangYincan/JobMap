# Follow-up: fix embodied-jobs industries 回归(在 dm-wt-cc worktree)

## 背景
合并城市中心批次时发现 dev 既有回归(983b161 embodied-jobs-source 遗留,上批 merge-report 已记录未修):`server/tests/recruitment-import.test.mjs` 6 fail,`recruitment-import.ts:222 cloneCompany` 抛 `company.industries is not iterable` —— 47 个 embj-* drop 缺 industries 字段,`server/src/lib/recruitment-adapters/embodied-jobs.ts` 适配器未归一化。

## 任务(在 /Users/acccan/domain-map/dm-wt-cc worktree,分支 fix/city-centers-extend,已含 2ddc865)
1. 读 `server/src/lib/recruitment-adapters/radar.ts`(industries 归一化参考)与 `embodied-jobs.ts`。
2. 修:embodied-jobs 适配器对 **industries 缺失/非数组/空数组** 归一化(默认值建议 `['未分类']` 或与项目其他源一致的兜底,对齐 L142 校验「need at least one」;name-based tag 推断可参考 qqdoc 适配器做法,自裁)。
3. 补测试:`embodied-jobs.test.mjs` 增加「industries 缺失/空 → 归一化」用例;`recruitment-import.test.mjs` 6 个失败用例应恢复绿。
4. 门禁:`cd /Users/acccan/domain-map/dm-wt-cc/server && npm test`(预期 678+ pass/2 skip,基线 672+6)、`npm run typecheck`、`cd /Users/acccan/domain-map/dm-wt-cc && make docs-check`(注意:docs-check 的并发批次报告红是已知,你的改动不涉及 .md;若 docs-check 因并发批次仍红,如实记录)、`git diff --check`。
5. Conventional Commits(如 `fix(recruitment): normalize missing industries in embodied-jobs adapter`)。

## 汇报
追加到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-city-centers/reports/w1-followup.md`,末两行:
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>

不 push 不 merge;cwd = /Users/acccan/domain-map/dm-wt-cc。
