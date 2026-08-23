# WS-1: 筛选「莫名勾选独角兽」修复

## 背景
用户报告筛选面板莫名勾选上「独角兽」(work 模式 scale=unicorn)。Explore 已定位两处根因(见 README.md):
① 缓存残留:load 写缓存用闭包 filters 快照,取消勾选不重载 → F5 后缓存还原复活;② 切模式后点历史条目,openExploreSearch 闭包 stale filters 把旧模式筛选 merge 进新模式。

## 任务
在 **/Users/acccan/dm-wt-filter-unicorn** 内完成(worktree 已预建,分支 `fix/filter-unicorn`,基于 dev)。
**不要 merge / 不要 push**,boss 统一合并。纯逻辑修复,无 UI 改动。

## 修复方向(boss 裁决,实现由你定,需自证正确)
1. **主因(必修)**:写模式缓存时不要用 load 时刻的闭包 filters 快照,改用**写缓存时刻的最新 filters**——
   与 `use-work-viewport.ts:206` 同款(viewStateRef 模式):load 内写缓存处用 `viewStateRef.current.filters`(或等价 ref 最新值)替代闭包 filters;
   或等价方案(非 category 筛选变更时同步重写缓存)。目标行为:**取消勾选独角兽 → F5/重开 → 不复活**。
2. **次因(必修)**:`openExploreSearch`(map-shell.tsx:1936-1951)闭包依赖修正——modeChanged 时 merge 用**切换后模式**的 filters(用 ref 或正确依赖),避免旧模式筛选(如 work 的 scale:['unicorn'])带进新模式。
3. **语义保持**:点历史 `#独角兽` 条目 → 应用独角兽筛选(现有 applyTagSuggestion 语义)保持,不做 strip;「莫名」场景=①F5 复活 ②切模式闭包污染,修复这两个即可。
4. 契约/文档:`tech/16-bug-fixes.md` 追加 2026-08-22「筛选莫名勾选独角兽」节(症状/根因/方案/验证);若 mode-cache 或 viewStateRef 相关契约注释需同步,一并修正。

## 文件边界(优先只碰这些;改其他文件需在汇报列理由)
- `server/src/components/map-shell.tsx`(load 写缓存处 / openExploreSearch / handlePickRecent 链路)
- `server/src/hooks/use-work-viewport.ts`(如统一 ref 模式)
- `server/src/lib/mode-cache.ts`(如需要,最小)
- 对应单测(新增回归)+ `tech/16-bug-fixes.md`

## 不做
- 不 merge / 不 push;不改 UI 设计;不跑 Env-only 步骤;不 npm install

## 门禁(全部通过才写 OK)
1. `cd /Users/acccan/dm-wt-filter-unicorn/server && npm run typecheck`
2. `cd /Users/acccan/dm-wt-filter-unicorn/server && npm test`(全绿;测试数以实际运行结果为准)
3. `cd /Users/acccan/dm-wt-filter-unicorn && make docs-check`(应为全绿)
4. `git diff --check`
5. **新增回归测试**(jsdom 可测层):
   - 取消勾选筛选后缓存不再残留(filters 变更后写缓存取最新值;模拟「load 后 setFilters 取消 → 断言缓存/还原不含 unicorn」)
   - modeChanged 后点历史条目,merge 用切换后 filters(旧模式 scale 不进新模式)

## 提交
小步 Conventional Commits(`fix: ...` / `test: ...` / `docs: ...`);提交前 git status 干净。

## 回报
写 **/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-filter-unicorn/reports/ws-1.md**:
- 改动摘要(每文件 1-2 行)
- 主因/次因修复方式(为何根治)
- 遇到的问题
- 门禁实际输出摘要(测试总数 pass/skip)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
