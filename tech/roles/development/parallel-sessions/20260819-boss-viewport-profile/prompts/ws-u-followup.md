# ws-u 续作附录 2 — F2 补 domain(地图)模式候选类别列表

## 背景

用户 F2 原话:「地图poi用户没选类别时在原来展示poi卡片的位置给一个候选类别列表」。措辞「**地图**poi」(vs F1 的「**工作**poi」)指 **domain(地图)模式**。前一轮 worker 把候选类别 chips 做在了 work 模式(workCandidateCategories,仅 work),domain 模式仍是旧空态「选择类别开始浏览」+ 提示——**用户要的是 domain 模式**。

现状(dev 已合并,worktree /Users/acccan/dm-wt-ws-u 分支 feat/category-prefs 停在 8a50fc2,与 dev 同内容):
- `secondary-sidebar.tsx:208` `domainNoCategory = config.kind === "domain" && !filters.category && !query.trim()` → 空态 `emptyTitle={t("pickCategory")}`(secondary-sidebar.tsx:499)。
- `CATEGORY_OPTIONS`(modes.ts:50-60)已含 9 类(餐饮/购物/景点/休闲娱乐/交通/酒店/医疗/教育/公司),`getMode(mode).filters.category.options` 同源(workCandidateCategories 助手已示范从 getMode 取)。
- POIList 已支持 `candidateCategories` / `onPickCategory` props(poi-list.tsx,上轮加的),**work 模式已在用**。

## 修复(最小改动,在现有 F2 机制上补 domain 分支)

1. `secondary-sidebar.tsx`:把候选类别判定从「仅 work」扩为「work 或 domain 未选类」——新增 `domainCandidateCategories`(或扩 `workCandidateCategories` 为通用 `candidateCategoriesFor(mode, query, filters)`):domain 时 `!query && !filters.category` → 从 `getMode(mode).filters.category.options`(CATEGORY_OPTIONS)取 chips;点击 `onFiltersChange({...filters, category: value})`(注意 domain 是单选:category 直接存字符串而非数组,参考现有 FilterPanel 的 domain category 语义)。
2. `domainNoCategory` 空态与候选 chips 的关系:未选类且候选 chips 非空 → 空态槽位显示候选类别卡片(chips 网格),保留原「选择类别开始浏览」语义文案作为标题或提示;点 chip → 写 filters.category → 加载该类别 poi。
3. map-shell.tsx 移动抽屉若已接线 work 候选(上轮),补 domain 候选接线(同一助手)。
4. work 模式候选(上轮已做)保留,不动。

## 测试(必做)

- 契约测试:domain 未选类 → 候选 chips 渲染(数据源 = getMode(mode).filters.category.options)、点击写 `filters.category`(单选字符串)、work 候选不受影响;既有 F2 work 契约、其余全绿。
- typecheck / docs-check / diff-check 全绿。

## 文件边界(worktree = /Users/acccan/dm-wt-ws-u,分支 feat/category-prefs)

- 只动:`server/src/components/secondary-sidebar.tsx`、`server/src/components/map-shell.tsx`(若需)、`server/tests/*`
- **不碰**:poi-list.tsx 的 chips 渲染(已通用)、`server/src/lib/modes.ts`、`server/src/hooks/*`、ws-v 区域

## 门禁

```bash
cd /Users/acccan/dm-wt-ws-u/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-ws-u && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-viewport-profile/reports/ws-u-followup.md`:
改动 + domain 候选类别实现 + 测试 + 问题。末两行 token(门禁: PASSED|FAILED / 结论: OK|BLOCKED)。

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit。
