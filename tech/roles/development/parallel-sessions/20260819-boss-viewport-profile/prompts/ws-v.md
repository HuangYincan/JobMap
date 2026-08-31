# ws-v — F1 工作 poi 视角全量增量加载(去上限 + 列表/地图池分离)

## 背景

用户「工作 poi 随视角全量持续增量加载,不设结果数上限,展示视角内所有工作 poi;zoom 变小又变大时已加载 poi 不要删,只换侧控栏二级卡片展示,地图 poi 保持全量」。

Explore 已确认现状(dev 9b5f94a):
- **work 视口加载是替换式**(use-work-viewport.ts:181 `existing:[]` + :197-198 整体 `setCatalog(batch)`,onBatch 替换)→ zoom 变化即丢已加载 poi;每轮只取 page 1(use-work-viewport.ts:180,`WORK_VIEWPORT_PAGE_SIZE=50`),`maxPages` 默认 1 → 每轮最多 50 条。
- 主加载(map-shell.tsx:832-843)`WORK_INITIAL_MAX_PAGES=4`(≤200)+ `mergePoisById` 增量;滚动每页 +50。
- 硬顶:`POI_HARD_CAP=3000`(viewport-search.ts:56,575-589 mergePoisById cap)、`POI_SOFT_CAP=300`。
- **catalog(marker 源)与 pois(列表源)已分离**(map-shell.tsx:1138 vs 1113)但都派生自**同一个 `catalog`** → 「只换列表」需再加一个 list 池。

## 目标行为

1. **视口加载增量合并、不删已加载**:zoom 变化只把新视口 poi 并进现有池,不整体替换清空。
2. **视野内取尽**:视口加载循环 page 直到 noMore(服务端无上限,public-search 分页钳制 50 只是切片;瓶颈在客户端页循环)。
3. **去 3000 硬顶**:mergePoisById 的 cap 对 work 放开(传大值/Infinity)。
4. **列表 vs 地图池分离**:`catalog`(marker 源)只增不减保持全量;新增/复用 `listCatalog`(列表源)按视口换——侧栏二级卡片随视角变,地图 poi 全量保留。`pois = runPOIPipeline(listCatalog ?? catalog, ...)`(map-shell.tsx:1113)。

## 实现要点(worker 定细节,保持契约)

- use-work-viewport.ts:176-209 的 work 视口分支从「替换式」改「增量合并」:调用 `loadWorkViewport` 时 `existing: catalogRef.current`(或 list 池),onBatch `mergePoisById` 合并;删除/调整 setPageOffset(0)/skipFetch/epoch 作废逻辑(增量语义下主加载批次不再需要作废,视口 epoch 仅作列表状态即可)。
- 空批次清空分支(use-work-viewport.ts:190-196):增量语义下**不再整池清空**(catalog 保留),只影响列表/空态。
- 视口加载循环取尽(而非 page:1)。注意 `viewport-search.ts` 的 loadWorkViewport 已有短页 break 语义(495-505),worker 复用。
- **缓存语义**(关键,mode-cache.ts:44-57 存整池 catalog):若 marker 池与列表池分离,缓存应写全量池 catalog(供 marker 与下次还原),还原后挂载对齐逻辑决定列表;或写列表池+保留全量池。worker 选一实现并说明,确保**不引回归**(缓存还原后 marker 不应少于还原前)。
- **maxTier / alive 语义保持**:tier≤zoom、status=open 不因去上限而变(recruitment-store.ts:134-151)。
- `handleRefreshHere`(map-shell.tsx:1205-1220)显式清空仍保留(用户主动刷新,非视口变化)。
- 更新 `viewport-search.ts:258-266` 模块头注释(仍写「增量合并」但 use-work-viewport 是替换式,矛盾)与 use-work-viewport.ts 内替换式注释,统一为增量语义。

## 测试(必做)

- `server/tests/*` 现有全绿(viewport-search / mode-cache / component-contracts)。
- 新增/更新契约:use-work-viewport 增量合并(不整池替换)、去上限(循环取尽 / cap放开)、列表 vs 地图池分离(两个状态存在、视口刷新只动列表池)。纯函数(mergePoisById/loadWorkViewport)单测优先。
- 若引大改,至少保证 component-contracts 全量仍绿。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-wsV)

