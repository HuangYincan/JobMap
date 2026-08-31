# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-mt x 1(merge commit `f5ec089`,--no-ff,无冲突,8 文件)
- 失败/遗留: 无批次分支失败;但门禁 **PARTIAL_RED** —— 2 个数据测试失败,由 **dev 既有**(本批 preflight 前已在本地 dev)的 geocode r4 数据 commit `3e6deb3` 引入,与 ws-mt 无关
- push origin/dev: **未执行**(门禁红,按规则「门禁绿后自动 push」暂缓)

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-mt | feature/mobile-toolbar | f5ec089 成功(ort 自动) | npm test: 1384 pass / **2 fail** / 2 skip(见遗留 1,非本批);typecheck ✓;docs-check ✓;diff --check ✓ | 无冲突,无需手工解决 |

## 冲突解决清单
- 无。ws-mt 干净应用(8 文件:.claude/skills/frontend-component-dev/skill.md、agent-ball.tsx(+module.css)、agent-panel.module.css、map-shell.tsx(+module.css)、component-contracts.test.mjs、tech/24-agent-feature.md),与 dev 零冲突。

## 遗留问题
1. **push 暂缓,门禁红(2 个数据测试)**:
   - `tests/drops-coordinate-consistency.test.mjs:64`「无任何非杭州 drop 站点坐标落在杭州参考框内」——`official-career/蔚来.json` 的 蔚来-site-绍兴(城市=绍兴市,lng 120.512106 / lat 30.092944)落入杭州参考框;测试提示需重跑 `fix-sweep-accident-coords.mjs`。
   - `tests/split-city-sites.test.mjs:284`「qqj-临界点(上海 深圳 北京,100 岗)」——拆分断言 deep-equal 失败(上海 376→347 站点变化)。
   - 两个数据文件最后修改 commit 均为 `3e6deb3 data(recruitment): geocode r4 — 288 城市中心/缺坐标站落真实坐标`。该 commit 在本批 preflight 时已在本地 dev(初始「ahead of origin 2 commits」= 3e6deb3 + df4b26d),**非本批 ws-mt 引入**。需数据链修复后重新门禁,绿后由用户/boss 决定 push。
2. **本地 dev 另有用户并行合并未 push**:ws-a(baidu-style, db35b7c)/ ws-b(baidu-poi-locate, 6408b42)/ ws-c(tencent-poi-icon, cb42e99)/ ws-d(tencent-locate, 7c16766),共 18 commits 领先 origin/dev。
3. Env-only 步骤未做(迁移 apply / import:seed:apply / AMap geocode)——按约定留给用户。
4. ws-mt 汇报中的 SKILL.md 同步由 boss 已在 worktree 内应用(3d0c511),已随合并进入 dev,无遗留。

## 最终 dev 状态
- 本地 dev HEAD: `cb42e99`(领先 origin/dev 18 commits,未 push)
- 本批合并: `f5ec089` merge: feature/mobile-toolbar → dev(ws-mt)
- 收尾:worktree `/Users/acccan/dm-wt-mt` 已移除;分支 `feature/mobile-toolbar` 已删(已合并)
- 未 push main、未 force-push

门禁: PARTIAL_RED
结论: MERGED_PARTIAL: ws-mt 已合并成功(无冲突,typecheck/docs/diff 绿);红停=push 因 dev 既有 geocode r4 数据回归(3e6deb3,drops-coordinate-consistency/split-city-sites)未执行,非本批分支引入
