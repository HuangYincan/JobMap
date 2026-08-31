# 合并报告(2026-08-25)

> 批次:20260825-poi-marker-resilience(5 WS,manifest 顺序 a→b→c→d→e)

## 结果总览

- 成功合并: a-marker-core / b-marker-wiring / c-viewport-guard / d-local-fallback / e-search-suggest,共 5
- 失败/遗留: 无
- 每步门禁全绿后逐个 `git push origin dev`;最终 dev = `fd45824`

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| a-marker-core | fix/poi-marker-autorestore | 954e492 | 1621/1619 pass/0 fail/2 skip · ✅ · ✅ · ✅ | 无冲突 |
| b-marker-wiring | fix/poi-marker-wiring | e29b220 | 1624/1622 pass/0 fail/2 skip · ✅ · ✅ · ✅ | 无冲突 |
| c-viewport-guard | fix/viewport-epoch-guard | 58d62a7 | 1627/1625 pass/0 fail/2 skip · ✅ · ✅ · ✅ | 无冲突(hooks-contracts.test.mjs 自动合并) |
| d-local-fallback | fix/local-poi-db-fallback | d0077ee | 1630/1628 pass/0 fail/2 skip · ✅ · ✅ · ✅ | 无冲突 |
| e-search-suggest | fix/price-suggest-fixes | fd45824 | 1631/1629 pass/0 fail/2 skip · ✅ · ✅ · ✅ | 无冲突 |

## 冲突解决清单

- 无 git 冲突。唯一同文件交集 `tests/hooks-contracts.test.mjs`(b + c 各加契约用例)在 merge c 时被 ort 自动合并,合并后全量测试绿,双方案例共存。
- **b 独立 typecheck 红说明**(非缺陷):b 汇报时 typecheck 4 错,全部因 a 的契约符号(`setPOIs` 二参 / `sync()` / `isAttached`)未合并到 dev。按 manifest 合并顺序先 a 后 b,合并后组合树契约齐全,typecheck 转绿(b 汇报预判一致)。
- 主树残留 `server/next-env.d.ts`(Next dev 自动生成漂移 `.next/dev/` vs 已提交 `.next/`)非本批改动、非人工编辑,已 `git checkout --` 恢复,未入 commit。

## 遗留问题(记录,非阻塞)

- TMap MultiMarker 下 sync() 会重建「控制器自己隐藏」的 marker(重建后按 visibleIds 立即重新隐藏,状态保持;开销权衡由 a/b 汇报记录)。「隐藏中不重建」优化留待后续决策。
- priceSortValue 仍只认 priceLevel(有 cost 无 priceLevel 的 POI 在 priceDesc 下置尾)——按 prompt 保持现状,口径观察见 deferred-notes.md。

## 最终 dev 状态

- `fd45824`(5 笔 merge commit),已 push origin dev。
- 收尾:5 个 worktree 全部 remove,5 个 feature/fix 分支全部 -d 删除。
- 全量门禁(dev 端最终复跑):npm test 1631 通过 / 0 fail / 2 skip;typecheck、docs-check、git diff --check 全绿。
- 未 push main、未 force-push;Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未做,留给用户。

门禁: ALL_GREEN
结论: MERGED_ALL
