# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-1 x 1
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-1 | fix/saved-layer-card | `--no-ff` 干净合并(9af00b3),零冲突(i18n.ts / map-shell.tsx / component-contracts.test.mjs 自动合并,键位与改区不相交) | npm test 1187(1185 pass/2 skip/0 fail)/typecheck 通过/docs-check 通过/diff --check 通过 | 无冲突 |

## 冲突解决清单
- 无(ws-1 分支 4 commits:POICard onRemove 移除按钮 + savedPlacesToListPois 桥接、桌面/移动收藏模式换 POIList 卡片、handlePickRecent 收藏门控、回归测试 + docs;与 dev 现 i18n 键位/契约断言不相交,全部自动合并)。

## 遗留问题
1. **Preflight 异常(已吸收)**:进入时主工作树处于上一批(navi)未完成的 `feature/agent-completion-ui` merge 状态;navi merger 并发运行于 03:16 完成该 merge(01b6617)并 push origin/dev,门禁自证全绿(1175 pass/0 fail/2 skip)。本批合并基于该最终 dev 状态执行,测试全绿无回归。
2. **主树未提交残留(非本批,未触碰)**:`server/data/recruitment/official-career/蔚来.json`(用户 geocode 数据,address-first 批次 deferred)、`server/next-env.d.ts`(Next 自动生成,dev/types 路径漂移)、navi 批次 README.md/merge-report.md(该批次 merger 编辑、待 boss 批次入库)——一律未动,留给对应 owner 处置。
3. Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未执行,留给用户。
4. 未 push main、未 force-push。

## 最终 dev 状态
- dev `01b6617` → `9af00b3`(merge fix/saved-layer-card: 4c04b15 + 31a3bb0 + 3e33727 + d026262),已 push origin/dev(`01b6617..9af00b3`)。
- worktree `/Users/acccan/dm-wt-saved-card` 已移除;分支 `fix/saved-layer-card` 已删除。

门禁: ALL_GREEN
结论: MERGED_ALL
