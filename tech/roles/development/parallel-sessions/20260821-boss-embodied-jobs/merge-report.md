# 合并报告(2026-08-21)

## 结果总览

- 成功合并: ws1 × 1(`feature/embodied-jobs-data`)+ ws2 × 1(`feature/embodied-jobs-source`)— 均 push origin dev
- 失败/遗留: 无(ws2 首轮红 merge `983b161` 经 FOLLOWUP 修复后重新合并,门禁绿)

> 注:本报告为 resume 轮。ws1 在首轮已合并并 push(`1af75a6`);ws2 首轮合并门禁红(industries 缺失 TypeError),boss ADJUDICATE 后 worker 在分支上补 2 个修复 commit(`7996481` 适配器归一化 + `4f870e2` 真实形状回归测试),本轮重合并。

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws1 | `feature/embodied-jobs-data` | ✅ 首轮已并入 dev 并 push(`1af75a6`);本轮幂等跳过(branch --merged 命中),worktree/分支已清理 | ✅(首轮:659 tests / 657 pass / 2 skip,typecheck ✓、docs-check ✓、diff ✓) | 无 |
| ws2 | `feature/embodied-jobs-source` | ✅ 干净 auto-merge → `b83c1d5`(旧 tip `708268a` 已是 dev 祖先,仅带入 2 个修复 commit,3 文件 +159/−27) | ✅ **696 tests / 694 pass / 0 fail / 2 skip**、typecheck ✓、`git diff --check`(工作树 + origin/dev..HEAD)✓、docs-check 见遗留问题(环境性) | 无 git 冲突 |

## 冲突解决清单

- 无 git 冲突。ws2 修复 merge 三文件(README 计数 / embodied-jobs.ts 归一化 / 测试 fixture)全部干净 auto-merge;manifest 预警的 `feat/qqdoc-jobs-source` 同改文件(recruitment-source.ts / recruitment-import.ts)已在 dev,无重复条目。
- ws2 首轮红 merge `983b161`(未推送)留在本地 dev 历史,其后依次叠了 city-centers `2ddc865`、avatar-username `f1dc329`(他批 merge,均已随本轮 push 推出)——因无法重写他批工作,红中间 commit 保留,最终树全绿。

## 遗留问题

1. **docs-check 环境性红(非本批引入)**:`make docs-check` 因未跟踪文件 `tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/e.md:106`(他批在飞汇报,引用了 docs-check 命令本身)exit 2。已验证:**tracked .md 零匹配**(`git grep` 等价检查通过)、本批次目录零匹配。他批文件「不碰」,待 map-engine 批次收敛或 doc-reconcile 处理。city-centers merger 亦记录过同一现象。
2. **server/README.md 测试计数为 worktree 口径**:当前写 600(ws2 实测),dev 实测 696(694 pass / 2 skip)。计数 drift 属既有惯例(全局 CLAUDE.md 仍为 568),由 doc-reconcile 批次统一修。
3. **并发合并说明**:push 前的门禁跑完后,map-engine 批次 merger 在同一主工作树并发合并了 `feature/map-engine-amap`(`8d9338c`,轮2-c)+1726/−612,随本次 push 一并推出(`1af75a6..8d9338c`)。已对**推出去的最终状态 8d9338c 重跑完整门禁**:696 tests / 694 pass / 0 fail / 2 skip、typecheck ✓、diff-check ✓。
4. **Env-only 待办**(用户执行,见 deferred-notes.md):`npm run import:seed:apply`(需 DATABASE_URL)落地 embodied-jobs 到 Postgres;AMap geocode(需 AMAP_WEB_KEY)补职场坐标。
5. **ws1 口径遗留**(供 boss 知悉):柏楚同名歧义(radar 双候选)→ 新建 embj-柏楚,未并入;「节卡/节卡机器人」疑同一公司两写法,按不同名各建 drop;ws2 适配器 `scale` 固定缺省 `'enterprise'`(对创业公司偏大,后续可在 drop 层补真实 scale)。

## 最终 dev 状态

- origin/dev = `8d9338c`(含 ws1 `1af75a6`、ws2 修复 merge `b83c1d5`、city-centers `2ddc865`、avatar-username `f1dc329`、map-engine 轮2-c `8d9338c`)
- 工作树无 tracked 改动(仅未跟踪的他批/本批批次目录与 `map-898-check.png`)
- 本批 worktree `dm-wt-embd-a` / `dm-wt-embd-b` 已 remove,分支 `feature/embodied-jobs-data` / `feature/embodied-jobs-source` 已删

门禁: ALL_GREEN
结论: MERGED_ALL
