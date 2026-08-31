# Batch 20260819-auth-explore-poi — Manifest

> 目标(用户大单):探索「加载更多」+ POI 加载修复、账户密码登录注册、POI 电话/评价展示、岗位多合一修复、移动端 profile 滚动重置、最近点击回实体、搜索框失焦丢文本。

## 根因摘要(Explore 已完成)

| 问题 | 根因 | file:line |
|---|---|---|
| POI 不新增/不展示 | 失败永久 noMore;AMap 无超时卡死 loadingRef;skipFetch 吞视口刷新;noMore 误判 | map-shell.tsx:830/848/748/860;amap-api.ts:343-368;viewport-search.ts:356/405 |
| 比例尺控件崩溃(appendChild/removeChild) | resize 监听泄漏(cleanup 孤儿)+ 销毁后访问 + 双 addControl 竞态 | map-shell.tsx:484-488/588-596/617-643/690-710 |
| 密码登录缺失 | 只有 OTP demo(000000)+ 假社交;无 username/password 列/路由 | auth-modal.tsx;account.ts:40-61;005/007 迁移 |
| POI 电话 [] | CSV 空电话存字面量 '[]'(69.3% 行),导入/映射/渲染都不清洗 | hz-poi-import.ts:180;hz-poi-store.ts:119;poi-detail.tsx:123 |
| 暂无详细评价 | DB 无评价数据;AMap 路径有 reviews/reviewCount | poi-detail.tsx:245-286;i18n noReviews |
| 岗位多合一 | 上游快照聚合行 + aggregate 标记导入时丢弃 + 前端通用兜底文案 | radar_jobs.py;recruitment-import.ts:355;jd-panel.tsx:33-43 |
| 移动端 profile 滚动继承 | drawerContent 常驻,openMobileAccount 不重置 scrollTop | map-shell.tsx:1681-1694/2394 |
| 最近点击只填搜索框 | SearchHistoryEntry 只有 query,无实体字段 | account.ts:56-61;map-shell.tsx:1756-1760 |
| 搜索框失焦丢文本 | CSS `.searchBox input {opacity:0}` 仅 :focus-within 可见 | map-shell.module.css:391-401 |

## Workstream 表

| ws | 主题 | 分支 | worktree | 汇报 | 门禁 |
|---|---|---|---|---|---|
| w1 | 加载更多 + POI 增量修复 + Scale 崩溃 | feat/poi-load-more | /Users/acccan/dm-wt-w1 | reports/w1.md | npm test/typecheck/docs-check |
| w2 | 账户密码登录 + 注册 | feature/auth-password | /Users/acccan/dm-wt-w2 | reports/w2.md | 同上 |
| w3 | POI 电话 [] 隐藏 + 评价/查看评价链接 | fix/poi-data-ux | /Users/acccan/dm-wt-w3 | reports/w3.md | 同上 |
| w4 | 移动端 profile 滚动重置 + 搜索框失焦丢文本 | fix/mobile-microfixes | /Users/acccan/dm-wt-w4 | reports/w4.md | 同上 |
| w5 | 最近点击回实体 | feat/recent-entity | /Users/acccan/dm-wt-w5 | reports/w5.md | 同上 |
| w6 | 群核岗位拆分 + 聚合岗位诚实展示 | fix/jobs-aggregate-split | /Users/acccan/dm-wt-w6 | reports/w6.md | 同上 |

## 合并顺序(依赖序,红则停)

1. w2(auth 基础:account.ts/store/迁移)→ 2. w4(小修,map-shell 独立区)→ 3. w3(poi 数据展示)→ 4. w6(jobs 数据)→ 5. w5(recent,依赖 w2 的 account 基础)→ 6. w1(最大,最后)。

## 同文件分区约定(冲突以区域归属解决)

- map-shell.tsx:w1(Scale/load/handleNeedMore ~484-868,1206-1218,2075-2078)、w4(openMobileAccount ~1681-1694、搜索框 ~1938-1965)、w5(handlePickRecent ~1756-1760、suggestion ~1520-1523)互不重叠。
- account.ts/account-store.ts:w2(密码区域)、w5(SearchHistoryEntry/entity 区域)互不重叠。
- poi-detail.tsx:w3(电话行+ReviewSection ~123,245-286)、w6(岗位行 ~154-230)互不重叠。
- i18n.ts:各 WS 只加自己的键。

## Env-only(不执行,见 deferred-notes)

- DB 迁移 apply(w2/w5)、`import:seed:apply`(w6)、hz_pois 脏数据清理(w3)。
