# ws-u 续作汇报: F2 补 domain(地图)模式候选类别列表(2026-08-19)

## 背景

用户 F2 原话「地图poi用户没选类别时在原来展示poi卡片的位置给一个候选类别列表」——上一轮 ws-u 只把候选类别 chips 做在了 work 模式,domain 模式仍是旧空态。本轮在现有 F2 机制上补 domain 分支,work 候选保留不动。

## 实际改动

- `server/src/components/secondary-sidebar.tsx`(53+/3-)
  - 新增 `domainCandidateCategories(mode, query, filters)`:`canonicalMode !== "domain"` / 有 query / 已选 `filters.category` → 返回空;否则从 `getMode(mode).filters` 中 `key === "category" && type === "select"` 的配置取 `options`(即 CATEGORY_OPTIONS 9 类:餐饮/购物/景点/休闲娱乐/交通/酒店/医疗/教育/公司)生成 chips。数据源与 work 分支同源(getMode),与 FilterPanel 单选 select 语义一致。
  - 新增 `candidateCategoriesFor(mode, query, filters)` 合并助手:work + domain 两分支结果拼接(两模式互斥,至多一方非空);组件内 `candidateChips = candidateCategoriesFor(mode, query, filters)`,桌面空态槽位因此同时覆盖 domain。
  - 新增 `pickCategoryFilter(filters, mode, key, value)`:chip 点击写 filters——单选(`type === "select"`,如 domain category)写字符串 `value`,多选(work jobTaxonomy/roleFamily)写 `[value]`(保持原 work 行为)。`onPickCategory` 改走该助手。
  - 保留 `domainNoCategory` 与 `emptyTitle={domainNoCategory || candidateChips.length > 0 ? t("pickCategory") : undefined}` 不变:未选类且候选非空时,空态槽位在「选择类别开始浏览」标题下渲染候选类别卡片(chips 网格),点 chip → 写 `filters.category` → 主加载 effect 依赖 `filters.category` 自动拉取该类 poi(poi-category-loading 门控链路,无新增加载代码)。
- `server/src/components/map-shell.tsx`(4+/4-)
  - 移动抽屉同链路:`mobileCandidateChips = candidateCategoriesFor(mode, query, filters)`(原 `workCandidateCategories`),`onPickCategory` 改走 `pickCategoryFilter`;domain 未选类时抽屉空态同样出「选择类别开始浏览」+ chips。
- `server/tests/component-contracts.test.mjs`(29+/5-)
  - 既有 F2 work 契约测试的接线断言随新助手更新(行为不变:work 未选类仍出 job-family/职能 chips,点击写数组)。
  - 新增 `domain no-category empty state renders candidate category chips (single-select write)` 契约测试:domain 分支守卫、数据源 = getMode 的 category select、合并助手、pickCategoryFilter 单选写字符串、domainNoCategory 空态标题、移动抽屉同链路。

## 门禁结果

- npm test: 455 通过(453 pass / 2 skip / 0 fail;CLAUDE.md 基线 423 → 455 系 ws-u/ws-v 上轮合并新增)
- typecheck: 通过(tsc --noEmit,无错误)
- docs-check: 通过("Documentation policy check passed")
- git diff --check: 通过(无空白错误)

## 遇到的问题

- 无阻塞问题。两点说明:
  - `make docs-check` 首次报 "No rule to make target" 是因为上一命令把 cwd 留在 `server/`,回到 worktree 根后正常通过(非真实失败)。
  - 既有契约测试中两处接线正则(组件内 `candidateChips = workCandidateCategories(...)`、`onPickCategory` 内联写数组)随实现改走合并助手/写值助手,已在同一测试文件同步更新;work 模式行为契约(数据源、守卫、写数组)全部保留断言,未弱化。

## 证据

- `npm test` 尾部:`ℹ tests 455 / pass 453 / fail 0 / skipped 2`
- 契约测试含新增 domain 用例,全绿;typecheck 无输出(clean)。
- commit 序列(worktree /Users/acccan/dm-wt-ws-u,分支 feat/category-prefs-followup):
  - `1bbe229` feat(ws-u): domain candidate category chips in empty state + pickCategoryFilter single/multi write
  - `83a08a4` feat(ws-u): wire domain candidate categories into mobile drawer POIList (same helper)
  - `8ac8228` test(ws-u): contract tests for domain candidate categories + updated F2 work wiring

## 自查

- 只动了任务允许的文件(secondary-sidebar.tsx / map-shell.tsx / tests/*);poi-list.tsx、modes.ts、hooks 零改动;未 merge / 未 push;分支与 worktree 留原地。

门禁: PASSED
结论: OK
