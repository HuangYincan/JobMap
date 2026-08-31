# w1 续作附录(boss 裁决,2026-08-19)

**前情**:上一轮 w1 会话在 `Exceeded USD budget (3)` 中断,worktree `fix/mobile-drawer-chrome`
内有**未提交但已基本完成的实现**。boss 已审阅 diff,判定实现方向正确、任务 1/2/3 均已落到代码,
缺的是收尾:验证、补齐、跑门禁、提交、写汇报。**不要丢弃重做。**

## 开工前对账(必做)

```bash
git -C /Users/acccan/dm-wt-w1 status --short
git -C /Users/acccan/dm-wt-w1 diff --stat
```

现状(应一致,若有出入按实际为准):
- `server/src/components/map-shell.tsx`:已加 `readSafeAreaTop`/`compassCenterY`/`drawerFullHeight`、
  `scaleControlRef`、`drawerFullishRef`、scale 显隐 effect、拖拽阈值用 `fullH/halfH`、
  topTools 条件类 + 定位按钮 JSX。
- `server/src/components/map-shell.module.css`:`.topToolsHidden`、定位按钮桌面隐藏、
  `.mobileDrawer max-height` 与 `.drawerFull` 改为 `calc(100svh - max(12px, env(safe-area-inset-top)) - 20px)`。
- `CHANGELOG.md`、`tech/07-frontend-design-system.md`、`tech/16-bug-fixes.md`:已写(内容请复核)。

## 收尾任务(按序)

1. **复核完成度**:对照 `prompts/w1.md` 三任务逐项核对是否都实现到位;补缺/修正明显错误。
   - 特别注意:`map-constants.ts` 的 `DRAWER_FULL_RATIO`(0.86)已不再被 map-shell 使用——
     检查是否还有引用;无引用则删除(或保留注释说明),避免死常量。
   - 复核 `readSafeAreaTop` 探测元素逻辑、`scaleControlRef` 初始同步、`drawerFullish` 在
     half/mini 恢复显示。
2. **跑门禁**:
   ```bash
   cd /Users/acccan/dm-wt-w1/server && npm test && npm run typecheck
   cd /Users/acccan/dm-wt-w1 && make docs-check && git diff --check
   ```
   任一失败 → 修复后重跑,直到全绿。
3. **提交**:单条 Conventional Commit(如 `fix(mobile): 抽屉全开到指南针中心 + 隐藏指南针/比例尺 + 移动端定位按钮`)。
   **不要 merge/push**;worktree/分支留原地。
4. **写汇报** `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-mobile-ux/reports/w1.md`:
   实现概要(高度公式/scale 显隐/locate/topTools 隐藏)、门禁结果、遇到的问题、commit hash。
   末两行 token:
   ```
   门禁: PASSED | FAILED
   结论: OK | BLOCKED: <一句话问题>
   ```
