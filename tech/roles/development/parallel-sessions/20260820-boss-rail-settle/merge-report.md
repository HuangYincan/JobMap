# 合并报告(2026-08-20)

## 结果总览

- 成功合并: w1 x 1
- 失败/遗留: 无

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | fix/settle-user-interaction-gate | 870af90(no-ff,无冲突) | 500 pass / 0 fail / 2 skip(npm test);typecheck 通过;docs-check 通过;git diff --check 通过 | 无冲突(分支恰在 dev 之上 1 commit,d61e720→863f7f2) |

## 冲突解决清单

无冲突,无需人工取舍。

## 遗留问题

1. **浏览器实测未做**(worker 汇报已声明):Turbopack dev 无法启动(node_modules symlink),未启用 webpack 兜底。留给 boss VERIFY 阶段复验:Playwright + grantPermissions + geolocation 延迟 5s —— 首点 rail item 后 resolve 不再 13→15 跳变(交互门控生效);对照组不交互 → resolve 仍 13→15(自动定位保留)。
2. **worker 边界外改动报备**:`server/tests/pending-fly-to.test.mjs`(L60-63)与 `server/tests/component-contracts.test.mjs`(L449-454/L489)共 4 处 settle 门控正则由「双门控」同步为「三门控」(`!userMovedMapRef.current && !userInteractedRef.current && isNearDefaultCenter(...)`)。属门控改动的直接必然结果(不改则契约测试必挂),已在合并后门禁全绿验证,无新增断言、无其他改动。boss 若不认可可另行裁决。
3. Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未做,按规约留给用户。

## 最终 dev 状态

- 870af90 `Merge branch 'fix/settle-user-interaction-gate' into dev`(d61e720 + w1,已 push origin dev)
- 主工作树干净;worktree `/Users/acccan/dm-wt-w1` 已移除;分支 `fix/settle-user-interaction-gate` 已删除

门禁: ALL_GREEN
结论: MERGED_ALL
