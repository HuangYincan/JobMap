# ws-qa6 — #6 map-shell 巨型组件拆分(视口加载/搜索状态/缓存还原抽 hooks)

## 背景

质量扫描(quality-scans/20260819-all/scan-report.md #6,Medium):`server/src/components/map-shell.tsx` 2822 行、30+ state、20+ ref、12+ effect。单一组件承载地图初始化、视口加载器、搜索/建议、抽屉手势、账户/收藏/投递/收件箱、模式缓存、移动端 sheet 等全部逻辑。跨 ref 状态一致性是历史 Bug 7(列表冻结)/poi-mixing(跨模式污染)的温床。

## 修复方向(boss 拍板:行为保持重构,零 UI 变化)

**只做结构性拆分,不改任何行为/视觉/交互语义。** 建议(worker 按实际情况取舍,可只抽 2-3 个最大块):
1. **视口加载 hook**:`loadWorkViewport`/`fetchWorkViewportPage`/viewport 状态/调度对齐逻辑抽成 `useWorkViewport(map, deps)`(放 `server/src/hooks/use-work-viewport.ts`)。
2. **搜索/建议 hook**:搜索状态(q/suggest/filters/sort/loading)与提交/清理逻辑抽 `useSearchState`(放 `server/src/hooks/use-search-state.ts`)。
3. **模式缓存还原 hook**:session cache restore(map-shell.tsx:481-497 区域)抽 `useModeCacheRestore`(放 `server/src/hooks/use-mode-cache-restore.ts`)。
4. **重要**:Bug3 的 `hasInteractedRef` + 挂载 geolocation 门控语义(**map-shell.tsx:233/548-576/728-734/1621**)**必须原样保留**——可留在 map-shell 或随对应 hook 迁移,但契约测试(component-contracts.test.mjs 的 Bug3 用例)必须继续通过,不许改判定逻辑。
5. 拆完后 map-shell 只做编排(调 hooks),行数应明显下降。

**硬约束**:
- 零行为变化:UI 渲染、事件流、fetch 时机、缓存 key 全不变;不得顺手「优化」任何逻辑。
- `server/tests/component-contracts.test.mjs` 现有全部契约(含 ws-a/ws-b/ws-c 批次加的 Bug1/Bug3 相关)必须继续通过;契约测试正则若因代码移动需更新,只更新**位置匹配**(移到 hook 文件的断言同步移动),不弱化断言。
- 若某个抽取风险过高(如抽屉手势),可跳过并在汇报说明。

## 测试(必做)

- `npm test` 全绿(component-contracts 是主门禁);typecheck 全绿。
- 新增 hook 契约测试(如 `server/tests/hooks-contracts.test.mjs`):断言 hook 文件存在、导出签名、关键逻辑(viewport 调度条件/搜索清理/缓存 restore 分支)在 hook 内而非 map-shell 内。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-qa6)

- 只动:`server/src/components/map-shell.tsx`(拆减)、`server/src/hooks/*`(新 hook)、`server/tests/*`(契约)
- **不碰**:`server/src/lib/*`(qa 批次已绿,不回归)、`server/src/app/api/*`、`server/src/components/map-markers.tsx`(若需要 marker 相关逻辑,只搬不删不改)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-qa6/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-qa6 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-qa-fixes/reports/qa6.md`:
改动文件 + 抽取结构(hook 清单/职责/行数变化)+ 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。预算纪律:每抽完一个 hook 即 commit,commit 先于验证。

## 续作附录(boss 2026-08-19,预算超限中断后续作)

已 commit:`89fd600`(useModeCacheRestore 抽取)、`d513741`(useSearchState 抽取,suggest fetch 一并迁移)。未提交:worktree 内 `server/src/hooks/use-work-viewport.ts`(324 行,新文件)已写好,`map-shell.tsx` 有 28+/242- 的接线 diff。开工先 `git status` + `git diff --stat` 对账,不重做。剩余:
1. **先 commit 当前 viewport 抽取**:确认 use-work-viewport.ts + map-shell.tsx 接线完整、import/调用一致、类型通过 → `git add server/src/components/map-shell.tsx server/src/hooks/use-work-viewport.ts && git commit -m "refactor(map-shell): extract work viewport loading into useWorkViewport"`。若发现接线不完整(编译/类型报错)先补完再提交。
2. **测试**(必做):`server/tests/hooks-contracts.test.mjs`(或同名文件)补 useWorkViewport 契约(存在、导出签名、关键逻辑在 hook 内);`component-contracts.test.mjs` 全量仍绿(Bug3 hasInteractedRef 用例不许弱化)。
3. 门禁全绿 + 写汇报(改动文件 + hook 职责/行数变化 + 测试 + 遇到的问题)。
4. 预算纪律:先 commit 再验证。
