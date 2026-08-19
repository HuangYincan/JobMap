# WS: ws-frontend — map-shell 继续抽 hooks 降复杂度(scan #6)

## 背景
2026-08-20 全库扫描(上轮 all 扫描 #6 复发):`server/src/components/map-shell.tsx` 2769 行,仓库最大组件。2026-08-20 已把视口加载器抽到 `useWorkViewport`(净删 566 行),但仍承载搜索/建议/抽屉手势/账户/收藏/缓存还原/收藏图层等全部编排。30+ state 与 20+ ref 的跨引用一致性是历史 Bug 7/poi-mixing 温床。

已有 hooks(勿重复造):`server/src/hooks/use-work-viewport.ts`、`use-search-state.ts`、`use-mode-cache-restore.ts`、`use-poi-map.ts`。

## 任务(绝对路径,worktree: /Users/acccan/dm-wt-frontend)

1. **评估 map-shell 剩余职责**,选 1–2 个**最有价值且低风险**的抽为 hook:
   - 候选:收藏图层开关逻辑(useSavedLayer:overlayPois/overlayBounds/toggle+suppress)、抽屉/详情状态(useDetailDrawer:detailPoi/drawerScroll/handleSelect/onOpenDetail)、搜索交互(注意 useSearchState 已存在,勿重复)
   - 推荐收藏图层(逻辑自洽、与加载无关,最易安全抽离)
2. **保持行为完全不变**——纯重构:
   - 不改任何 UI 设计/交互流程/视觉(改现有 UI 设计 → 停手,记入报告 BLOCKED 说明)
   - 修复 bug 允许,但不得为重构顺手改行为
3. **用契约测试兜底**:server/tests/component-contracts.test.mjs 加对应断言(新 hook 的接线:map-shell 调用处 + hook 内部关键逻辑正则),保证后续演进不回归。现有 486 测试不许 fail。
4. **范围克制**:单批次只抽 1–2 个 hook;抽完若发现 map-shell 仍有大块可抽,在报告中列出建议,不要无限扩展。**这是 5 个批次里风险最高的,质量优先于数量。**

## 文件边界
server/src/components/map-shell.tsx + 新增 hooks 文件 + component-contracts.test.mjs(及必要测试)。
**不碰**:use-work-viewport/use-mode-cache-restore(上批刚重构)、路由/API、文档。

## 门禁(必须全绿)
```bash
cd /Users/acccan/dm-wt-frontend && make docs-check
cd /Users/acccan/dm-wt-frontend/server && npm test
cd /Users/acccan/dm-wt-frontend/server && npm run typecheck
cd /Users/acccan/dm-wt-frontend && git diff --check
```

## 提交
小步 Conventional Commits:`refactor(map-shell): 收藏图层抽 useSavedLayer hook` 等,每步可回退。

## 回报
写 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-scan-optimize/reports/frontend.md:
- 抽了哪些 hook(文件 + 行数前后对比)
- map-shell 剩余行数
- 契约测试新增断言
- 遇到的问题(如有)
末两行必须精确:
```
门禁: PASSED
结论: OK
```
