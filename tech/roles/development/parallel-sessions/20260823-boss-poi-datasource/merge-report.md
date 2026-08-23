# 合并报告(2026-08-23)

## 结果总览
- 成功合并: ws-a / ws-b / ws-c / ws-d 共 4 个(依赖序 a→b→c→d,全按 manifest)
- 失败/遗留: 0 个

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| a | fix/poi-citylist-branch | 29fc9ab, ort 自动,无冲突 | 1489 tests / 0 fail / 2 skip;typecheck ✔;docs-check ✔;diff --check ✔ | 无 |
| b | feat/poi-nominatim | 74998d9, ort 自动(site-geocode.ts / geocode-sites-apply.mjs 与 a 并行修改均自动合并),无冲突 | 1509 tests / 0 fail / 2 skip;typecheck ✔;docs-check ✔;diff --check ✔ | 无 |
| c | feat/poi-daily-run | 626b7be, ort 自动(geocode-sites-apply.mjs 与 b 并行修改自动合并),无冲突 | 1509 tests / 0 fail / 2 skip;typecheck ✔;docs-check ✔;diff --check ✔ | 无 |
| d | docs/poi-r5-runbook | 72cf016, ort 自动,无冲突 | 1509 tests / 0 fail / 2 skip;typecheck ✔;docs-check ✔;diff --check ✔ | 无 |

每次 merge 后均重跑完整门禁;每分支门禁绿后 `git push origin dev` + worktree remove + `git branch -d`。

## 冲突解决清单
- 无手动冲突。ws-b 与 ws-c 均基于 dev 现状独立实现,与 ws-a 及彼此的文件交集由 ort 自动三路合并完成;ws-b 的 `nominatimQueryVariants` 用 STREET_RE 门控地址变体、不依赖 ws-a 的 `isCityListPlaceholderAddress`(prompt 约定),合并后无语义冲突。

## 遗留问题
- **audit 复算(合并后已跑)**:`audit-city-center-pins.mjs` 核心口径与 manifest 完全一致 — centerPins 1330 / needsRerun 1076(cityList 929 / stayCenter 249 / noAddress 5);sitesTotal 2460(manifest 2410,2026-08-23 后 drops 数据源更新所致,分类计数不受影响)。
- Env-only deferred(用户执行,已记 boss-state.deferred_notes):
  1. `npm run geocode:sites:apply`(r5 全量 1076 站,三 provider ~100 次/日,约 4 天;每天跑至 QUOTA_EXHAUSTED 短路;建议 `--cities 上海` 优先;可用 `npm run geocode:sites:daily` 每日封装)
  2. `npm run import:seed:apply`(r5 后;DB 1556→对齐 JSON)
  3. UI 验证 + MODE_CACHE_VERSION bump(import 后;当前 v17,落地后 v18)
  4. Nominatim 海外站实际执行(r5 后按 tech/29 runbook)
- 其余批次 worktree(`dm-dev-merge` / `dm-wt-card-addr` / `domain-map-wt-nolod`)非本批范围,未动。

## 最终 dev 状态
- dev HEAD `72cf016`(4 个 merge commit:29fc9ab → 74998d9 → 626b7be → 72cf016),已 push origin(69355d2 → 72cf016);主树 tracked 文件干净;4 个批次分支已删、批次 worktree 已移除。

门禁: ALL_GREEN
结论: MERGED_ALL
