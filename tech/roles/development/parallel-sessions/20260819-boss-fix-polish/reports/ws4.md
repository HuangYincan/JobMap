# ws4 汇报(2026-08-19)

功能:Profile「我的投递」/「收件箱」行可点击跳岗位(桌面 + 移动)。

## 实际改动

- `server/src/components/account-panel.tsx`
  - `ProfilePanelProps` 新增 `onOpenApplication?: (record: { positionId: string; companyPoiId: string }) => void`(轻量载荷,已投递/通知两行共用同一回调——按 boss 倾向)。
  - 「我的投递」行 `li.appRow` → `li > button.appRow`,onClick 触发 `onOpenApplication`(ApplicationRecord 两字段必填,无禁用)。
  - 「收件箱」行同构 button 化;`positionId`/`companyPoiId` 任一缺失 → `disabled`(且 onClick 内守卫,TS 收窄 + 防御)。
  - 视觉布局不变(title strong + companyName small),仅整行 button 化。
- `server/src/components/account-panel.module.css`
  - `.appRow` 增加 button reset(transparent bg / border 0 / font: inherit / text-align left)+ `width: 100%` + `cursor: pointer`,hover/active 高亮沿用 `.rowBtn` 语义(`rgba(0,0,0,.045)/.08`);`:disabled` → `cursor: default` + `opacity: .55`。
  - dark 主题 media 块内补 `.appRow` hover/active 白色系覆盖(与 `.rowBtn` 对齐)。
  - `.appRow + .appRow::after` 分隔线选择器对 button 行依然生效,未改。
- `server/src/components/map-shell.tsx`
  - 新增 `handleOpenApplication(ref)`(handlePickSaved 之后):本地 `catalog/pois/INTERNSHIP_SEED` 命中 → 直接开;否则 `fetchPOIDetail(ref.companyPoiId, "work")` 拉 work 详情 → `positions.find(positionId)` → 桌面 `setDetailPoi` + `setOpenPositionId(positionId)`;移动 `setMobileJd(pos ?? null)`;另 `setSelectedId` / `setRailPanel("explore")` / `setMobileSheet("explore")` / `setDrawer("full")` / 飞行定位 / `drawerScrollRef` 清零(参照 handlePickSaved + 建议打开的 openCompany 语义)。
  - 岗位已下线 / 拉取失败 → `console.warn` + 保持面板原样,不崩溃。
  - 桌面(:2290)与移动 embedded(:2572)两处 ProfilePanel 均接 `onOpenApplication={handleOpenApplication}`。
- `server/tests/component-contracts.test.mjs`
  - 新增契约测试「profile applied/notification rows are clickable buttons wired to the job jump」:两处行 button 化、回调 prop + onClick 载荷、通知行 disabled + 守卫、CSS pointer/hover/disabled、map-shell 接线函数(`fetchPOIDetail(..., "work")`、`setOpenPositionId`、`setMobileJd`、失败兜底 warn、两处接线)。

## 门禁结果

- npm test: 369 通过(367 pass / 0 fail,2 skipped 既有)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- 无阻塞。两点说明:
  1. 通知行与已投递行共用 `onOpenApplication` 单回调(载荷为 `{ positionId, companyPoiId }` 交集,不传整个 record)——NotificationRecord 字段可选而 ApplicationRecord 必填,交集载荷保证接口一致、禁用态可判定。
  2. 打开岗位不切换当前 mode,按任务要求固定 `?mode=work` 拉取;POIDetailView 按 `isRecruitmentPOI(poi)`(kind)渲染而非 mode,domain 模式下打开 work 公司详情不会走错分支(已验证 poi-detail.tsx:107)。
  3. `make docs-check` / `git` 相关命令需在 worktree 根运行;`npm test` 需在 `server/` 运行(脚本未内置 cd)。

## 证据

- `npm test`: `ℹ tests 369 / ℹ pass 367 / ℹ fail 0`(含新契约测试 1 条)
- `npm run typecheck`: `tsc --noEmit` 无错误
- `make docs-check`: `Documentation policy check passed.`
- 提交(worktree `/Users/acccan/dm-wt-ws4`,分支 `feat/profile-applications-open`):
  - `c50462d` feat(account-panel): 已投递/通知行整行 button 化可点击(禁用态+hover 沿用 rowBtn 语义)
  - `d3061ab` feat(map-shell): profile 投递/通知行点击接线 handleOpenApplication(work 详情拉取→岗位匹配→桌面/移动打开)
  - `63b0aa5` test(contracts): profile 投递/通知行可点击、禁用态、接线函数契约
- 未 merge / 未 push;worktree 留原地。

门禁: PASSED
结论: OK
