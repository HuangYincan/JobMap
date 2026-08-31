# WS w1 续作(resume)—— 完成 POI 加载修复与「加载更多」

> 批次:20260819-auth-explore-poi | worktree: `/Users/acccan/dm-wt-w1`(同一 worktree/分支 `feat/poi-load-more`)

## 发生了什么

你(w1 前一个 worker 会话)在 **$3 预算耗尽时被中断**,没有提交任何 commit。worktree 里有**未提交的修改**(11 个文件,+382/-104,见 `git status` / `git diff`):map-shell.tsx、poi-list.tsx/.module.css、secondary-sidebar.tsx/.module.css、amap-api.ts、i18n.ts、poi-service.ts、viewport-search.ts、component-contracts.test.mjs、viewport-search.test.mjs。

## 续作步骤

1. **先盘点,不重做**:`git status` + `git diff` 审阅已有改动。改动的设计方向(poi-service 失败抛错「错误≠没有更多」、AMap 超时、noMore 用服务端 total、加载更多按钮)是**正确的**,不要回退重来。你可能正处于重构中间态(函数签名已改、调用方未全改齐)——**先跑 `cd server && npm run typecheck` 与 `cd server && npm test` 看破损面**,把不一致处补齐。
2. **对照原任务清单逐项确认完成度**(原 prompt:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-auth-explore-poi/prompts/w1.md`,务必读):
   - (1) Scale 控件生命周期:cleanup 接线、resize 监听移除、双 addControl 竞态 —— 逐项确认实现与否。
   - (2) 失败可重试不永久 noMore(poi-service 抛错路径 + map-shell noMore 计算 + viewport-search)。
   - (3) AMap searchPOI 超时(amap-api.ts ~343-368)。
   - (4) skipFetch 不吞视口刷新(map-shell ~748-752)。
   - (5) noMore 用服务端 total(domain-local 与 work)。
   - (6) 「加载更多」按钮(secondary-sidebar resultHeader + map-shell 接线 + i18n + CSS)。
   - (7) 测试:viewport-search.test.mjs 失败不置 noMore/重试、total 判 noMore;component-contracts 断言加载更多按钮;amap-api 超时。
   - 缺什么补什么。
3. **提交**(小而清晰,Conventional Commits,scope 如 `feat(poi-load-more)` / `fix(poi-load-more)` / `test(...)` / `docs(...)`),一个主题一个 commit;未提交的既有改动按主题归入合理 commit。
4. **门禁全绿**:
   ```bash
   cd /Users/acccan/dm-wt-w1/server && npm test && npm run typecheck
   cd /Users/acccan/dm-wt-w1 && make docs-check && git diff --check
   ```
   若既有改动让测试红,修复而不是绕过。
5. **文档**:`tech/16-bug-fixes.md` 记录(比例尺崩溃 / POI 停止加载 A-D / 加载更多按钮)若尚未记。
6. **写汇报** `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-auth-explore-poi/reports/w1.md`:每项完成度(对照清单)、改动 file:line、测试、遇到的问题。末两行精确 token:
   ```
   门禁: PASSED | FAILED
   结论: OK | BLOCKED: <一句话问题>
   ```

## 文件边界(同原 prompt)

只动 w1 拥有的区域(map-shell.tsx 的 Scale/load/handleNeedMore/POIList 接线区;secondary-sidebar resultHeader;poi-list footer;poi-service/viewport-search/amap-api 对应段;i18n 新增键);不碰 openMobileAccount、搜索框 JSX、handlePickRecent、drawer 结构(其他 WS 拥有)。

不要 merge / push / 建分支;不碰主工作树。
