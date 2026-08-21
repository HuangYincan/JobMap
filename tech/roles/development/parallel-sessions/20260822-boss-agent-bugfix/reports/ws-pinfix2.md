# ws-pinfix2 汇报(2026-08-22)

## 实际改动

worktree `/Users/acccan/dm-wt-agent-pinfix2`(分支 `fix/engine-content-overlay`,基座 `df4b26d`),4 个 commit(+1057/−51),只动 4 个文件:

1. `server/src/lib/map-engine/baidu/baidu-engine.ts`(commit 18073cf + 77c239d 内 1 处补丁)
   - `createMarker` 分派:content 存在 → `createContentMarker`(DOM overlay);无 content → `createPlainMarker`(原逻辑抽出,行为零改动)。
   - `createContentMarker`:content 走 **BMapGL 自定义 Overlay**(继承 `BMapGL.Overlay`):
     - `initialize(map)` 建 div,content 原文注入 innerHTML(可信 HTML 契约,与 amap 同语义),zIndex → style.zIndex,click 绑 div(内容子元素冒泡可达)+ stopPropagation(不触发地图 click,与 amap marker click 同语义);返回 div(SDK 自动挂覆盖物容器);
     - `draw()` 用 `pointToOverlayPixel`(缺省回退 `pointToContainerPixel`,bd09 点)→ div 左上角 = 容器像素 − 契约 offset(锚定一致性:agent 蓝点 offset [−10,−10] → 圆心对准坐标,与 amap 语义一致);SDK 相机变化自动重调 draw,无需自绑事件;
     - `remove()` 幂等:removeOverlay + div 摘除 + click 解绑;raw 带 `setMap(null)`/`remove` 供 map-shell 摘除分派;
     - content+icon 并存 → content 为渲染主机制,icon 不参与(防双渲染;HTML 自包含);icon 路径仅无 content 场景;
     - 防御守卫:SDK 无 Overlay / 无 DOM → `createContentFallbackMarker`(旧 setContent + 透明 1×1 锚点图标路径,不抛错);定位 API 缺失 → draw 跳过 + 一次性 warn。
   - `createPlainMarker`/`resolveIconUsable`/`createContentFallbackMarker`:原 icon CORS 预检逻辑抽为 `resolveIconUsable`,语义与旧实现逐字一致。
2. `server/src/lib/map-engine/tencent/tencent-engine.ts`(commit f2e4f60 + 82f5c48 内 1 处补丁)
   - `createMarker` 分派:content 存在 → `createContentOverlay`;无 content → 原单点/MultiMarker 多路径(行为零改动)。
   - `createContentOverlay`:content 走 **容器内 DOM 覆盖物**(项目实证机制:自绘比例尺 ensureFallbackScale 同路径,appendChild 到 `getContainer()`):
     - 定位 `lngLatToContainerPoint(lngLat)` → 容器像素 − 契约 offset;content 原样注入 innerHTML;click 绑 div + stopPropagation;zIndex/cursor 透传;
     - 相机变化重定位**双通道**:地图事件懒注册一次(zoom/drag/dragend/idle,兜底用户交互)+ 视图相机方法(setCenter/setZoom/setPitch/setRotation/setBounds/flyTo 末尾 `redrawContentOverlays()`,兜底程序化相机);
     - 移除 = div 摘除 + 注册表清理;`destroy()` 统一清理残留 div(防 DOM 泄漏);raw 带 `setMap(null)`/`getMap()`/`remove` 供 badgeCleanupHandle/map-shell 分派;
     - content+icon 并存 → content 为渲染主机制,icon 不参与(防双渲染);
     - 防御守卫:无 DOM/容器 → `createContentFallback`(单点 Marker 原生 content / MultiMarker icon 化降级 + 一次性 warn,不抛错)。
   - 补:两引擎 overlay click 分发遗漏的 `opts.onClick` 注册。
3. `server/tests/map-engine-baidu.test.mjs`(+276):fake DOM + `FakeOverlay` 基类 + `pointToOverlayPixel` 双面;6 个新测试(主路径构造/定位/移除、锚定一致性四形态、setMap/remove 分派、无 Overlay 回退、无定位 API 降级 warn、content+icon 不双渲染不预检)。既有测试(无 DOM → 回退路径)零改动全绿。
4. `server/tests/map-engine-tencent.test.mjs`(+302):fake DOM/容器 + `lngLatToContainerPoint` 双面;6 个新测试(主路径渲染/契约方法、锚定一致性、content+icon 不产生 geometry、相机重定位双通道、remove/setMap/destroy 摘除、无 DOM 回退降级)。既有测试零改动全绿。

