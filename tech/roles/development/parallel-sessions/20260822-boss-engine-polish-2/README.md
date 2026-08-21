# Batch — 20260822-boss-engine-polish-2(百度和腾讯引擎第二轮打磨)

## 目标

用户 5 个 bug:
1. 百度的卫星和深色没有实现
2. 百度的 poi 无法正确加载
3. 腾讯的 poi 会坐标偏移
4. 腾讯的 poi 不带 icon
5. 腾讯和百度的用户定位有问题,不是真实位置

## boss 侦察情报(2026-08-22,均已实测/读码)

- **bug 1 根因**:`baidu-engine.ts` STYLE_CONSTANT 卫星常量 `'BMAPGL_SATELLITE_MAP'` 可疑(worker 需核实 BMapGL 实际常量名,可能是 `BMAP_SATELLITE_MAP`);深色 `applyMapStyle` 直接 warn 回退 normal,无实现(百度暗色 = `map.setMapStyleV2({styleJson})` 自定义样式 JSON)
- **bug 2 现状**:boss 实测百度聚合级别(z≤8)渲染正常(30 蓝簇),需 worker 在单点级别(z>8)实测定位(偏移/点击/图标)
- **bug 3 现状**:ws-a 已修 anchor 按尺寸;疑聚合徽章(zoom≤8 dataURL 图标)size/anchor 组合,或 content+icon 并存时偏移公式(worker 实测)
- **bug 4 根因实锤**:favicon.im 无 CORS 头 → TMap 纹理失败 → ws-e 降级 emoji 徽章(用户看为「不带 icon」)。**icon.horse 实测 `access-control-allow-origin: *`(CORS 合规)** → TMap icon 路径补候选链(favicon.im 失败 → 试 icon.horse → 成功显示 logo;AMap HTML 路径已有 fallbackUrls 候选链,TMap icon 路径缺)
- **bug 5 根因**:AMap=浏览器高精度定位(enableHighAccuracy:true);腾讯 `browserPosition` 缺 enableHighAccuracy 且 maximumAge:60000 缓存旧位;百度用 `BMapGL Geolocation`(IP 定位,城市级,不真实)

## Workstream 表

| ws | 分支 | worktree | 主题 | 文件边界 |
|---|---|---|---|---|
| a | fix/baidu-style | ../dm-wt-bs | 百度卫星常量修正 + 深色实现 | `baidu-engine.ts`(**仅 STYLE_CONSTANT/applyMapStyle/setStyle 段**)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(追加) |
| b | fix/baidu-poi-locate | ../dm-wt-bp | 百度 POI 单点级实测修复 + 定位改浏览器高精度 | `baidu-engine.ts`(**仅 POI/content/icon 段 + getCurrentPosition 段**)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(追加) |
| c | fix/tencent-poi-icon | ../dm-wt-ti | 腾讯 icon 候选链(icon.horse)+ POI 偏移核查 | `map-markers.ts`(TMap icon 构造段)、`tencent-engine.ts`(**仅 marker/icon/anchor 段**)、`server/tests/map-engine-tencent.test.mjs`、`tech/23-map-engines.md`(追加) |
| d | fix/tencent-locate | ../dm-wt-tl | 腾讯定位高精度对齐 | `tencent-engine.ts`(**仅 getCurrentPosition/browserPosition 段**)、`server/tests/map-engine-tencent.test.mjs`、`tech/23-map-engines.md`(追加) |

## 段切分(共享文件防冲突)

- `baidu-engine.ts`:ws-a 样式段(STYLE_CONSTANT/applyMapStyle/setStyle)vs ws-b POI/定位段 —— 按行隔离
- `tencent-engine.ts`:ws-c marker/icon/anchor 段 vs ws-d 定位段 —— 按行隔离
- 冲突以「保留双方段落」为解

## 合并顺序

轮1: ws-a → ws-b → ws-c → ws-d(并行开发,按序合并)。每轮 push origin/dev。
