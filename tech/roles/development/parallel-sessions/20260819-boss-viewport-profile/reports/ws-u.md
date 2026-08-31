# ws-u 汇报(2026-08-19)

> 续作:首次派发预算超限中断(零产出),本次从 9b5f94a 完整实现,按 F2 → F3 → 测试 → 门禁 小步提交。

## 实际改动

### F2 候选类别列表(work 未选类别空态)
- `server/src/components/poi-list.tsx` → 新增 `candidateCategories` / `onPickCategory` props;空态槽位(搜索图标 + emptyTitle + hint + 「扩大范围」之间)渲染候选类别 chips 玻璃卡片(`styles.candidateCard` + `filterStyles.chip`,与 TaxonomyControl 同一套 filter-panel chips);chip 点击 `onPickCategory(key, value)`。
- `server/src/components/poi-list.module.css` → 新增 `.candidateCard` 玻璃容器(padding 14 / radius 14 / border 1px 半透明白 / backdrop-blur 20px saturate 165%)+ 暗色模式变体。
- `server/src/components/secondary-sidebar.tsx` → 导出 `workCandidateCategories(mode, query, filters)` 助手:仅 work(`canonicalMode === "work"`),无 query / jobTaxonomy / roleFamily 时从 `getMode(mode).filters` 取 jobTaxonomy 家族(实习/校招/社招)+ roleFamily 职能(技术/产品/运营/设计)chips;判定基于 filters 而非 catalog(与 ws-v listCatalog 解耦)。桌面 POIList 接线:`emptyTitle`(domainNoCategory || chips 非空 → pickCategory)+ `candidateCategories` + `onPickCategory={(...filters, [key]: [value])}`。
- `server/src/components/map-shell.tsx` → 移动抽屉 POIList 同步接线(`mobileCandidateChips` 复用同一助手;`setFilters({ ...filters, [key]: [value] })`)。地图 marker 不动(F1 全量语义保留)。
- 未动 `lib/modes.ts` / `lib/job-taxonomy.ts`(仅 import 只读)。

### F3 Profile 偏好下拉
- `server/src/components/account-panel.tsx` → `PrefField` 类型扩 `"language" | "defaultMode"` 两个单选字段;「偏好」两行从 pill 切换改为 `renderPrefTrigger`(label + 当前值 + chevron),复用 `PrefMenu` 玻璃浮层(portal 到 body、#007AFF 选中勾、单选 onSelect 即关浮层)。选项:language=[中文, English];defaultMode=`ACTIVE_MODES.map((m) => ({ id: m, label: getMode(m).name }))`。保存链路不变:`persistPrefs` → `mergePreferences` → `onSave` → `PATCH /api/auth/me`。后端零改动,pill 代码已移除。

### 测试
- `server/tests/component-contracts.test.mjs` → 新增 2 条 readFileSync 契约:① work 未选类别 → POIList 候选 chips props/渲染/复用 filter-panel chips/玻璃容器 CSS + sidebar 助手数据源/未选判定 + 桌面/移动接线;② account-panel PrefField 含 language/defaultMode、触发钮/浮层选项、persistPrefs 保存链、pill 已移除。既有 `pickCategory` emptyTitle 断言随新表达式更新(行为不变)。

## 门禁结果
- npm test: 449 通过(447 pass / 2 skip)/ 0 失败
- typecheck / docs-check / git diff --check: 全部通过

## 遇到的问题
- 既有契约测试断言 `emptyTitle={domainNoCategory ? ...}` 单行形式,改造后为多行表达式 → 更新断言为新表达式(意图不变,测试语义保持)。
- worktree 路径:prompt 写 `/Users/acccan/dm-wt-wsU`,实际沙箱授权目录为 `/Users/acccan/dm-wt-ws-u`(macOS 大小写不敏感,同一目录;git 确认 tip 9b5f94a、分支 feat/category-prefs 与 prompt 一致)。
- 行为复验(浏览器 VERIFY 阶段):F2 需在 work 未选类别且列表空时看候选 chips、点击后列表刷新;F3 需打开 Profile → 偏好两行下拉、选择即存并关浮层。

## 证据
- commits: `7c25059`(F2)、`57a396f`(F3)、`8a50fc2`(契约测试),基于 9b5f94a,共 5 文件 + 1 测试文件。
- 测试摘要:`tests 449 / pass 447 / fail 0 / skipped 2`(全绿)。
- 工作树干净,分支 `feat/category-prefs` 留原地,未 merge / 未 push。

门禁: PASSED
结论: OK
