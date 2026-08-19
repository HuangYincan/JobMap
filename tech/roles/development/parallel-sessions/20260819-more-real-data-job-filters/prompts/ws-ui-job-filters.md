# WS: ws-ui-job-filters — 岗位级职能分类/筛选 UI(新功能)

> 你是 boss 派发的 headless 开发 worker。在预建 worktree **`/Users/acccan/dm-wt-ws-ui-job-filters`**
> 内完成本 workstream,**不要 merge/push**,完成后写汇报到
> `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-more-real-data-job-filters/reports/ws-ui-job-filters.md`。

## 背景

公司级筛选已完备(FilterPanel:roleFamily/jobTaxonomy/scale/education/salary/onlyOpen 等),
但**岗位级筛选完全缺失**:`server/src/components/poi-detail.tsx` `RecruitmentDetail`
(:141-249)把公司内所有在招岗位全量平铺渲染(:208-246)。得物一家 669 个在招岗位
直接全渲,用户看不过来。本 WS:在公司详情岗位列表上**新增**职能分类 + 岗位筛选条
(**新增功能,不改任何现有设计语义/布局**)。

## 现状(不改的部分)

- `poi-detail.tsx` RecruitmentDetail 结构:open 过滤(:155 `isAlivePosition`)、岗位
  `<ul>` 全量渲染(:208-246)、标题行「在招岗位 (N)」(:185/:211)。
- 职能分桶逻辑已有:`server/src/lib/job-taxonomy.ts` `positionMatchesRole(pos, family)`(:88-99,
  技术/产品/运营/设计,标题/部门/技能关键词分桶)、`ROLE_FAMILY_PLUGIN`(:69-78,
  roleFamily key,multi-select)。
- 岗位 family(实习/校招/社招)在 `pos.taxonomy.family` 或 `pos.family`。
- 样式 tokens:`globals.css`(--soft-strong frost、#007AFF 蓝、--blue-ink #0062CC 12px、
  chips 样式可参考 filter-panel.module.css 与 activeFilterChips)。

## 目标布局(新 UI,liquid glass)

```
现状:                                       目标:
┌─ POI Detail ────────────────┐             ┌─ POI Detail ──────────────────────┐
│ 公司名/徽标/距离            │             │ 公司名/徽标/距离                  │
│ 行业 chips / 规模           │             │ 行业 chips / 规模                 │
│ 在招岗位 (669)              │             │ 在招岗位 42 / 669                 │
│ ─────────────────────────  │             │ ┌─ 岗位筛选(glass,sticky) ───────┐ │
│ 岗位1 ...                   │             │ │ [🔍 搜索岗位/部门]             │ │
│ 岗位2 ...                   │             │ │ 职能:(技术)(产品)(运营)(设计)  │ │
│ 岗位3 ...                   │             │ │ 类型:(实习)(校招)(社招) [清除] │ │
│ ... 669 行全量平铺          │             │ └───────────────────────────────┘ │
└─────────────────────────────┘             │ 岗位1 ...(筛选后子集)             │
                                            │ 岗位2 ...                         │
                                            │ 空结果 → 「无匹配岗位」空态        │
                                            └───────────────────────────────────┘
```

## 任务

在 `RecruitmentDetail` 的岗位列表上方加筛选条(仅新增,不动公司头部/列表行样式):

1. **筛选状态**:组件内 `useState`(职能多选 `string[]` / 类型多选 `string[]` / 关键词
   `string`)。**绝不写全局 FilterState / sessionStorage / 地图 marker 联动**——岗位筛选
   是纯本地视图过滤,切换公司/关闭详情即重置。
2. **职能 chips**(roleFamily 四类 技术/产品/运营/设计,取自 `ROLE_FAMILY_PLUGIN.options`
   或 `job-taxonomy.ts` 常量):点击 toggle 多选;`positionMatchesRole` 做岗位级匹配。
3. **类型 chips**(实习/校招/社招):按 `pos.taxonomy.family ?? pos.family` 岗位级匹配。
4. **关键词搜索框**:对 `pos.title + pos.department` 做大小写不敏感 substring 匹配;
   空输入不过滤。
5. **组合语义**:多条件 AND(职能∩类型∩关键词);全空 = 显示全部在招岗位。
6. **计数**:标题行在筛选生效时显示「在招岗位 X / N」(X=筛选后,N=全部在招),
   否则保持原「在招岗位 N」。
7. **空态**:筛选后 0 条显示空态文案(如「没有匹配的岗位」),列表不渲染。
8. **视觉**:筛选条玻璃拟态(`--soft-strong` frost 或透明白 + backdrop blur,与现有
   chips 一致);chips 12px 文字 `--blue-ink`,选中 `#007AFF` 底白字(或与
   filter-panel 选中态一致);搜索框复用现有搜索框视觉(圆角/glass);清除按钮
   「清除」重置全部筛选。移动端(drawer 内 POIDetailView 复用同一组件)自动生效,
   **不需要额外移动端代码**。
9. **组件边界**:只改 `poi-detail.tsx`(+ `poi-detail.module.css`),如需要可新建小组件
   文件,但不得改 `map-shell.tsx`/`jd-panel.tsx`/`filter-panel.tsx` 的现有行为。
   若发现必须传参才能实现,记录在汇报里并保持最小侵入。

## 门禁

1. `cd /Users/acccan/dm-wt-ws-ui-job-filters/server && npm test` 全绿(现有 358+ 测试)。
2. `npm run typecheck` 干净。
3. `make docs-check` 通过。
4. 自验(Playwright 不可用或可用都行):至少在代码层验证 600+ 岗位渲染场景的筛选
   逻辑(单测/逻辑抽验均可);若你跑前端,截图只存 `.playwright-mcp/`。

## 提交

Conventional Commits,小步提交(如 `feat(ui): position-level roleFamily/family filter
chips in POI detail`、`feat(ui): position keyword search + empty state`)。**不要 merge/push**。

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-more-real-data-job-filters/reports/ws-ui-job-filters.md`:
- 实现摘要(改了哪些文件、筛选语义、chips 数据来源)
- 门禁结果
- 遇到的问题(如有)
末两行必须精确:
```
门禁: PASSED
结论: OK
```
