# 批次 20260822-boss-tmap-polish — TMap 完善 + 百度就绪信号修正

## 目标

用户真机反馈 7 个 bug(2026-08-22):

1. 腾讯地图的 poi 缩放与聚合没做好
2. 腾讯地图的卫星、深色没实现
3. 百度地图已恢复(有效 AK),但还是失败(就绪超时回滚)
4. 去掉腾讯地图水印(logo_def.png + ©2026 Tencent - GS(2026)1190号)
5. 实现腾讯地图的比例尺,跟高德逻辑一样
6. 腾讯地图的公司 poi 样式需要跟高德一样,也要带公司 icon
7. 右下角地图组件(zoom +/-)对腾讯地图无控制效果

## 根因调查结论(boss,2026-08-22)

- **bug 7 已定位**:`map-shell.tsx:1761-1768` `handleZoomIn/handleZoomOut` 经逃生舱 `raw.zoomIn?.()` 直连 —— AMap 有 zoomIn/zoomOut,TMap raw 无此方法 → 点击无效。修复:契约化 `view.setZoom(view.getState().zoom + 1)`(map-shell.tsx 该段 + 契约测试防回归)
- **bug 2 已定位**:`tencent-engine.ts:121` setStyle `satellite → raster` 已实现,dark 存在但「暂不暴露」(L121-125 注释)—— 需暴露 dark
- **bug 4 已定位**:`tencent-engine.ts:194-196` hideControlDom 对版权/logo **刻意保留可见**(ToS 署名)—— 用户明确要求去掉,改为隐藏(记录 ToS 权衡)
- **bug 5 现状**:`tencent-engine.ts:689-701` addControl('scale') 双路径(`control ?? Control`)但 console 有「TMap ScaleControl 不可用,比例尺降级」—— 需核实降级原因(命名空间路径?)并修
- **bug 3 已定位(关键)**:百度 AK 已有效(getscript 加载成功、无 APP不存在 弹窗),但 `baidu-engine.ts:341-399` 的就绪等待(setMapReadyCallback 优先 + tilesloaded 兜底)**均未触发** → 1.5s 超时抛「BMapGL 地图就绪超时」→ 回滚。**BMapGL v1.0(getscript?type=webgl&v=1.0)的事件集需核实**——大概率 setMapReadyCallback 是 2.0 API,v1.0 事件名不同(loadend? mapReady? 或轮询 getMapType/tilesLoaded 状态)
- **bug 1/6 现状**:TMap MultiMarker 不支持 HTML content → 聚合徽章/公司 icon HTML 全部降级默认点。契约 `icon: {src, size}` 已有(ws-1),MultiMarker 路径有 styleId 归组(setStyles)—— 公司 icon 应走 IconStyle(url);聚合徽章需 TMap 可渲染形态

## Workstream 表

| ws | 分支 | 主题 | 拥有文件 | 不碰 |
|---|---|---|---|---|
| a | feature/tmap-poi | bug 1+6:POI 缩放/聚合 + 公司 icon | `tencent-engine.ts`(**marker/MultiMarker/icon/visible 段**)、`map-markers.ts`(聚合徽章 TMap 适配)、`city-cluster.ts`(若需)、`server/tests/map-engine-tencent.test.mjs` | ws-b 的 tencent 段(style/scale/controls)、map-shell 全部 |
| b | feature/tmap-style-controls | bug 2+4+5+7:样式(卫星/深色)+ 水印 + 比例尺 + 右下角控制 | `tencent-engine.ts`(**style/setStyle/scale/addControl 段**)、`map-shell.module.css`(水印隐藏)、`map-shell.tsx`(**仅 L1755-1775 zoom 按钮段**)、`server/tests/map-engine-tencent-style.test.mjs`(新) | ws-a 的 tencent 段、map-markers.ts |
| c | feature/baidu-ready-signal | bug 3:就绪信号修正 + 全链路验证 | `baidu-engine.ts`(就绪等待段)、`server/tests/map-engine-baidu.test.mjs` | 腾讯/高德全部、map-shell 全部 |

**tencent-engine.ts 段切分**:ws-a = createMarker 类与 MultiMarker 段(约 L240-600);ws-b = setStyle/scale/addControl/隐藏段(约 L120-240 + L680-710)。以函数为单位互不侵入;merge 冲突按「保留双方段落」。

## 合并顺序

轮1: ws-a、ws-b、ws-c 并行开发(段切分已隔离)→ 按 a → b → c 顺序合并 → 每轮 push。

## 门禁(每 WS)

- `cd <wt>/server && npm test`(基线 1128 零漂移 + 新增)、`npm run typecheck`
- `cd <wt> && make docs-check`(2026-08-22 起 docs-check 已全绿,不再有基线红)、`git diff --check`
- 小步 commit(Conventional Commits)

## 纪律

- 进程内 worker 通道(Agent 工具);**若中途 API 402 中断:直接退出说明进度,boss 会原地恢复,已 commit 不重做**
- 不 merge、不 push、不切分支、不碰主树、不 npm install、不改现有 UI 设计(zoom 按钮仅契约化修复,视觉不变)
- 汇报末两行 token:`门禁: PASSED|FAILED` / `结论: OK|BLOCKED: <一句话>`
