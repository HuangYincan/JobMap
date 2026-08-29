# 批次 Manifest — 20260826-boss-post-geocode(geocode 数据落地善后)

背景:用户已执行 r5 apply(Env-only,2026-08-25 晚),boss 已把 135 个数据文件
(address/lng/lat 三字段纯净 diff,占位/中心钉 → 真实办公点)提交为 `313fc61`。
按 tech/29 既定计划做数据落地善后。

## Workstream(1 个)

| ws | 分支 | worktree | 主题 | 合并顺序 |
|---|---|---|---|---|
| p-cache-snapshot | fix/post-geocode-cache-v19 | /Users/acccan/dm-wt-p-cache-snapshot | MODE_CACHE_VERSION v19 bump + city-center-pins 计数快照更新 + tech/29 状态推进 | 1 |

门禁:`cd server && npm test` + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/p-cache-snapshot.md。Worker 不 merge、不 push、不碰主树、不跑 geocode/import。

## final (2026-08-26)
- FINISHED — worker PASSED (1666 pass, 快照基准实测 941 纠正 boss 预估 977);merge `1f79367` 已 push origin/dev
- boss VERIFY: 主树 1669 tests / 1666 pass / 0 fail / 3 skip;CI run 32908588824 success (62s)
- dev 链: a7aa7e6 → 313fc61 (数据落地) → merge 1f79367 (v19 + snapshot + tech/29 v2.2)
