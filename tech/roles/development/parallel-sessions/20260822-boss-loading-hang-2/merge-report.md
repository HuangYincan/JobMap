# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-gate-a、ws-eng-meta × 2
- 失败/遗留: 无

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-gate-a | fix/gate-a-guard | f25ad78 | 1460 tests / 1458 pass / 0 fail / 2 skip ✓ | typecheck ✓ / docs ✓ / diff ✓ | 无冲突 |
| ws-eng-meta | fix/mount-error-engine | 245039d | 1461 tests / 1459 pass / 0 fail / 2 skip ✓ | typecheck ✓ / docs ✓ / diff ✓ | 无冲突 |

## 冲突解决清单
- 两分支文件不相交(home-map/i18n/契约测试 vs mount/use-map-engine/mount 测试),合并全程零冲突,无需取舍。

## 遗留问题
- ws-eng-meta worktree 遗留未跟踪 `verify-mount-engineid.mjs`(临时验证脚本,无 commit 引用);worktree 已 `--force` 移除,不影响仓库。
- Preflight 时主树 `server/next-env.d.ts` 有生成文件残留(`.next/dev/types` → `.next/types`,Next 自动生成、不应手工编辑),已 `git checkout --` 还原;非本批次分支产物。
- Env-only 步骤无涉及(无迁移 apply / import:seed:apply / AMap geocode)。
- 用户侧:round-1 遗留 dev server(PID 已更替)重启是复测前提(见 boss-state.md adjudication_log)。

## 最终 dev 状态
- `dev` @ 245039d(= a3ed96e → f25ad78 → 245039d),已 push origin/dev。
- worktree 已清理:dm-wt-gate-a、dm-wt-eng-meta;分支 fix/gate-a-guard、fix/mount-error-engine 已删除。

门禁: ALL_GREEN
结论: MERGED_ALL
