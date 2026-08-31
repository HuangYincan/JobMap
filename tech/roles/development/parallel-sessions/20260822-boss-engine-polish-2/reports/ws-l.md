# ws-l 汇报(2026-08-23)— fix/baidu-blink(百度滚轮缩放 POI 闪烁)

## 复现与根因定位(必须项)

**复现**(worktree :3100 dev server + headless Chromium + 真实 AK,未改动页面代码,
每帧采样 `.BMap_Marker` 可见数 + pane display):滚轮每步 `visible=0 pane=none`
约 180-260ms(zoomend 带 150ms 防抖后恢复)——徽章随 markerMouseTarget pane 整批
消失再出现,即用户报的「闪烁」;boss 高频帧(消失+新增)为该现象的 60ms 采样形态。

**根因(BMapGL v1.0 getscript 源码核实 + 真机复验)**:SDK webgl 渲染下,overlay
管理器在 `zoomstart/movestart/animation_start` 隐藏整 markerMouseTarget pane
(源码:`this._panes.markerMouseTarget.style.display="none"` + `_zoomingOrMoving`
状态),`zoomend/moveend/animation_end` 恢复并重绘 marker(`_checkFireZoomend`
150ms 防抖)——设计意图是动画期间不更新 DOM 点击目标(GL 纹理 marker 由 canvas
动画承载)。**本引擎 content 徽章的视觉 = 注入该 pane 的 DOM(厂商 GL 纹理是
1×1 透明锚点)→ pane 隐藏即徽章全灭** = 闪烁根因。动画期间 `getZoom()` 返回逐帧
动画 zoom(deepZoomTo 逐帧回写 zoomLevel/centerPoint),`pointToOverlayPixelIn`
投影与画布同相机(2D 数学与 `_webglMapCamera` 投影实测逐值一致)。

## 二分各步结论(真机复验)

1. **禁校准循环**(moveend/zoomend/tilesloaded → 重定位,临时注释):瞬移**不消失**
   (pane.mjs 测量:每滚轮步 visible=0 pane=none 照旧)——且实测 deep zoom 动画期间
   moveend/zoomend/tilesloaded **根本不派发**(仅 deepzoommousewheel/zoomstart/
   update),校准与本闪烁无因果关系;
2. **禁 LOD 摘挂**(setVisiblePOIs):因 map-markers.ts 在「不碰」清单,**未做代码级
   禁测**,以 SDK 源码 + 时序判定排除:SDK marker `hide()` 只置单个 marker 自身
   display(`gd.hide(this.domElement)`),与共享 pane 的隐藏无关;闪烁发生在每次
   滚轮步、由 SDK 内部 zoomstart 处理器触发,与应用层 LOD 调用无因果;
3. **禁注入定时器兜底**:已注入徽章的 pendingContentInjection 为空,定时器空闲,
   且注入链不触碰 pane display——排除。

## 修复(baidu-engine.ts,最小改动,3 项)

1. 监听 `zoomstart/movestart/animation_start` → `getPanes().markerMouseTarget`
   恢复显示(官方公开 API;监听晚于 SDK 内部处理器,同任务内恢复无绘制间隙;
   zoomend 时 SDK 自身恢复+重绘,不冲突);
2. 同事件启动 rAF 按帧重算全部 content 标记定位(`pointToOverlayPixelIn(pt,
   {zoom: getZoom(), fixPosition: false})`,动画中投影与画布同相机→徽章平滑跟随);
   zoomend/moveend/animation_end 停止并收敛;停摆守卫(相机 ~1s 未变自终止)防
   事件丢失悬挂;无 rAF 环境(node)同步收敛一次;
3. `repositionContentMarkerDom` 值未变不写(同帧循环避免重复 style 失效)。

## 真机验收(修复后,worktree :3100 + headless Chromium + 真实 AK)

- **百度滚轮连续缩放(放大/缩小各 3 次,快拨 + 步进两种节奏)**:60ms 帧序列
  **0 消失帧**(可见徽章数全程不落 0,`min tracked=60`)+ **0 往返瞬移帧**
  (60ms 帧间最近邻匹配,位移>120px 后折返的 snap = 0;轨迹单调连续,最坏单帧
  位移与相机 zoom 增量一致)→ 徽章平滑跟随、位置连续变化;
- 点击徽章 → POI 卡正常弹出(同花顺卡片);reload 复验正常;console 0 error;
- AMap:1048 marker / 246 可见徽章 DOM、reload 正常、0 error;腾讯:canvas 渲染
  正常(仅既有 favicon.im CORS 预检噪音,与 ws-j 基线一致)→ 零回归;
- 修复前后对照证据:pane.mjs(修复前 `visible=0 pane=none` 每滚轮步;修复后
  `pane=block` 全程、visible 不落 0)。

## 实际改动

- `server/src/lib/map-engine/baidu/baidu-engine.ts` → BMapInstance 增 getPanes 类型面;
  repositionContentMarkerDom 值未变不写;新增 onRaw/resumeMarkerPane/
  startCameraAnimSync/stopCameraAnimSync(含停摆守卫与无 rAF 兜底);
  ensureCameraListeners 增 zoomstart/movestart/animation_start/zoomend/moveend/
  animation_end 六组绑定;destroy 终止同步循环
- `server/tests/map-engine-baidu.test.mjs` → FakeMap 增 getPanes mock 面;
  ensureFakeMapProjection 自愈守卫(r5 测试删除共享 FakeMap 原型方法的残留);
  新增 4 条 ws-l 单测(pane 恢复 / rAF 按帧重算+停摆自终止 / 无 rAF 同步收敛 /
  destroy 终止)
- `tech/23-map-engines.md` → 仅追加 ws-l 回填(闪烁机制 + 二分 + 修复 + 验收)

## 门禁结果

- npm test: **1467 通过 / 0 失败 / 2 skip**(含新增 4 条,总测试数 1463→1467)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- 临时暴露 map 实例/禁用校准的调试改动曾被权限分类器拦截提示 → 已全部还原,
  最终 diff 仅含上述 3 个文件的正式改动;map-markers.ts 零改动(二分第 2 步因此
  改为源码级判定,报告已如实标注);
- 既有 r5 测试「无 pointToOverlayPixelIn」会删除共享 FakeMap 原型方法、对后续
  测试残留 → 新测试加 ensureFakeMapProjection 自愈守卫(不依赖执行序)。

## 证据

- 修复前 pane 消失帧序列:`/tmp/ws-l/ev-instr3-disc.json`、`/tmp/ws-l/pane.json`
  (t=751ms visible=0 pane=none 等,每滚轮步)
- 修复后帧序列分析:`/tmp/ws-l/accept-final.json`(243 帧,min tracked=60,
  0 往返 snap,console 0 error);`/tmp/ws-l/accept-fix.json`(同上,72 帧截图)
- 截图:`.playwright-mcp/ws-l-accept-final/f00..f71.png`(72 帧 60ms 间隔)、
  `ws-l-accept-fix/f00..f71.png`、`ws-l-midanim/m1..m5.png`(滚轮后 +80/+160/
  +260/+400ms/稳定)、`ws-l-probe.png`、`ws-l-after-prezoom.png`
- 轨迹连续证据:`/tmp/ws-l/data-fix-rapid.json`(marker 逐帧位置单调,0 折返)
- SDK 源码证据:`/tmp/ws-l/getscript.js`(zoomstart/movestart/animation_start →
  C 处理器隐藏 pane;`_checkFireZoomend` 150ms 防抖;`_zoomingOrMoving` 期间
  a8.draw 跳过 Marker draw)

门禁: PASSED
结论: OK
