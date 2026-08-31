# 20260822-boss-saved-layer-card — 收藏模式列表用 POI 卡片 + 历史点击冲突修复

## 目标(用户指示,2026-08-22)
1. **收藏模式下的探索 item 采用原先的卡片样式**(普通模式的 POIList + POICard 玻璃卡片,替代当前 SavedList 简单行)。
2. **修复冲突**:收藏模式(互斥)下点击历史记录中的历史查询点,与收藏模式功能冲突(同屏双数据源/详情越狱/上下文偷换)。

## 现状证据(Explore ×2,2026-08-22,详见两批 reports 与下方)
- 收藏模式桌面 secondary-sidebar.tsx:512-523 savedMode 分支渲染 `SavedList`;移动 map-shell.tsx:2763-2777 同。SavedList 行=saved-panel.tsx:103-143(对比圆钮+名称/地址+「取消收藏」textBtn),样式 recent-panel.module.css:151-189(透明、12px、无玻璃)。
- 普通模式:poi-list.tsx:201-227 每项 cardSlot 渲染 `POICard`;poi-card.tsx:147-198 按 isDomainPOI/isRecruitmentPOI 分派内容(200-260/262-357);玻璃 token poi-card.module.css:3-36(Apple Maps 液态玻璃:白 0.48、16px、blur 32px saturate 180%,hover/selected 55-98,暗色 339-375)。
- 数据桥接现成:`saved-overlay.ts:21-50` `savedPlaceToOverlayPoi`(先 `resolveSavedPoi` compare-saved.ts:83-85 活数据,未命中构造快照兜底)。SavedList 已收 catalog/origin props。
- 冲突机制:互斥只落显示层(visiblePOIIds/savedMode),管线 load effect(map-shell.tsx:1053)零门控;`handlePickRecent`(map-shell.tsx:1934-1966,桌面/移动共用)无条件改 query/mode + 重拉 → 收藏开着时:搜索框=历史词&列表=收藏(a)、实体详情越狱(b)、catalog 被替换且 mode 缓存组合是「未存在过的」(c)、overlayPois 按 mode 静默切换(d)。

## 目标语义
- 收藏模式(开):Explore 列表 = **POIList 卡片**(与普通模式完全相同组件与样式);卡片点击 = 原 onPickSaved 行为(命中活数据开详情);卡片右上新增「移除收藏」按钮 = onRemoveSaved。
- 收藏模式下列表区不再渲染对比表(对比功能保留在账户页 SavedList,不动)。
- **点击历史查询点 = 显式离开收藏视图**:`handlePickRecent` 开头若收藏模式开启,先 `hideSavedOverlay()` 再走原链路(最小面,与 toggle 登录门控同模式)。
- 收藏 toggle 相机行为保持(上批 nofly:不跳视角)。

## Workstream
| ws | 分支 | worktree | 主题 | 门禁 |
|---|---|---|---|---|
| ws-1 | fix/saved-layer-card | ../dm-wt-saved-card | 收藏模式列表复用 POICard(+移除按钮)+ handlePickRecent 收藏门控 | typecheck + npm test + docs-check + 回归测试 |

## 合并顺序
1. ws-1(唯一;依赖前批 nofly 合并完成后再派发)
