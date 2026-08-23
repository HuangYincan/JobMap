# 20260822-boss-filter-unicorn — 筛选「莫名勾选独角兽」bug

## 目标
用户报告:筛选面板莫名勾选上「独角兽」(work 模式公司规模筛选 scale=unicorn)。Explore 已定位两处根因(2026-08-22)。

## 根因(Explore)
1. **主因(缓存残留,F5 复现)**:`map-shell.tsx:1052-1061` load effect 刻意不依赖 filters(注释:minRating/price 不重搜);`writeModeCache` 只在 load() 内(`:914`/`:1014`)。某次 load 时 filters 含 unicorn(如点 `#独角兽` 建议,query 清空触发 load)→ 连同过滤后 catalog 写进缓存;用户随后面板取消勾选 → setFilters 无重载 → **缓存仍残留 scale:['unicorn']**;F5/重开 → `use-mode-cache-restore.ts:54` 全量还原 → 独角兽「莫名」勾选。切模式不自愈反向(handleModeChange `:1637-1646` 会把当前正确 filters 写回,所以只有刷新路径坏)。
2. **次因(切模式闭包 stale filters)**:`handlePickRecent` → `openExploreSearch(replay.query)`(`:1937-1940`/`:1959-1963`);modeChanged 时 `openExploreSearch` 闭包 deps `[query, filters]` 拿的是切换前旧 filters 做 merge → 旧模式 filters 带进新模式。

排查:2026-08-22 收藏批次(互斥/门控)不触碰 filters 链路,非回归;默认值/pickCategoryFilter/候选 chips 均不含 scale。历史记录不存 filters(guest-search-history.ts:65-71 仅 query/mode/entity)。

## Workstream
| ws | 分支 | worktree | 主题 | 门禁 |
|---|---|---|---|---|
| ws-1 | fix/filter-unicorn | ../dm-wt-filter-unicorn | 缓存残留 + 闭包 stale filters 修复 | typecheck + npm test + docs-check + 回归测试 |

## 合并顺序
1. ws-1(唯一)
