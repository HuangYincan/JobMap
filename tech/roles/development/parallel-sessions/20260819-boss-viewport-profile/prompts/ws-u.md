# ws-u — F2 候选类别列表(未选态)+ F3 Profile 偏好下拉

## 背景(Explore 已确认,dev 9b5f94a)

### F2 候选类别列表
- work 模式**无类别门控**:当前只有 domain 有 `!query && !filters.category` 门控(map-shell.tsx:850-854),work 未选类别也直接显示全部卡片。空态 UI 在 poi-list.tsx:138-159(搜索图标+emptyTitle+hint+「扩大范围」)。
- 「类别」work 语义 = `jobTaxonomy`(intern/campus/social 树)+ `roleFamily`(职能多选)。`getMode(mode).filters`(modes.ts:99-138 = workFilterConfigs)与 `/api/filter-options`(route.ts:30-35)同源、静态,客户端可直接用 `getMode`,**无需新增 API**。
- 候选类别列表应放 **POIList 空态槽位**(poi-list.tsx:138-159 现空态区),渲染 job-family/function 分类 chips,点击直接 `onFiltersChange({...filters, jobTaxonomy/roleFamily})`。chips 样式复用 filter-panel.module.css 的 chips/chip(与 TaxonomyControl 同一套,Apple/liquid glass:玻璃卡片容器 + #007AFF 高亮 + 绿仅薪资/工时)。

### F3 Profile 偏好下拉
- 「偏好」两行(map-shell→account-panel.tsx:542-576)是 **pill 切换**,非下拉:language 中文/English、defaultMode 地图/工作。
- 「求职偏好」已是**下拉框**:`PrefField`(account-panel.tsx:69)/`renderPrefTrigger`(343-374)/玻璃浮层 `PrefMenu`(112-196,portal 到 body)/`renderPrefMenu`(386-432),支持单/多选,勾选即存 `persistPrefs`→`onSave`→`PATCH /api/auth/me`→DB `users.preferences` jsonb(后端已支持 language/defaultMode,account.ts:33-38,route.ts:33-42)。**后端零改动**。

## 修复方向

### F2(最小改动,补 work 未选类别空态候选列表)
1. 在 `secondary-sidebar.tsx` / `map-shell.tsx` 的 vez:给 work 模式算「未选类别」:`!query && !jobTaxonomy && !roleFamily`(参考 domain 的 `domainNoCategory`)。未选 → 在 POIList 空态槽位渲染**候选类别列表**(分类 chips:jobTaxonomy 家族 intern/campus/social + roleFamily 职能),点击写 filters。
2. **注意与 F1(ws-v)的关系**:F1 让 work marker 保持全量,本 WS 只改「列表区未选态显示候选类别」——未选时列表区显示候选类别,地图仍全量(不冲突)。若 ws-v 引入 listCatalog,本 WS 的「未选→候选类别」判定基于 filters 而非 catalog 是否空(保持独立)。
3. 类别列表数据源 `getMode(mode).filters`,chips 复用 filter-panel.module.css。

### F3(复用 PrefField/PrefMenu,零新组件)
4. 把「偏好」的 language/defaultMode 两行从 pill 换成 `PrefField` + 浮层下拉,与「求职偏好」交互完全一致:扩 `PrefField` 的 field 类型或新加两个单选 PrefField(`multi=false`,onSelect 即关浮层);选项 language=[中文,English]、defaultMode=`ACTIVE_MODES.map(getMode(m).name)`。
5. 持久化链路不动:同 `persistPrefs`→`onSave`→PATCH。后端零改动。
6. **改现有 UI 设计?**:这是「交互形式一致化」(pill→下拉)而非布局/视觉重排,遵循现有 PrefMenu 样式(Apple/liquid glass),属正常派发。

> 设计:下拉浮层复用现有 `PrefMenu` 玻璃样式(backdrop-blur + 半透明 + #007AFF 选中勾),option 单选时点即收;触发钮显示当前值 + chevron。布局维持两行 label + 触发钮。候选类别 chips 卡片为玻璃容器(padding 12-16,radius 14,border 1px 半透明白),选中态 #007AFF 描边/底。

## 测试(必做)

- 现有 tests 全绿;新增契约:work 未选类别 → 候选类别 chips 渲染(poi-list/secondary 契约)、点击写 filters;Profile 偏好走 PrefField 下拉(account-panel 契约:language/defaultMode 在 PrefField 体系内、onSave 链路同求职偏好)。
- UI 为主 → 契约测试用 readFileSync 断言(仓库既有模式),行为由浏览器 VERIFY 阶段复验。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-wsU)

- 只动:`server/src/components/poi-list.tsx`、`server/src/components/secondary-sidebar.tsx`、`server/src/components/filter-panel.tsx`(如需复用 chips)、`server/src/components/account-panel.tsx`、`server/src/components/map-shell.tsx`(F2 未选传给列表;F3 若触发钮在 shell)、`server/tests/*`
- **不碰**:`server/src/hooks/*`、`server/src/lib/viewport-search.ts`/`mode-cache.ts`(ws-v)、`server/src/lib/account-store.ts`/`server/src/lib/modes.ts`(qa 已绿;F3 后端零改动)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsU/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsU && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-viewport-profile/reports/ws-u.md`:
改动文件 + 实现(F2 候选类别 / F3 偏好下拉)+ 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。

## 续作附录(boss 2026-08-19,预算超限中断,零产出)

首次派发预算超限 exit 1,零 commit 零改动(worktree 停 9b5f94a)。开工 `git status` 确认后**按正文完整实现**,但务必小步 commit:
1. **先做 F2(候选类别列表)**:work 未选类别(无 query/jobTaxonomy/roleFamily)→ POIList 空态槽位渲染候选类别 chips(数据 getMode(mode).filters,样式复用 filter-panel chips)。commit。
2. **再做 F3(偏好下拉)**:language/defaultMode 从 pill 改 PrefField/PrefMenu 下拉(复用 renderPrefTrigger/renderPrefMenu,加两个单选分支)。commit。
3. 契约测试(F2 chips 渲染+点击写 filters;F3 PrefField 内)commit。
4. 完整门禁 + 写报告。
5. 预算纪律:每步 commit 再验证,别一次大改。