## SDK 证据复核

- 百度:prompt 所述 `raw.setContent?.(opts.content)` 空操作结论与仓库既有 SDK 源码核实注释一致(ws-6/ws-7 已实证 getscript v1.0 为当前唯一真实入口);本 WS 未再抓取 SDK,依据 prompt 既有证据。BMapGL 自定义 Overlay 的 initialize/draw 生命周期与 `pointToOverlayPixel` 为官方文档 API(已在代码注释标注)。
- 腾讯:MultiMarker 无 HTML 渲染、`resolveMultiStyle` 生成无 src/width/height 的 MarkerStyle 被 GL 拒绝——与仓库既有 SDK v1.8.0.2 源码核实注释(ws-a/ws-6)一致;DOM overlay 采用**本项目实证可用机制**(自绘比例尺同路径,生产坐实)。
- 两个引擎的 `lngLatToContainerPoint`(腾讯官方命名)/ `pointToOverlayPixel`(百度官方命名)定位 + 「左上角 − offset 元组」锚定一致,agent 蓝点 offset [−10,−10] → 圆心对准坐标。

## 门禁结果

- npm test:**1384 通过 / 2 失败 / 2 skip**(1388 total)
  - 2 个失败为**基座 df4b26d 既有**(改动前在干净 worktree 上先跑过基线:1376 tests / 1372 pass / 2 fail,同 2 个失败),与本 WS 无关:
    1. `drops-coordinate-consistency.test.mjs` — 蔚来-site-绍兴 坐标落在杭州参考框(geocode r4 数据清扫回归,错误信息自述需重跑 `fix-sweep-accident-coords.mjs`);
    2. `split-city-sites.test.mjs` — qqj 临界点测试期望占位坐标 vs 真实 geocode 坐标(数据 fixture 与 r4 坐标修正不同步)。
  - 本 WS 新增 12 个测试全部通过,零回归(基线 1372 → 1384)。
- typecheck:通过
- docs-check:通过(make docs-check —— 未碰任何 markdown,红线遵守)
- git diff --check:通过

## 遇到的问题

1. 两处引擎实现最初漏注册 `opts.onClick` 到 overlay click 分发(clickHandlers 未 push)→ 新测试捕获,已补。
2. 新测试 `content+icon` 断言 icon-only 路径时未先预检远程 URL → 走默认图钉而非 FakeIcon;修正为先 `preflightRemoteIcon` + settle 再断言(与既有 ws-e 测试同款模式)。
3. **需 boss 裁决(预存在,非本 WS)**:`npm test` 的 2 个数据 fixture 失败位于基座 commit(geocode r4 坐标修正 `3e6deb3` 与测试期望脱节),建议派数据 WS(`fix-sweep-accident-coords.mjs` 重跑 + 更新 qqj 临界点期望坐标)修复后本批门禁即全绿。
4. 设计说明(已在代码注释):content+icon 并存时引擎层以 content 为渲染主机制、icon 不参与——避免徽章双渲染;map-markers 的 TMap icon 门控逻辑未动(红线),其传参仍被接受,只是 content 存在时视觉由 HTML 徽章承载(HTML 自包含 logo img + 回退链,视觉与 icon 徽章一致)。

## 证据

- 基线(改动前):`npm test` 1376 tests / 1372 pass / 2 fail / 2 skip(同 2 个数据失败)。
- 终态:`npm test` 1388 tests / 1384 pass / 2 fail / 2 skip(仅数据 fixture 2 个预存在失败)。
- typecheck / docs-check / git diff --check 全通过。
- commit 序列:`18073cf`(baidu 引擎)→ `f2e4f60`(tencent 引擎)→ `77c239d`(baidu 测试+onClick 补丁)→ `82f5c48`(tencent 测试+onClick 补丁);未 push、未 merge、未切分支。

门禁: FAILED
结论: OK(2 个 npm test 失败为基座 df4b26d 既有数据 fixture 问题,与本 WS 改动无关;需 boss 派数据 WS 修复)
