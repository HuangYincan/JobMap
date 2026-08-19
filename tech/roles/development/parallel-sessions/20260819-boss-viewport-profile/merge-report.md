# 合并报告(2026-08-19)

## 结果总览

- 成功合并: ws-a / ws-b / ws-v / ws-u × 4
- 失败/遗留: 无(0 红停)
- 冲突: 2 次(均在 `server/tests/component-contracts.test.mjs`,独立测试块并置,无「不碰」冲突)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-a | fix/first-select-locate | c066b5b ✅ | 448/446/2 ✅ tsc ✅ docs ✅ diff ✅ | 无 |
| ws-b | fix/profile-overlay | 3a5b255 ✅ | 449/447/2 ✅ tsc ✅ docs ✅ diff ✅ | component-contracts.test.mjs:ws-a Bug1 契约块 vs ws-b logout 契约块 → 两块并置 |
| ws-v | feat/viewport-full | bf82161 ✅ | 452/450/2 ✅ tsc ✅ docs ✅ diff ✅ | 无(auto-merge) |
| ws-u | feat/category-prefs | 028bb25 ✅ | 454/452/2 ✅ tsc ✅ docs ✅ diff ✅ | component-contracts.test.mjs:HEAD(Bug1+logout 两块)vs ws-u(F2 chips+F3 下拉两块)→ 四块并置 |

注:门禁数字为合并后 dev 全量实测(基线 9b5f94a:447/445/2)。

## 冲突解决清单

1. **ws-b × ws-a(component-contracts.test.mjs)**:`<<<<<<< HEAD` 区为 ws-a「Bug1 卡片/建议选中置位」契约用例,`>>>>>>>` 区为 ws-b「logout 重置 savedOverlay」契约用例。两用例互不依赖、断言目标不同代码段 → 删除标记保留两块(首次提交漏删尾部标记,`git commit --amend` 修正,最终 0 标记)。
2. **ws-u × dev(component-contracts.test.mjs)**:HEAD 侧为 ws-a Bug1 + ws-b logout 两个测试块,ws-u 侧为 F2 work 候选类别 + F3 Profile 下拉两个测试块。四块独立、无断言重叠 → 并置,补齐两侧被公共 `});` 吞掉的块尾闭合。

## 遗留问题

- **移动抽屉覆盖(Bug2 主因)**:ws-b 判定 `.mobileDrawer` 全开态顶部已留 ~32px 地图条带(顶边=指南针中心语义),非全屏无露出,未做 60px 视觉改动,记入 `deferred-notes.md`,留待 boss 裁决。
- **use-mode-cache-restore.ts 边界**:ws-v 在「只动」清单外改 2 行(还原时 listCatalog=catalog),为缓存还原路径必经,已确认必要,无后续动作。
- **F2/F3 浏览器行为复验**:未做 Playwright 视觉验证(纯逻辑/接线改动,契约测试覆盖),留待 VERIFY 阶段。
- 其他并行批次(20260819-auth-explore-poi 等)目录仍 untracked,非本批次范围。

## 最终 dev 状态

- `dev @ 028bb25`(MERGED_ALL),已 `git push origin dev`(9b5f94a → 028bb25)
- 4 个 worktree 全部移除、4 个分支全部 `-d` 删除
- 合并链:9b5f94a → c066b5b(ws-a)→ 3a5b255(ws-b)→ bf82161(ws-v)→ 028bb25(ws-u)
- 全量门禁:`npm test` 454 通过 / 452 pass / 2 skip;`tsc --noEmit` 干净;docs-check 通过;`git diff --check` 干净
- 未动 main、未 force-push;Env-only 步骤(迁移/seed/geocode)未做

门禁: ALL_GREEN
结论: MERGED_ALL
