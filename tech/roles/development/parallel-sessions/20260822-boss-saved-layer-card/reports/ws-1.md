# ws-1 汇报(2026-08-22)

## 实际改动(4 commits,分支 fix/saved-layer-card,worktree dm-wt-saved-card)

1. `feat(saved-layer-card)`(4c04b15)— 卡片能力 + 桥接:
   - `server/src/lib/saved-overlay.ts` → 新增 `savedPlacesToListPois(places, catalog, origin?)`
     桥接:活数据优先(`resolveSavedPoi` 经 `savedPlaceToOverlayPoi` 首步复用),快照兜底;
     微调(注明):带 origin 时按 haversine 补全快照 `distance`(与 SavedList 对比表同口径),
     无坐标且无活数据行丢弃(卡片必须有点位)。
   - `server/src/lib/i18n.ts` → 新增 `removeSaved` 键(zh「取消收藏」/ en「Remove」)。
   - `server/src/components/poi-card.tsx` → `POICardProps` 新增可选 `onRemove?: (poi) => void`;
     `RemoveSavedButton`(trash icon,liquid glass 风格,32px 命中区,透明底 → hover 变调
     `--accent` #007AFF;点击/键盘 `stopPropagation` 隔离卡片选中);domain + recruitment
     两个 header 均条件渲染(scaleBadge 并列,header 右上),不传零影响普通模式。
   - `server/src/components/poi-card.module.css` → `.removeBtn`(32px 命中区、border-radius 10、
     transparent → hover `--accent-soft` 底 + `--accent` 色、focus-visible accent outline)。
   - `server/src/components/poi-list.tsx` → 新增 `onRemove` 可选 prop 透传到 POICard(默认 undefined)。
2. `feat(saved-layer-card)`(31a3bb0)— 收藏模式消费 + 门控:
   - `server/src/components/secondary-sidebar.tsx` → savedMode 分支 SavedList → `POIList`
     (pois=`savedListPois` 内部 useMemo 桥接;卡片点击 `savedItems.find(poiId) → onPickSaved`;
     `onRemove={onRemoveSaved ? (poi) => onRemoveSaved(poi.id) : undefined}`;空态
     `savedEmpty`;关闭对比表/无限滚动);移除 SavedList 动态导入与 `dynamic` import。
   - `server/src/components/map-shell.tsx` → `savedListPois` useMemo(移动抽屉用);移动 drawer
     `savedLayerEnabled` 分支 SavedList → POIList(`handlePickSaved` + `setMobileSheet("explore")`
     语义,onDeselect 与普通模式移动列表同口径);`handlePickRecent` 开头加
     `if (savedLayerEnabled) hideSavedOverlay()` 门控,deps 补齐
     `savedLayerEnabled`/`hideSavedOverlay`。
3. `test(saved-layer-card)`(3e33727)— 回归 + 契约:
   - `server/tests/saved-list-card.test.mjs`(新,10 项);`saved-layer-mutex.test.mjs` /
     `component-contracts.test.mjs` 断言由 SavedList 更新为 POIList + savedListPois 卡片语义。
4. `docs(saved-layer-card)`(d026262)— `tech/16-bug-fixes.md` 追加 2026-08-22 节
   (症状/根因/方案/验证)。

未碰:账户页 SavedList/SavedPanel(对比表、非互斥路径保留)、RecentPanel、普通模式渲染、
视觉 token 体系、`.env` 等密钥。无 merge / 无 push / 无 npm install / 无 Env-only。

## 卡片复用路径 + 移除按钮实现
- 复用路径:桌面 `SecondarySidebar` savedMode 分支与移动 drawer `savedLayerEnabled` 分支都渲染
  `POIList` + `POICard`——与普通模式完全相同组件/样式(玻璃卡片);数据经
  `savedPlacesToListPois` 桥接(活数据优先 compare-saved.ts:83-85,快照兜底
  saved-overlay.ts:21-50),卡片 onClick 沿用 `onPickSaved`/`handlePickSaved` 语义
  (活数据命中开详情,不 flyTo)。
- 移除按钮:`POICard.onRemove?` 可选 prop,POIList 透传;header 右上 scaleBadge 并列;
  32px 命中区、透明底 → hover `--accent-soft` 变调(#007AFF 主交互色,绿仅薪资/工时);
  aria-label/title i18n 化(`removeSaved`);点击与键盘均 stopPropagation,不触发卡片选中。

## 历史门控实现 + 为何最小面
- `handlePickRecent`(map-shell,桌面/移动共用唯一入口)开头一行门控
  `if (savedLayerEnabled) hideSavedOverlay()` 再走原链路(replay → openExploreSearch →
  openDetail);deps 补齐 `savedLayerEnabled`/`hideSavedOverlay`(hide 为 [] 依赖稳定回调)。
- 语义:点历史查询点 = 显式离开收藏视图开始新探索(与 toggle 未登录弹窗门控同模式,
  use-saved-layer.ts hide 路径)。
- 为何最小面:不选 B(load effect 依赖)/C(拆 openDetail)——冲突根因是 handlePickRecent
  无条件改 query/mode 重拉,门控在唯一入口收敛即可;B/C 会扩大副作用面(重拉依赖链、
  详情打开拆分),回归风险不成比例。

## 遇到的问题
- 契约测试旧断言 3 处引用 SavedList 渲染/注释(saved-layer-mutex ×2、component-contracts ×1)
  → 全部同步更新为 POIList + savedListPois 卡片语义,负断言收窄为
  `const SavedList = dynamic` / `<SavedList`(注释中保留「账户页 SavedList」字样,全词
  doesNotMatch 会误伤)。
- 门禁要求 jsdom 断言 `handlePickRecent` 调用序:本仓库无 jsdom 运行时(与 saved-layer-sync
  同构,仓库既有约定),按「源码契约 + 语义镜像」实现——源码断言门控行位于原链路之前 +
  deps 含门控依赖;语义镜像断言「开 = 先 hide 再 replay;关 = 零门控直走」的调用序。
- 桥接公式 `resolveSavedPoi ?? savedPlaceToOverlayPoi` 中 `savedPlaceToOverlayPoi` 首步即
  `resolveSavedPoi`,直接复用它即为同语义(代码注释注明),无重复查找。

## 门禁结果
- npm test: 1161 测试 / 1159 pass / 0 fail / 2 skip(+saved-list-card 回归 10 项)
- typecheck / docs-check / git diff --check: 全部通过

门禁: PASSED
结论: OK
