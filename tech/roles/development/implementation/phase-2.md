# Phase 2 实施记录

**创建日期:** 2026-08-15  
**分支:** `feature/phase-2-multi-mode`(2026-08-17 已并入 `dev`)  
**状态:** complete(并入 `dev` 后视为历史记录)  
**目标:** 多模式系统 + POI 展示 + 搜索筛选（tech/08、09、10、11）

---

## 设计批准记录

### 前端布局门禁

依据 `agent.md` 的前端布局门禁（ASCII/text 布局图需用户审查），Phase 2 前端布局已在
设计文档阶段完成并由用户确认：

- **布局来源:** `tech/09-secondary-sidebar.md`（二级侧控栏 + 卡片 + 详情视图 ASCII 布局）
- **布局来源:** `tech/10-search-filter.md`（搜索框 + 筛选器 + 排序 ASCII 布局）
- **布局来源:** `tech/08-multi-mode-system.md`（模式切换机制 ASCII 布局）
- **审阅方式:** 用户明确要求"维护好计划与各种文档"并在文档中审阅布局；用户本轮指示
  "详细阅读文档、维护文档后开始构建"，即批准基于这些文档实施前端。
- **记录时间:** 2026-08-15（本轮）

### 构建策略（并行）

| 模块 | 实现方式 | 状态 |
|---|---|---|
| 地基 lib（types/modes/search/seed/amap-api/api/poi-service） | 主模型 | ✅ 完成 + 测试 |
| API 路由（/api/modes /api/pois /api/pois/[id] /api/search /api/suggest /api/filter-options） | 主模型 | ✅ 完成 |
| ModeSwitcher 组件 | 并行 subagent | in-progress |
| FilterPanel + SortSelector | 并行 subagent | in-progress |
| POICard + POIList | 并行 subagent | in-progress |
| map-markers + use-poi-map（地图联动） | 并行 subagent | in-progress |
| SecondarySidebar 集成 + map-shell 接线 | 主模型（集成） | pending |

---

## 架构决策

1. **数据契约**：POI 判别联合（DomainPOI / RecruitmentPOI），`kind` 字段判别。
   遵循 tech/08 数据模型，DB 就绪后映射到 `entities` + `items` 表。
2. **模式配置单一事实来源**：`lib/modes.ts` 的 `MODES` 注册表，前后端共用
   （API 路由也引用它）。符合"一切皆插件"精神。
3. **数据源回退**：实习模式服务端走 seed；Domain 模式浏览器端直连 AMap JS API。
   DB 就绪后无缝切换到 PostGIS。
4. **搜索管线纯函数**：`runPOIPipeline`（搜索→筛选→距离→排序）无副作用，
   便于单测，前后端复用。
5. **AMap 标记控制器**：与 React 解耦的纯 TS 类，便于测试，hook 层做绑定。

---

## 验证记录

- `npx tsc --noEmit` — 通过（地基 + API 路由 + 全部组件）
- `npm test` — 13/13 通过（smoke + seed 形状 + search 逻辑 11 例）
- 浏览器验证（Playwright）：**通过**，2026-08-15
  - Domain 模式：20 个真实高德 POI（PlaceSearch + 周边搜索"美食"）
  - 实习模式：15 家公司 seed 数据，卡片完整渲染
  - 搜索：实习模式输入"算法" → 6 个匹配公司（阿里巴巴/字节/华为等）
  - 筛选：Filter 面板展开，7 个筛选器 + Reset 正常
  - 排序：SortSelector 下拉正常
  - 模式切换：Domain ↔ 实习，POI 数据 + markers 联动刷新
  - 地图联动：卡片点击 → aria-selected=true + 16 markers 渲染（15 公司 + 用户定位）
  - 截图：`/Users/acccan/phase2-domain-mode.png`、`/Users/acccan/phase2-final.png`

### AMap 集成修复记录（重要）

在浏览器验证中发现并修复了 4 个 AMap v2.0 集成问题：

1. **双脚本注入冲突**：map-shell 直接注入 AMap script + `loadAMap()` 各注入一次，
   导致插件系统被覆盖。修复：map-shell 改为复用 `loadAMap()` 单一入口。
2. **插件名缺少 `AMap.` 前缀**：`AMap.plugin(['PlaceSearch'])` 应传 `['AMap.PlaceSearch']`，
   否则插件请求被静默忽略。修复：`waitForPlugin` 内补全前缀。
3. **插件挂载属性无前缀**：`AMap.plugin` 参数要前缀，但插件挂载在
   `AMap.PlaceSearch`（无前缀）。`waitForPlugin` 曾错误地检查 `AMap['AMap.PlaceSearch']`。
4. **高德 v2.0 坐标格式变化**：POI 的 `location` 是 `AMap.LngLat` 对象（非字符串），
   且无 `lnglat` 字段。`normalizeAMapPOI` 曾只解析字符串，导致全部记录被过滤。
   另 `photos` 字段可能非数组。修复：`parseAMapCoords` 支持 3 种格式 + photos 类型守卫。

---

## 下一步

- [x] 集成 SecondarySidebar 到 map-shell
- [x] 模式切换 → POI 数据联动
- [x] 卡片/地图双向联动
- [x] 浏览器截图验证（Playwright）
- [x] 视觉 QA（sonnet 子代理）
- [ ] 文档同步（README / milestones / 实施记录）
- [ ] 移动端适配（Sprint 5 范围）
- [ ] 详情页视图（Sprint 4 范围）

