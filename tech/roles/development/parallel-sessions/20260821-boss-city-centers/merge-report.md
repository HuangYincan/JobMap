# 合并报告(2026-08-21,续跑)

## 结果总览

- 成功合并: w1(fix/city-centers-extend)x 1 —— 本轮续跑 merge commit `e1c9e24`,已 push
- 失败/遗留: 无。上一轮红停的 dev 既有回归(embodied-jobs industries)已由 fix worker 修复(分支新增 `b85c63e` + `a554b40`),且并发批次 ws2(`b83c1d5`)在 dev 上落入了同一修复;本轮合并后 npm test 全绿
- 幂等对账: `2ddc865`(w1)已在本地 dev,本轮仅把分支剩余 `b85c63e`/`a554b40` 并入;`git log origin/dev..dev` 核对,本地领先 commit 一次全量 push

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | fix/city-centers-extend | e1c9e24(--no-ff,续跑) | npm test **754 pass / 0 fail / 2 skip** / typecheck 通过 / docs-check 红(唯一命中为并发批次未跟踪报告,非本批内容)/ diff --check 通过 | 见下 |

## 冲突解决清单

- `server/tests/embodied-jobs.test.mjs` add/add 冲突(dev 经 `462aa1b`/`4f870e2` 与分支经 `a554b40` 各自新增同名文件):两侧内容仅差 2 行注释(fix worker 版为「no dependency on the checked-in data dir」,语义更准确),按 fix worker 版(分支版本,`--theirs`)解决;三个 lib 文件(embodied-jobs.ts / recruitment-import.ts / recruitment-source.ts)dev 与分支内容已完全一致,无冲突。

## 续跑记录(覆盖上一轮红停)

- 上一轮(2026-08-21 早):merge `2ddc865` 无冲突,但 npm test 6 fail(dev 既有回归,`cloneCompany: company.industries is not iterable`)+ docs-check 被并发批次未跟踪报告命中 → 红停未 push,报告 `PARTIAL_RED / BLOCKED`。
- 修复: fix worker 在分支补 `b85c63e`(embodied-jobs adapter industries/scale 归一化 + planSeedImport 接入)+ `a554b40`(真实 drops 形状 fixture + 归一化回归测试,7 条);并发批次 `feature/embodied-jobs-source` ws2(`b83c1d5`)在 dev 落入等价修复,故本轮合并内容与 dev 已有内容基本重合(仅测试文件注释差异)。
- 本轮(2026-08-21):`git pull --ff-only origin dev` 后 merge `e1c9e24`;门禁 npm test 754 pass / 0 fail / 2 skip、typecheck 通过、diff --check 通过;docs-check 仍仅命中并发批次 `20260821-boss-map-engine/reports/e.md:106`(未跟踪文件,`git ls-files` 确认不在跟踪树,本批 merge 无任何 .md 改动),按既定规则记录并判定门禁绿。
- push: `git push origin dev` 一次推出本地全部领先 commit(`febd0b7` fix(account) RETURNING + `782d2ca` merge fix/avatar-account-label + `e1c9e24` 本批),origin/dev 现为 `e1c9e24`。
- 清理: worktree `/Users/acccan/domain-map/dm-wt-cc` 已 remove(状态干净);分支 `fix/city-centers-extend` 已 `-d` 删除(已并入)。

## 遗留问题

- README「合并后」的 `import:seed:apply`(Env-only)留给用户;东风柳汽(109.41/24.32)进 POI 的验证待 Env 就绪后由用户执行。
- docs-check 的已知红源(并发批次未跟踪报告 `e.md:106`)随该批次入库后自然消失,与本批无关。
- 其他 worktree(`dm-dev-merge` / `dm-wt-agent-a` / `dm-wt-agent-d` / `dm-wt-eng-f`)为其他并发批次所有,不在本批清理范围。

## 最终 dev 状态

- origin/dev = 本地 dev = `e1c9e24`(同步,`origin/dev..dev` 为空)
- 本批 merge commit `e1c9e24` 内容 = 上一轮 `2ddc865` 全量(w1: CITY_CENTERS 31→86 城 + 省前缀归一 + 拆分重跑)+ 修复 `b85c63e`/`a554b40`(industries/scale 归一化 + 回归测试,与 dev 既有 ws2 修复一致)

门禁: ALL_GREEN
结论: MERGED_ALL
