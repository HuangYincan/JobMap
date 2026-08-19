# 合并报告(2026-08-19)

## 结果总览
- 成功合并: w1/w2/w3/w4/w5/w6 共 6 分支,按 manifest 顺序 w2→w4→w3→w6→w5→w1 全部并入 dev 并 push
- 失败/遗留: 无
- 冲突: 仅 w1(tech/16-bug-fixes.md 文档节区,已按区域归属保留双方条目解决)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w2 | feature/auth-password | ✅ 无冲突 | 303 pass/0 fail · 绿 · 绿 · 绿 | 无 |
| w4 | fix/mobile-microfixes | ✅ 无冲突 | 304 pass/0 fail · 绿 · 绿 · 绿 | 无 |
| w3 | fix/poi-data-ux | ✅ 自动合并 | 310 pass/0 fail · 绿 · 绿 · 绿 | 无(i18n/16-bug-fixes 自动合并) |
| w6 | fix/jobs-aggregate-split | ✅ 自动合并 | 312 pass/0 fail · 绿 · 绿 · 绿 | 无 |
| w5 | feat/recent-entity | ✅ 自动合并 | 318 pass/0 fail · 绿 · 绿 · 绿 | 无(account 文件按区域自动合并;迁移自动接 015) |
| w1 | feat/poi-load-more | ✅ 有冲突已解决 | 328 pass/0 fail · 绿 · 绿 · 绿 | tech/16-bug-fixes.md 一节(见下) |

每分支合并后均 `git push origin dev` 成功;worktree 与分支已清理。

## 冲突解决清单

- **w1 vs dev(tech/16-bug-fixes.md)**:HEAD 侧为 w4 的「2026-08-19: 移动端微修」节,
  w1 侧新增「比例尺控件崩溃」+「POI 停止加载 A/B/C/D + 加载更多按钮」两节——同为
  2026-08-19 独立条目,非同一区域改写。解决:保留双方,顺序为 w4 节在前、w1 两节在后,
  无内容丢弃。
- 其余 5 个分支全程零冲突;w5 的 account.ts/account-store.ts 与已并入的 w2 按 manifest
  区域分区(密码区 vs SearchHistoryEntry/entity 区)自动合并成功。

## 遗留问题
- Env-only 步骤未执行(按约定留给用户,见 deferred-notes.md):
  - DB 迁移 apply:`014_credentials_auth.sql`(w2)、`015_recent_entity.sql`(w5)
  - `npm run import:seed:apply`(w6,群核拆分 + 墓碑行落地)
  - hz_pois 脏数据清理(w3,69.3% 行 `tel='[]'`,re-import 或 SQL UPDATE)
  - AMap geocode 不涉及
- w5 的 42703(undefined_column)回退路径与 w2 的 withDb 语义均无 DB 环境实测,依赖迁移
  apply 后验证(风险评估:低,已按 pg 错误码设计)。

## 最终 dev 状态
- `dev` = `0ff2655`,已 push origin(6 次 push:60a449d→f41658f→54058e2→bcbcab6→03caed4→6a4b1d8→0ff2655)
- 门禁最后全量:328 tests pass / 0 fail(2 skip)、typecheck 绿、docs-check 绿、git diff --check 绿
- 未 push main、未 force-push、无遗留 worktree/分支

门禁: ALL_GREEN
结论: MERGED_ALL
