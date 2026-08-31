# ws-e 汇报(2026-08-22)

分支 `fix/baidu-round2`(worktree `/Users/acccan/dm-wt-br2`),基于 `17cb454`。
3 个 commit:`29eea4d`(引擎修复)、`b32c351`(测试)、`230ff5c`(docs)。

## 实际改动

- `server/src/lib/map-engine/baidu/baidu-engine.ts`
  - **bug 2 单点级 POI 不渲染根因实锤 + 修复**:真实 BMapGL v1.0 SDK 的 Marker
    **没有 setContent**(marker 模块 `marker_crvckn` 源码 0 命中 + 真机 Chromium
    坐实 `typeof BMapGL.Marker.prototype.setContent === 'undefined'`)——旧路径
    `raw.setContent?.(html)` 静默 no-op,zoom 17 DOM 0 个 `.dm-badge`、无视觉、
    无点击(与 boss 实测一致;ws-b 上轮「content 路径三环节正确」结论作废)。
    新增 `scheduleMarkerContentInjection`:无 setContent 时把 content HTML 注入
    厂商 marker 自带的 `BMap_Marker` 点击目标 DOM(markerMouseTarget pane,模块
    源码 `_addDom/_msTargetRender` 核实:GL 下恒创建、位置 = 屏幕位 + 契约
    offset(空白锚点图标 anchor=-offset 数学驱动)、子元素冒泡到 marker click;
    有界重试 20×50ms 等待模块加载回调后 DOM 就绪)。聚合徽章(content+icon 双传)
    走 icon 纹理路径,零介入;`BMarker` 接口补 `domElement?`;wrapper.setContent
    重入更新注入内容(选中/高亮状态切换)
  - **bug 1 深色+卫星组合**:whitesmoke 分支先 `setMapType(BMAP_NORMAL_MAP)`
    强制切回 vector,再 `setMapStyleV2({styleJson: 深色})`(深色自定义样式只对
    vector 底图生效,真机复测坐实;标准→深色同样先切,幂等)
  - **bug 5 蓝点 147px 判定:两路径坐标一致,引擎零改动**(见「遇到的问题」)
- `server/tests/map-engine-baidu.test.mjs`(+4,73→77,第 8 节追加)
  - 真实 SDK 形态(新增 `FakeNoContentMarker`,无 setContent + domElement):
    content 注入厂商 DOM、dm-badge 在 DOM、锚点数学不变(anchor=-offset)、
    冒泡点击可达;domElement 延迟就绪 → 有界重试注入;wrapper.setContent 重入
  - 深色+卫星:styleSeq 钉住「先 setMapType(normal) 后 styleV2」调用序
  - 蓝点两路径坐标一致性:setCenter 与 createMarker 同一 gcj02 → 厂商侧同一
    bd09 点(精确相等);无 offset → anchor (0,0) 契约钉住
- `tech/23-map-engines.md`(追加 `ws-e 回填` 一节,44 行,仅追加)

## 门禁结果

- npm test: **1397 通过 / 2 失败 / 2 skip**(1401 总数;2 失败为**基线既有**,
  见下;本 WS 测试文件 77/77 全绿)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

1. **2 个基线失败(非本 WS 回归,stash 验证在 base `17cb454` 同样失败)**:
   `split-city-sites.test.mjs`「qqj-临界点…拆分幂等」与
   `drops-coordinate-consistency.test.mjs`「无任何非杭州 drop 站点坐标落在杭州
   参考框内」——数据/geocode 域(上海徐汇 drop 站点 geocode 结果与期望差 ~0.03°),
   与本 WS 文件边界零交集(无共享代码路径)。需 boss 裁决是否另派数据 WS。
2. **bug 5 蓝点 147px 未复现(真机 Chromium + 真实 SDK,ak=test + 拦截 qt=verify
   返回 error:0 绕过 AK 自毁,瓦片 403 不影响 marker/相机/样式机制)**:
   `setCenter(gcj02 mock 120.1551,30.2741)` + `createMarker(同一 gcj02,蓝点
   icon 22×22 无 offset)` 全场景(平视/俯仰 45°+旋转 30°/动画中断/蓝点先建)
   → 蓝点 DOM 均**精确落在容器中心 (700,450)**,`map.getCenter()` 精确 =
   bd09(mock)(dlng≈1e-14)。相机与蓝点共用同一 gcj02→bd09 转换,按 boss 决策树
   (相机中心=mock 且蓝点=相机中心)→ 两路径一致,引擎无转换错误可修。147px
   疑似测量状态伪差:handleLocate 的 setCenter+setZoom 是 ~450ms 动画(panToIn→
   _panBy),中间帧截图蓝点即偏离未到的相机中心;或窗口中心≠容器中心帧。
   修复 = 一致性测试钉住 + 建议 boss 动画结束后用容器 boundingRect 复测。
   ⚠️ 附带发现:首次 centerAndZoom 有 ~40% 处中间帧采样(SDK 入场动画),与
   boss「中心区域 35% 变化」描述吻合,佐证中间帧测量假设。
3. 蓝点无契约 offset → anchor (0,0) 左上角(与 AMap/TMap 同款契约;TMap
   resolveTMapMarkerAnchor 同语义),不改——蓝点视觉中心相对点位偏 11px 为
   三引擎一致语义。

## 证据

- 真机复现/验收(harness:`/tmp/repro-baidu.html` + `/tmp/repro-baidu.py`,Chromium
  1400×900,截图 `/tmp/baidu-repro-shots/final.png`):
  - 复现:`marker_setContent_type = undefined`;修复前 `A_dom_dm_badge_count = 0`
    (DOM 仅 1 个空的 BMap_Marker 点击目标 div,1×1)
  - 修复后:`A_fix_dom_dm_badge_count = 1`、徽章 40×40 完整渲染(1px 父 div
    overflow 可见)、`A_fix_badge_clicked = 1`(真实 click 冒泡到 marker)
  - bug B:`B_sat_after_dark_mapType = B_SATELLITE_MAP`(不生效现场);修复序
    `B_fix_normal_then_dark_mapType = B_NORMAL_MAP`;config.style 均写入
  - bug C:`C_blue_dom = {left:700, top:450}`(容器中心);`C_map_center` 与
    bd09(mock) 差 ~1e-14;C2(俯仰45+旋转30)/C3(动画中断)/C4(蓝点先建)均
    (700,450);`C_blue_clicked_via_dom = 1`
- SDK 源码:`getscript?v=1.0` 本体 + `getmodules?mod=marker_crvckn` 抓取至
  /tmp;Marker(l4) 原型/构造 0 处 setContent/content;`b2.coordType=
  BMAP_COORD_BD09`(入参即 bd09,引擎 gcj02→bd09 边界转换正确);
  `bmapVerifyCbk` 在 error!==0 时把 b2/BMapGL 置 null(AK 自毁机制,顺带记录)
- 测试:`cd server && node --test tests/map-engine-baidu.test.mjs` 77 pass /
  0 fail;`npm test` 1397 pass / 2 fail(基线)/ 2 skip;`npm run typecheck` 零错误;
  `make docs-check` passed;`git diff --check` 干净
- git log:`29eea4d fix(baidu): 单点级 content 注入厂商 marker DOM 兜底 + 深色
  强制切回 vector(ws-e)` / `b32c351 test(baidu): ws-e 三项断言(+4,73→77)` /
  `230ff5c docs: tech/23 ws-e 回填(单点级根因实锤 + 深色卫星组合 + 蓝点判定)`

门禁: FAILED
结论: OK
