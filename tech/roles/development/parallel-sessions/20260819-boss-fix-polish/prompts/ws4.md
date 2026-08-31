# ws4 — 功能完善:Profile 已投递/通知行可点击跳岗位(桌面+移动)

## 背景(boss + Explore 已定位现状)

用户点名:「profile 的已投递岗位需要可以点击」。现状:

- `server/src/components/account-panel.tsx:633-650`「我的投递」行是纯文本
  (`<li className={styles.appRow}>` + strong/small,无 button/link/onClick);
  收件箱通知行(:614-630)同构,同样不可点击。
- 数据结构:`ApplicationRecord`(server/src/lib/account.ts:132-141)
  `{ id, positionId, companyPoiId, title, companyName, applyUrl?, status, createdAt }`;
  `NotificationRecord`(:146-157)同样带 positionId/companyPoiId。
- 可复用链路:GET `/api/pois/[id]?mode=work` → `poi.positions` 按 positionId 匹配;
  桌面 map-shell `setDetailPoi(poi)` + `setOpenPositionId(id)`(:2227-2242);
  移动 `setMobileJd(position)`(:2382-2413)。参照 SavedPanel 行 button + onPick
  模式(saved-panel.tsx:115-126)。

## 任务

1. **已投递行可点击**:account-panel.tsx 行 → `<button>`(样式沿用现有 appRow + hover
   反馈,遵循设计 token 与现有卡片 hover 语义;视觉布局不变)。新增 `onOpenApplication(record)`
   回调 prop(Prop 接口 :23-39)。`companyPoiId`/`positionId` 缺失的行禁用(disabled 态)。
2. **通知行同类处理**:收件箱行同构(button + hover),走同一回调或 `onOpenNotification(record)`
   (看接口一致性,boss 倾向:通知行复用同一跳转回调,数据缺失禁用)。
3. **map-shell 接线**:新增打开函数:按 `companyPoiId` 拉
   `GET /api/pois/[id]?mode=work` → `positions` 匹配 `positionId` →
   桌面 `setDetailPoi(poi)` + `setOpenPositionId(positionId)`;移动视口
   `setMobileJd(position)`(参照现有 handlePickSaved / 详情打开逻辑)。
   加载失败/岗位已下线 → 不崩溃 + 轻量兜底(console.warn + 空态/原样保持)。
4. **测试**:组件契约/单测(行可点击、回调触发、禁用态、接线函数存在);typecheck。

## 布局说明(现有行视觉不变,无新布局,不需布局图)

「我的投递」行:左 title(strong)+ 下 companyName(small)不变;整行 button 化 +
hover 背景高亮(现有 hover token),键盘可达。通知行同构。

## 文件边界(绝对路径,worktree = /Users/acccan/dm-wt-ws4)

- 只动:`server/src/components/account-panel.tsx`、`server/src/components/map-shell.tsx`
  (仅 profile/投递接线段,勿动视口加载逻辑)、`server/src/lib/account.ts`(如需,尽量不动)、
  相关测试文件
- **不碰**:`server/src/lib/viewport-search.ts`、map-shell 视口加载段(noMore/空批次/缓存,ws1 区域)、
  `server/src/hooks/use-poi-map.ts`、`server/src/lib/map-markers.ts`(ws2)、
  `server/src/lib/recruitment-*.ts`、`server/src/lib/company-logo.ts`(ws3)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-ws4/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-ws4 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-fix-polish/reports/ws4.md`:
改动文件 + 接线实现简述 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。