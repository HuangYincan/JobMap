# qa6 汇报(2026-08-19)

## 实际改动

map-shell 巨型组件拆分(QA scan #6,行为保持重构,零 UI/逻辑变化),共 4 个 commit:

1. `89fd600` **refactor(map-shell): extract session cache restore into useModeCacheRestore**
   - `server/src/hooks/use-mode-cache-restore.ts`(新,60 行):首屏只读一次缓存,还原 catalog/pageOffset/searchOrigin/query/filters/sort + noMore 复位;deps 恒空语义保留。
   - `server/src/components/map-shell.tsx`:删内联 restore effect,改 `useModeCacheRestore({...})` 接线。
2. `d513741` **refactor(map-shell): extract suggest fetch into useSearchState**
   - `server/src/hooks/use-search-state.ts`(新,142 行):建议防抖(suggest fetch 一并迁移,依赖只留 `[query, mode]`)+ 空查询清空建议。
   - `map-shell.tsx`:-128 行,改 `useSearchState` 接线;建议提交/清理回调保持在 shell(与 handler 联动)。
3. `2de8f30` **refactor(map-shell): extract work viewport loading into useWorkViewport**
   - `server/src/hooks/use-work-viewport.ts`(新,324 行):视口加载器创建/调度(moveend/zoomend 防抖 + 抑制窗口)、work 替换式加载、domain 分类门控+随视角刷新、挂载对齐调度(ws1 Bug1)。导出 `VIEWPORT_SUPPRESS_MS`/`readMapViewSnapshot`/`WorkViewportState`;loader 实例经返回值暴露给主加载 finally 补跑。
   - `map-shell.tsx`:-242 行,`const { viewportLoaderRef } = useWorkViewport({...})` 接线;主加载 finally 补跑(`viewportLoaderRef.current?.schedule()`)与 toggle 收藏抑制标记写入保留在 shell。
   - 修复接线缺口:shell 1429 行仍需 `VIEWPORT_SUPPRESS_MS`(常量已移 hook),补 import。
4. `ac6be6f` **test(map-shell): move viewport contract assertions to hooks, add hooks-contracts suite**
   - `server/tests/component-contracts.test.mjs`:4 个用例的断言随代码移动同步到 hook(位置匹配更新,断言强度不弱化):domain category gating(视口门控/分类驱动/filters 下行)、empty batch three-state(视口替换路径移 hook,主加载路径留 shell)、mount-align(整体移 hook + shell 接线断言)、saved overlay toggle(常量与 onViewChange 移 hook,toggle 内抑制标记顺序断言保留)。
   - `server/tests/hooks-contracts.test.mjs`(新,97 行):3 个 hook 的存在/导出签名/关键逻辑在 hook 内(视口调度条件、搜索清理、缓存 restore 分支)。

## 抽取结构(hook 清单/职责/行数变化)

| 文件 | 行数 | 职责 |
|---|---|---|
| `map-shell.tsx` | 2822 → **2666**(-156,6%) | 只做编排:主加载、抽屉手势、账户/收藏/投递、markers、toggle 抑制、Bug3 hasInteractedRef 门控 |
| `hooks/use-work-viewport.ts` | 324 | 视口加载器创建/调度、work/domain 替换加载、挂载对齐、抑制窗口 |
| `hooks/use-search-state.ts` | 142 | 搜索建议 fetch/防抖、空查询清空 |
| `hooks/use-mode-cache-restore.ts` | 60 | 首屏会话缓存还原 |

## 门禁结果

- npm test: 447 通过 / 0 失败 / 2 skip(component-contracts 含 Bug1/Bug3 用例全绿;hooks-contracts 新增 4 用例全绿)
- typecheck / docs-check / git diff --check: 通过

## 遇到的问题

- **接线缺口**:续作遗留的 viewport 接线中,map-shell 1429 行仍引用已移走的 `VIEWPORT_SUPPRESS_MS` 而未 import(会造成运行时 `Date.now()+undefined=NaN` 抑制窗口失效 + 编译错误)→ 补 import 修复。
- **契约断言位置移动**:4 个既有用例的断言正则因代码移入 hook 而失败 → 按 boss 规则「只更新位置匹配、不弱化断言」同步移动;主加载路径断言(catalogCoversView view.bounds、空批次注释)保留在 map-shell 侧。
- **Bug3 hasInteractedRef**:判定逻辑原样保留在 map-shell(233/548-576/728-734/1621 区域未动),`component-contracts.test.mjs:395` 用例零修改通过。

## 证据

- `npm test` 尾部:`ℹ tests 447 / pass 445 / fail 0 / cancelled 0 / skipped 2`
- 提交序列:`89fd600 → d513741 → 2de8f30 → ac6be6f`(分支 `fix/qa-map-shell`,worktree `/Users/acccan/dm-wt-qa6`,未 merge 未 push)

门禁: PASSED
结论: OK
