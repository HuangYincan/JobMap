# 合并报告(2026-08-20)

## 结果总览
- 成功合并: ws-poi-vanish2 x 1
- 失败/遗留: 无

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-poi-vanish2 | fix/map-remount-camera | 无冲突(ort 策略) | ✅ 502 tests / 500 pass / 0 fail / 2 skipped;typecheck ✅;docs-check ✅;diff-check ✅ | 无冲突,无需解决 |

## 冲突解决清单
无。

## 遗留问题
- Next dev 按需编译/HMR 本身未消除(dev 工具行为,Deferred)
- 地图组件架构重构(超出范围,Deferred)
- 未做 Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)

## 最终 dev 状态
- dev:`1c4ab6d → 5fd4c2f`(merge commit,已 push origin/dev)
- 合并内容:createMap 初始相机改用 state(DEFAULT_MAP_CENTER/DEFAULT_MAP_ZOOM 常量)+ settle 仅默认中心附近时飞用户位置(isNearDefaultCenter 0.1 度阈值)+ 契约测试(新增 camera-center.test.mjs 3 单测、component-contracts 2 断言、pending-fly-to 断言改写)
- worktree /Users/acccan/dm-wt-poi-vanish2 已移除;分支 fix/map-remount-camera 已删除
- 未 push main、未 force-push

门禁: ALL_GREEN
结论: MERGED_ALL
