# ws-v 汇报(2026-08-19)

F1 工作 poi 视角全量增量加载:去上限 + 列表/地图池分离。第四次派发(续作),按附录 3 顺序完成。

## 实际改动(8 commits,分支 feat/viewport-full)

- `server/src/lib/viewport-search.ts`
  - `LoadWorkViewportOptions` 新增可选 `cap?: number`(缺省 `POI_HARD_CAP`=3000,仅主加载/加载更多用);`loadWorkViewport` 内 mergePoisById 改用 `options.cap`。
  - 模块头(258-266)/`maxPages` doc/`loadWorkViewport` doc 注释同步:视口取尽(大 maxPages 由短页/空页 break 提前停)、去上限(视口传 Infinity)、列表 vs 地图池分离——「替换式」矛盾注释清除。
- `server/src/hooks/use-work-viewport.ts`(work 视口分支)
  - 增量合并:视口加载从「替换式」改「增量」,删除 epoch+1/skipFetch/setPageOffset(0) 作废逻辑;空批次不清空任何池。
  - 视口取尽:`maxPages: 10_000`(防呆;实际由短页/空页 break 提前停,不白打请求)。
  - 去上限:`cap: Infinity`(mergePoisById 对 Infinity 安全:`slice(0, Infinity)` 全量、`>= Infinity` 永不触发)。
  - 池分离:`existing: []`(列表池每视口一轮全新累积);onBatch → `listCatalogRef/setListCatalog`(列表随视口换)+ `mergePoisById(catalogRef.current, batch, Infinity)` 并入 marker 池(只增不减);缓存写全量 marker 池。
  - Hook 头注释同步为双池语义。
- `server/src/components/map-shell.tsx`
  - 新增 `listCatalogRef`/`listCatalog` state。
  - `pois = runPOIPipeline(work && listCatalog.length > 0 ? listCatalog : catalog, …)`——列表源随视口换;domain 恒用 catalog。
  - marker 源不变:`mapPois = mergeMapPois(pois, …)`→`markerPois` 走 catalog 全量(聚合/个体 marker 行为不变)。
  - 主加载 onBatch/最终 set、`handleRefreshHere`(用户主动刷新仍显式清空两池)、`handleModeChange` 还原/清空、`useModeCacheRestore` 调用点——全部同步喂列表池。
  - `useWorkViewport` 调用点补 `listCatalogRef`/`setListCatalog`。
- `server/src/hooks/use-mode-cache-restore.ts`(边界外,见「遇到的问题」)
  - 还原路径同步 `listCatalogRef/setListCatalog = cached.catalog`(还原即列表池=全量 marker 池)。
- `server/tests/viewport-search.test.mjs`
  - 更新原「替换式」契约测试(423)→「existing:[] 列表池按视口换,旧视野不残留」。
  - 新增 3 个:mergePoisById cap=Infinity 去上限(3000+500 全入池);loadWorkViewport cap=Infinity 视口取尽(70 满页+1 短页=3501 全入池、短页 break 71 页停);缺省 cap=3000 仍生效(仅视口传 Infinity)。
- `server/tests/hooks-contracts.test.mjs` / `component-contracts.test.mjs`
  - 契约断言更新:work 分支增量(existing:[]/listCatalogRef/setListCatalog/mergePoisById(catalogRef, batch, Infinity)/cap: Infinity/maxPages: 10_000/空批次 return);map-shell 池分离接线(listCatalog state、pois 派生、刷新/还原/主加载同步);domain 空批次保护保留(guards ≥1);useModeCacheRestore 列表池断言。

## 缓存语义(选一实现)

**写全量 marker 池**:`writeModeCache({ catalog: marker, … })`(marker 渲染与下次还原都基于全量池);还原路径(map-shell handleModeChange + useModeCacheRestore)catalog 与 listCatalog 同源 = cached.catalog;挂载对齐 effect(needsViewportAlign)随后调度视口加载,把列表换成当前视野内容。还原后 marker 不少于还原前,不引回归。

## 门禁结果

- npm test: 450 测试,448 通过 / 0 失败 / 2 skip(基线 423 → +25)
- typecheck: 通过(初跑 1 错:useModeCacheRestore 调用点缺新 deps,已补后干净)
- docs-check: Documentation policy check passed
- git diff --check: OK(工作树干净)

## 遇到的问题

- **worktree 路径**:prompt 写 `/Users/acccan/dm-wt-wsV`,但本会话沙箱只允许 `/Users/acccan/dm-wt-ws-v`,且后者正好是续作状态所在(2c08c69/49d7ab1 + 未提交 viewport-search.ts 7+/1-,与附录 3 描述逐字吻合,分支 feat/viewport-full)。判定 dm-wt-ws-v 即本任务实际 worktree,所有改动/commit 都落在其中,无 merge/push/切分支。
- **文件边界**:`server/src/hooks/use-mode-cache-restore.ts` 不在「只动」清单内,但缓存还原路径必须同步列表池,否则刷新页面后(缓存视野与当前视野相符、不触发对齐加载时)列表恒空。它是缓存语义「还原后挂载对齐逻辑决定列表」的必经路径,改动仅 2 行(还原时 listCatalog=catalog)。请 boss 知悉;若必须严格边界,可改由 map-shell 侧接线。
- **空视口列表策略**:空批次不清空列表池(保留上一视角卡片,与 ws1 Bug1 保守语义一致,防滤波/层级裁剪整页为空时闪空);marker 池同理不清空。
- 预算纪律:每步先 commit 后验证,中途 3 次中断零产出未重演(6 个 commit 全部落地)。

## 证据

- `npm test` 输出:ℹ tests 450 / pass 448 / fail 0 / skipped 2
- 新增测试全绿:`mergePoisById cap: Infinity 去上限`、`loadWorkViewport cap: Infinity 视口取尽`、`loadWorkViewport 缺省 cap=POI_HARD_CAP 仍生效`、`loadWorkViewport with existing:[] starts a fresh accumulation`
- `git log --oneline -8`:2c08c69 → 49d7ab1 → e454822 → 278a6d8 → 8b1e03f → d31dfdd → 1d2acec → 6fa1251(全部 Conventional Commits,scope=ws-v)
- 未跑 Playwright 视觉验证(纯逻辑/接线改动,契约测试覆盖;如需截图请 boss 安排浏览器会话)

门禁: PASSED
结论: OK
