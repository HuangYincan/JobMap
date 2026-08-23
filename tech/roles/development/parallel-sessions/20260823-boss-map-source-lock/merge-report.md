# 合并报告(2026-08-23)

## 结果总览
- 成功合并: ws-map-source、ws-saved-default 共 2 个
- 失败/遗留: 无

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-map-source | feature/map-source-lock | 无冲突,`8ec9f1a` | 1487 tests / 1485 pass / 0 fail / 2 skip;typecheck 通过;docs-check 通过;diff --check 通过 | 无冲突 |
| ws-saved-default | feature/saved-layer-default-off | 无冲突(auto-merge 一处 contracts 测试文件),`69355d2` | 1487 tests / 1485 pass / 0 fail / 2 skip;typecheck 通过;docs-check 通过;diff --check 通过 | 无冲突(component-contracts.test.mjs 两分支各自改动行不同,自动合并) |

## 冲突解决清单
- 无手动冲突解决。两分支各自改动边界(engine-registry.ts / use-saved-layer.ts 及其对应契约测试行)互不重叠,`component-contracts.test.mjs` 不同行(L772-773 与 L652)自动合并。

## 遗留问题
- 无。两个 ws 均完成、门禁全绿;Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)按规矩未执行,留给用户。
- deferred-notes.md 为空(两 ws 无新增 deferred)。

## 最终 dev 状态
- `dev` = `69355d2`(含两条 merge commit:`8ec9f1a` ws-map-source、`69355d2` ws-saved-default),已 push origin。
- 两个 worktree(`dm-wt-map-source` / `dm-wt-saved-default`)已移除,两分支已删除。
- 未 push main、未 force-push。

门禁: ALL_GREEN
结论: MERGED_ALL
