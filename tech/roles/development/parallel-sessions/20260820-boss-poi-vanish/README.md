# 批次 Manifest — 20260820-boss-poi-vanish

目标:修复「第一次点击公司 POI → 地图先回默认初始化位置(杭州)→ 所有 POI 消失」。

## 根因(Explore 结论,2026-08-20)

1. **主根因(相机永停杭州)**:geolocation settle 的相机移动受 `hasInteractedRef` 门控(map-shell.tsx:512)。
   首点 pin 点击置 `hasInteractedRef=true`(1471)→ settle 时跳过 `setCenter(用户位置)+setZoom(15)`(513-514)
   → 相机永久停在 createMap 默认中心 [120.15,30.27] zoom 13(467)。
2. **POI 消失机制**:`distanceOrigin = mapCenter`(985,初始=杭州 202)→ 缓存带 distance 筛选时
   marker 池以杭州为圆心重滤(1170-1183)→ 用户区域 pin 掉出 visiblePOIIds(1276-1289)→
   `marker.hide()`(map-markers 617-632)→ 全部消失。
3. **次要(handleLocate 失败兜底)**:定位失败时 `setCenter([120.15,30.27])+setZoom(13)`(1696-1697/1707-1708)
   ——把相机精确拉回默认位置。

## Workstream(单 WS)

| ws | 分支 | worktree | 主题 | 合并顺序 |
|---|---|---|---|---|
| ws-poi-vanish | fix/poi-first-click-camera | /Users/acccan/dm-wt-poi-vanish | 定位相机移动不被首点抑制 + handleLocate 失败不回默认中心 + distance 圆心正确 | 1 |

## 不做(Deferred)

- 聚合徽章下钻到城市行政中心(设计行为,非 bug)
- UI 设计变更(无)
- Env-only(无)

门禁:`cd server && npm test` 全绿 + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/ws-poi-vanish.md,末两行 token。Worker 不 merge、不 push、不碰主树,worktree 已预建。
