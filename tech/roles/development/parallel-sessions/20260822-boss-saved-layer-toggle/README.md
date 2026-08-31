# 20260822-boss-saved-layer-toggle — 收藏图层切换后 POI 全部消失

## 目标
bug: 收藏图层点按切换后所有 POI 从地图上消失(domain 模式为主;work 模式次因需判定)。

## 根因(Explore 已定位,2026-08-22)
- **主因**: `use-saved-layer.ts:87-97` 打开收藏时 `map.setBounds(收藏点外接框)` 带动画;
  500ms 抑制窗口是时间窗补丁(`use-work-viewport.ts:35/241`, `use-saved-layer.ts:84-86` 自认补丁),
  跨城动画 >500ms → `moveend/zoomend` 晚到窗口外 → 视口刷新(`use-work-viewport.ts:171-209`)
  → 新视野空批次 → `catalogRef.current=[]`(:203-208) → `markerPois` 坍缩(`map-shell.tsx:1292-1298`)
  → `setPOIs([])` → `controller.clear()` 逐个 remove 全部 marker(`map-markers.ts:564-568/515-522/447-454`),
  **只删不建**,无重建路径。
- **次因(work 模式)**: `distanceOrigin = mapCenter`(`map-shell.tsx:1079-1089`),toggle 后圆心变收藏区域中心,
  radius 外全裁(`map-shell.tsx:1263-1288`)——需 worker 判定是否预期。
- **dev 专属**: StrictMode keepalive 链 — Layers 面板 dynamic import → disconnect/reconnect
  → `setView(null)` → `use-poi-map.ts:82-87` 销毁控制器摘 marker → 重连回放。

## Workstream
| ws | 分支 | worktree | 主题 | 门禁 |
|---|---|---|---|---|
| ws-1 | fix/saved-layer-toggle | ../dm-wt-saved-layer-toggle | 结构性修复收藏 toggle 后 POI 消失(#1 必修,#2 判定,#3 评估) | typecheck + npm test + docs-check + 回归测试 |
| ws-2 | fix/docs-check-exclude-sessions | ../dm-wt-docs-check | docs-check 排除 parallel-sessions(20260821 既有自匹配红,ADJUDICATE 拆出) | docs-check + diff-check |

## 合并顺序
1. ws-2(docs-check 规则修复,先合使门禁转绿——ws-1 合并后的 docs-check 依赖它)
2. ws-1(代码修复)
