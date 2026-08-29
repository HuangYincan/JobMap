# 合并报告(2026-08-25)

## 结果总览

- 成功合并: s-server-semantics / d-data-completion / f-frontend-lod-pool × 3
- 失败/遗留: 无
- 合并顺序按 manifest(1 → 2 → 3),每分支门禁(server npm test + typecheck + docs-check + diff --check)全绿后才 push,红则停未触发。

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| s-server-semantics | fix/server-catalog-semantics | 25498d9(自 3d40a31) | 1651/1648 pass/3 skip · 通过 · 通过 · 通过 | 无冲突 |
| d-data-completion | fix/site-place-search | 3ca0efb | 1663/1660 pass/3 skip · 通过 · 通过 · 通过 | tech/29 §6 时间线冲突(见下) |
| f-frontend-lod-pool | fix/work-lod-marker-pool | 16a3add | 1667/1664 pass/3 skip · 通过 · 通过 · 通过 | 无冲突(tech/18 自动合并) |

3 skip 均为 DATABASE_URL 未设置的门控用例(既有 2 + s-server-semantics 新增端到端契约 1)。

## 冲突解决清单

- **tech/29-geocode-r5-status.md §6 时间线**(#2 fix/site-place-search 与 #1 均改动):HEAD 侧「(待用户,Env-only) r5 apply → bump v19(§4.5,v18 已被读路径语义修复占用)」保留(版本号已由 #1 更新,v18 被占);对侧新增的「2026-08-25 ws-d-data-completion 数据补全行」保留(事实行,唯一);对侧重复的「待用户」行及其陈旧「bump v18」弃用。解决后两分支内容全保留,无信息丢失;§4.5/§7 的 v19 表述与 #1 一致。

## 遗留问题

- **Env-only(用户执行,本批不跑)**:① geocode r5 apply 多日(`npm run geocode:sites:apply`,占比/无地址 place-search 站,建议 `--cities` 收敛);② `npm run import:seed:apply`;③ AMap/百度/腾讯 geocode 实际调用(需对应 key);④ UI 验证后 `MODE_CACHE_VERSION` bump v19(tech/29 §4.5/§7)。
- **tier 21 知悉**(f-frontend 汇报):旧「永不显示」标记公司(tier 21)现随全量展示出现;未另立字段,已在 tech/19 修订块注明。若产品意图是「黑名单隐藏」应另立字段而非绑定 zoom。
- 多城市地址列表串(北京/上海/深圳/成都)归 needsGeocode 公司名检索通道,不走 place-search(d-data-completion 口径决策,见其汇报「关键口径决策」1)。
- 未 push main、未 force-push;worker 分支(3 个)与 worktree(3 个)已清理。
- CHANGELOG.md 已由合并方补 2026-08-25 条目(s-server-semantics 汇报约定,commit 09de7c9)。

## 最终 dev 状态

- dev HEAD = 09de7c9(docs(changelog) 2026-08-25 条目),已 push origin/dev(16a3add → 09de7c9)。
- 本地 dev 工作树干净(仅批次 metadata 目录 untracked,属预期)。
- 全量套件最终口径:1667 tests / 1664 pass / 3 skip / 0 fail;typecheck 0 错误;docs-check 通过;diff --check 通过。

门禁: ALL_GREEN
结论: MERGED_ALL