- 只动:`server/src/hooks/use-work-viewport.ts`、`server/src/lib/viewport-search.ts`、`server/src/components/map-shell.tsx`(pois/listCatalog 接线)、`server/src/lib/mode-cache.ts`(若缓存语义需调)、`server/tests/*`
- **不碰**:`server/src/components/poi-list.tsx`/`secondary-sidebar.tsx`/`filter-panel.tsx`/`account-panel.tsx`(ws-u)、`server/src/lib/recruitment-store.ts`/`spatial-query.ts`(qa 已绿)、`server/src/lib/search.ts`/`public-search.ts`(qa 已绿;若需服务端无上限可确认 public-search clampPageSize 语义,必要时调整但保持契约)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsV/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsV && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-viewport-profile/reports/ws-v.md`:
改动文件 + 实现(增量/去上限/池分离/缓存语义)+ 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。**大改动务必小步 commit,预算纪律:先 commit 再验证**。

## 续作附录(boss 2026-08-19,预算超限中断,零产出)

首次派发预算超限(exit 1,零 commit 零 report)。worktree 仍停 dev 9b5f94a。开工先 `git status` 确认无半截改动。**本任务最大,务必小步 commit**。按以下顺序逐个进行,每完成一步即 `git add <文件> && git commit`(commit 先于验证),避免再次超限丢成果:

1. **先把 use-work-viewport.ts 的 work 视口分支从替换式改增量合并**(最小可提交单元):`existing: []` → 现有池,onBatch 改为 mergePoisById 合并;删除/调整 epoch+1/skipFetch/setPageOffset(0) 作废逻辑;空批次清空分支不再整池清空。commit。
2. **视口加载循环取尽**(page 循环到 noMore,替代 Page:1/maxPages:1)。commit。
3. **去 3000 硬顶**:mergePoisById 的 cap 对 work 放开(传大值/Infinity)。commit。
4. **列表/地图池分离**:新增 listCatalog 状态,pois = runPOIPipeline(listCatalog ?? catalog),catalog 只增不减(marker 源);缓存语义选一实现并说明。commit。
5. **同步注释**(viewport-search.ts:258-266 / use-work-viewport 内替换式注释 → 增量)。commit。
6. 补/更新契约测试(增量合并/去上限/池分离)。commit。
7. 完整门禁(npm test + typecheck + docs-check + diff-check)+ 写报告。
8. 预算纪律:每步都先 commit,验证只跑必要的(每步可跑 `npm test` 全量或相关子集)。

**绝不一次大改不 commit**。若某步风险高/犹豫,先 commit 当前已确定部分再继续。

## 续作附录 2(boss 2026-08-19,第三次派发——预算提额)

前两次均预算超限 exit 1,零产出(worktree 仍停 9b5f94a)。boss 判定:本任务体量匹配的预算不足($3 太低),已提额。开工 `git status` 确认无半截改动,然后 **严格按附录 1 的 8 步顺序**执行,每完成一步就 commit,commit 先于验证。**最关键:第一步(work 视口改增量合并)单独 commit 后再往下走**,避免任何一步未提交就中断。

## 续作附录 3(boss 2026-08-19,第四次——只剩收尾)

已 commit(2 个,进度良好):`2c08c69`(work 视口改增量合并,不整池替换/不清空 marker)、`49d7ab1`(视口加载循环取尽 maxPages=10000 防呆+短页/空页 break)。未提交:`server/src/lib/viewport-search.ts` 有 7+/1- 的小改动。**剩余很小**,不要重做。顺序:
1. `git status` + `git log --oneline -3` 对账;先 commit viewport-search.ts 未提交改动(若与去上限/池相关则注明)。
2. **去 3000 硬顶**:mergePoisById cap 对 work 放开(传 Infinity 或新常量)——查明 viewport-search.ts:575-589 的 cap 语义,work 传大值;commit。
3. **列表/地图池分离**:新增 listCatalog;pois = runPOIPipeline(listCatalog ?? catalog);catalog 只增不减(marker);缓存语义选一;commit。
4. 同步注释(viewport-search.ts:258-266 / use-work-viewport 替换式注释 → 增量)。
5. 补/更新契约测试(增量/去上限/池分离),至少 component-contracts 全绿。
6. 完整门禁 + 写报告。预算纪律:每步 commit。
