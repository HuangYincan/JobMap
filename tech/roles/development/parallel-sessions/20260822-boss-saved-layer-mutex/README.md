# 20260822-boss-saved-layer-mutex — 收藏图层互斥语义(开=只留收藏)

## 目标
用户反馈(2026-08-22):收藏图层开关「没啥区别」。Explore 判定:现状是**叠加语义**且实现正常
(收藏 pin 按 id 去重并入结果集、与普通 pin 同样式;典型场景开关 pin 级零差异)——「开=只显示收藏点」
从未被实现。用户当面决策:**地图+列表都切**的互斥语义。

## 目标语义(用户决策)
- **开**:地图只显示收藏点 pin(普通 POI 全部隐藏)+ Explore 列表切换为收藏列表(「我的收藏」视图)
- **关**:恢复正常模式——恢复 toggle 前的地图内容(搜索管线 catalog pin)+ Explore 列表恢复搜索管线
- 视觉样式/布局/交互细节不变(非 UI 设计变更,数据流语义变更)

## 现状证据(Explore,2026-08-22)
- toggle:`use-saved-layer.ts:77-109`(未登录弹窗门控 78-81;写 pref+setState 83-84;开时 fit 收藏外接框 86-108;无收藏 early return 88)
- overlayPois:`use-saved-layer.ts:67-70` `savedPlacesToOverlay(savedPlaces, compareCatalog, mode)`;依赖 savedPlaces state + compareCatalog + mode
- markerPois:`map-shell.tsx:1302-1308`(domain 1306 / work 1273-1298),`mergeMapPois(runPOIPipeline(catalog,...), overlayPois, savedOverlay && Boolean(user))`
- 去重合并:`saved-overlay.ts:67-75` —— overlay pin 仅当 id 不在结果集时补入;头注释 4-6「搜索列表仍只走 catalog 管线。叠加层只给地图」
- 渲染:`use-poi-map.ts:110-121` setPOIs;`map-markers.ts:561-587` 只增不删;可见性 `map-shell.tsx:1377-1390`(overlay id 恒显示豁免 LOD)
- savedPlates:`map-shell.tsx:307`;refreshSaved 414-422 → fetch /api/me/saved;路由 app/api/me/saved/route.ts:16-19(未登录 {items:[]})
- 上一批修复(6bf2092)保证:空批次不置空 catalog(marker 池保留)、收藏相机同步状态机——互斥实现应**复用**这些保证(关时秒恢复、不重查)

## Workstream
| ws | 分支 | worktree | 主题 | 门禁 |
|---|---|---|---|---|
| ws-1 | fix/saved-layer-mutex | ../dm-wt-saved-mutex | 收藏图层互斥语义:开=地图只收藏+列表切收藏;关=恢复搜索管线 | typecheck + npm test + docs-check + 回归测试 |

## 合并顺序
1. ws-1(唯一)
