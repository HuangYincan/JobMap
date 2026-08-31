# ws-ui-job-filters 汇报(2026-08-19)

## 实现摘要

在公司详情(RecruitmentDetail)岗位列表上方新增**岗位级筛选条**——纯新增功能,公司头部 /
列表行样式 / 现有设计语义零改动。岗位筛选是纯本地视图过滤(组件内 `useState`),不碰
全局 FilterState / sessionStorage / 地图 marker,切换公司 / 关闭详情即重置。

### 筛选语义

- **职能 chips**(技术/产品/运营/设计):取自 `ROLE_OPTIONS`(job-taxonomy.ts),点击 toggle
  多选,`positionMatchesRole` 做岗位级匹配(标题/部门/技能关键词分桶)。
- **类型 chips**(实习/校招/社招):标签取自 `JOB_FAMILY_PLUGIN.filter.options` 顶层(单一来源),
  匹配 `pos.taxonomy?.family ?? pos.type`(旧数据无 taxonomy 回退 type)。
- **关键词搜索框**:对 `pos.title + pos.department` 大小写不敏感 substring;空输入不过滤。
- **组合**:组内 OR(多选),组间 AND(职能 ∩ 类型 ∩ 关键词);全空 = 显示全部在招岗位。
- **计数**:筛选生效时标题显示「在招岗位 X / N」(X=筛选后,N=全部在招),否则保持原
  「在招岗位 (N)」。
- **空态**:筛选后 0 条显示「没有匹配的岗位」,列表不渲染。
- **清除**按钮仅在筛选生效时出现,一键重置全部三项。

### 视觉

- 筛选条 `position: sticky; top: 8px` + `--soft-strong` 玻璃底 + `backdrop-filter: blur(22px)`,
  与现有 job 卡片 glass 一致;chips 12px 文字 `--blue-ink`(#0062CC),选中态 `--accent`
  (#007AFF)底白字;搜索框复用现有 glass 圆角输入视觉(带放大镜 svg 图标);
  暗色模式补了 chips/搜索框/空态背景覆盖。移动端 drawer 复用同一 POIDetailView,自动生效。

## 实际改动

- `server/src/lib/position-filters.ts`(新)→ 纯函数筛选逻辑:`PositionFilters` 类型、
  `filterPositions`(AND 组合)、`positionFamily`(taxonomy 回退)、`positionMatchesQuery`、
  `hasActivePositionFilters`。可单测、可复用。
- `server/tests/position-filters.test.mjs`(新)→ 8 个单测,含 **669 岗位大列表压力场景**
  (得物式:10 种标题 × 3 类岗位类型交错),验证 268 技术 / 每类型 223 / AND 组合 89 与 22 /
  空结果 0。
- `server/src/components/poi-detail.tsx` → RecruitmentDetail 新增 `filters` state、
  `visible` memo;筛选条 JSX(搜索框 + 职能 chips + 类型 chips + 清除 + 空态);
  标题计数条件渲染;`FAMILY_OPTIONS`/`toggleValue` 模块级辅助。
- `server/src/components/poi-detail.module.css` → `.jobFilter*` 全套样式(sticky glass 条、
  搜索框、chips 选中态、清除按钮、空态)+ 暗色模式覆盖。
- `server/src/lib/i18n.ts` → 新增 5 组 key:searchPositions / positionRole / positionType /
  clearFilters / noMatchingPositions(zh + en)。

## 门禁结果

- npm test: 368 总 / **366 通过 / 0 失败**(2 skipped,与基线一致;新增 8 个全过)
- typecheck: 通过(修了 2 个 TS 错误:FilterConfig.options 可选、toggleValue 泛型化)
- make docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- 无 BLOCKED 级问题。
- TS 细节:JOB_FAMILY_PLUGIN.filter.options 类型上可选,加了 `?? []` 守卫;
  `toggleValue` 需泛型才能同时服务 `string[]`(职能)与 `JobFamily[]`(类型)。
- 未做浏览器自验(Playwright 不可用);以 669 岗位单测覆盖筛选逻辑(见上)。

## 证据

- 669 场景断言:空筛选 669 原样返回 / tech=268 / social=223 / tech∩social=89 /
  tech∩social+「算法」=22 / design∩intern+「后端」=0(空态)。
- 提交:1d1db95(lib+tests)、02d4405(组件+css+i18n)。

门禁: PASSED
结论: OK
