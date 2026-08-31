# ws-c 汇报(2026-08-22)

分支 `fix/tencent-poi-icon`,worktree `/Users/acccan/dm-wt-ti`。3 个 commit:
`500f953`(fix 锚点+候选链+图钉 icon)、`a4f9d03`(test +9)、`171c544`(docs 回填)。

## 实际改动

- `server/src/lib/map-engine/tencent/tencent-engine.ts`(仅 marker/icon/anchor 段)
  - `resolveTMapMarkerAnchor` **公式修正**:anchor = -契约 offset(旧公式
    (w/2-ox, h-oy) 是 bug 3「腾讯 poi 坐标偏移」根因——把图钉/徽章整图上移
    左上:图钉 (32,80) 应为 (16,40)、徽章 (40,60) 应为 (20,20)、聚合 (54,81)
    应为 (27,27));无 offset → (0,0) 上左角;0-x 防 -0;注释回填契约推导
    (AMap content 语义 屏幕位+offset,联立 SDK imageTopLeft=屏幕位-anchor;
    百度 ws-c 段 SDK 源码核实同款)
  - `resolveMultiStyle` 注释同步(anchor 与尺寸无关)
- `server/src/lib/map-markers.ts`(仅 TMap icon 构造段 + 同段纯函数)
  - 新增导出纯函数 `resolveTMapIconSrc(logoUrl, careerUrl, fallbackSrc)`:
    logoUrl 本地/ok 直通;fail → `faviconCandidatesFromUrl(careerUrl)` 候选链
    (跳过与 logoUrl 相同者,复用 company-logo.ts 生成);首个 ok 者作 src;
    unknown 候选收 toPreflight 由调用方后台预检(失败记忆化不重试);全败/
    无 logoUrl → fallback(无 logoUrl 不试候选,与 AMap 徽章路径一致,零预检)
  - addMarker TMap 段:招聘 POI 走候选链(logoUrl + 全部 unknown 候选一次
    预检,升级一次重建到位);**Domain POI 补图钉 dataURL icon(32×40,与 AMap
    同视觉,底尖经 anchor (16,40) 精确钉点,零预检)**——此前 TMap 下是 SDK
    默认红 pin(content 不渲染),锚点错位 + 视觉不一致
- `server/tests/map-engine-tencent.test.mjs`(+9,58→67)
  - 更新既有 anchor 断言(3 处)至契约公式
  - 新增:契约三形态落点、状态尺寸 40/46/52 零漂移、缩放无关(屏幕位+offset
    恒等式)、resolveTMapIconSrc 纯函数、候选链控制器级 5 项(fail→icon.horse
    作 src / unknown→双预检+重建升级 / ok 直通 / 全败记忆化 / 无 careerUrl
    保持 ws-e)、Domain 图钉 icon、控制器×引擎集成(徽章/图钉/聚合 anchor
    钉死 (20,20)/(16,40)/(27,27))
- `tech/23-map-engines.md`(仅追加)「ws-c 回填:腾讯 POI 锚点契约修正(anchor
  = -offset)+ TMap icon 候选链」

## 门禁结果

- npm test: **1384 通过 / 0 失败**(2 skip;基线 1375,净 +9)
- typecheck / docs-check / git diff --check: 全部通过

## POI 偏移核查结论(疑点 a/b/c 逐项)

- **a 聚合徽章 size/anchor**:buildOffset 恒 [-s/2,-s/2] 与 icon [s,s] 匹配;
  anchor = -offset 后恒 (s/2,s/2) 中心钉点、与尺寸无关;旧公式 s 越大偏越多
  (54px 徽章上移左上 27/54px,zoom≤8 城市视野肉眼可见)——**根因确认**
- **b content+icon 并存**:TMap 只走 icon(content 不写 geometry);offset
  [-16,-40] + 32×40 图钉 → anchor (16,40) 底尖精确钉点——**根因确认**
- **c 状态尺寸 40/46/52**:map-markers 的 TMap icon.size 恒 [40,40](状态视觉
  仅存在于 AMap content 路径),且新 anchor 与尺寸无关 → 选中/高亮态不生成
  新 styleId、锚点零漂移——**无此缺陷**;遗留:TMap 状态视觉仅 zIndex 层序

## 遇到的问题

- 无 BLOCKED 级问题。候选链初版会对「无 logoUrl 但有 careerUrl」的公司也试
  候选 → 与 AMap 徽章路径(缺 logo 不试候选)不一致,已加 `!logoUrl` 早退
- 遗留(边界外):距离圈手柄(distanceHandle,map-shell 契约外 duck-type)在
  TMap 下仍为 SDK 默认 pin(map-shell.tsx 在「不碰」清单)
- 真机验收(icon.horse 实际显示/缩放像素对照)需 boss 合并后冒烟(deferred)

## 证据

- `map-engine-tencent.test.mjs`:67/67 通过(含 9 项新增)
- 全量:1382 pass / 2 skip / 0 fail
- 3 commits:500f953(fix)/ a4f9d03(test)/ 171c544(docs),未 merge 未 push

门禁: PASSED
结论: OK
