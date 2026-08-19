# 合并报告(2026-08-20)

## 结果总览
- 成功合并: ws-poi-vanish x 1
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-poi-vanish | fix/poi-first-click-camera | 无冲突 merge 成功(commit cd360dd, no-ff) | 495 pass / 0 fail / 2 skip;typecheck 通过;docs-check 通过;diff --check 通过 | 无冲突,无需解决 |

## 冲突解决清单
- 无。

## 遗留问题
- 无。Deferred(不在本批范围):聚合徽章下钻到城市行政中心;Env-only(无)。

## 最终 dev 状态
- dev = cd360dd(merge commit),已 push origin/dev(1d80ef9..cd360dd)。
- worktree /Users/acccan/dm-wt-poi-vanish 已移除;分支 fix/poi-first-click-camera 已删除。
- 修复内容:首点 pin/卡片/空白点击不再抑制 geolocation settle 相机跟随(hasInteractedRef → userMovedMapRef,仅相机手势与 5 个 flyTo 入口置位);handleLocate 失败保持视野不回杭州默认中心;distance 圆心在定位前不落杭州默认值(effectiveFilters 剥离 distance 键)。

门禁: ALL_GREEN
结论: MERGED_ALL
