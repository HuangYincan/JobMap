# ws-a 汇报(2026-08-22)

分支 `fix/tmap-poi-interaction`(worktree `/Users/acccan/dm-wt-ia`,基线 cda385f)。任务:bug 1(TMap POI 点击失效 + 缩放偏移)—— anchor 正确化 + 点击拾取修复。

## 实际改动

- `server/src/lib/map-engine/tencent/tencent-engine.ts`(仅 marker/MultiMarker/anchor/click 段;ws-b 相机/构造段零触碰)
  - **SDK v1.8.0.2 实包源码核实(2.2MB 全包下载自 map.qq.com/api/gljs?v=1.exp,存 /tmp/tmap-sdk.js)**:
    - MarkerStyle 构造 `{iconUrl, iconSize:[w||34, h||50], iconAnchor:[anchor?.x||17, anchor?.y||50]}` —— **默认 anchor 是常量 (17,50),不随 width/height 归一化**:自定义尺寸图标(60×60 徽章)不显式传 anchor 即锚点错位 → 缩放视觉漂移 + 点击命中区与视觉不一致(boss 调查线索坐实;engine 侧既有公式核实正确,零改动);
    - 锚点渲染公式双路径同语义:DOM 2d-adapter `marginLeft/Top = -anchor`;GL 实例 `instanceInfos.xy = (width/2-anchor.x, height/2-anchor.y)` → imageTopLeft = 屏幕位 - anchor;
    - 像素偏移不随 zoom 缩放(不漂移):着色器 `relativeZoomScale = mix(1.0, calZoomScale(uZoom, y), instanceRelativeScale.x)` 且 `enableRelativeScale` 默认关闭(instanceRelativeScale.x=0)→ scale=1;
    - click 链路:每 geometry 一个 DOM 拾取元素(Leaflet 式 marker,`setGeometryId` 标记)→ 元素事件 → `_fireGeometryOverlayEvent` → `_idSet` 查 `_geometryId` → `e.geometry` → 契约 cb 按 `e.geometry.id` 过滤;`remove(ids)` 全量删 `_idSet`/`_idGeoIndexSet` + 摘除 DOM 拾取元素 → 摘挂后重 add 同 id 不冲突;
    - **updateGeometries 对不在 `_idSet` 的 id 会重新 add**(SDK 侧根因,见下)。
  - **anchor 纯函数化**:新增导出 `resolveTMapMarkerAnchor(iconW, iconH, offset)` —— 无 offset = (w/2, h) 底部中心(与高德 content 锚点语义对齐),契约 offset 经 Δanchor = -(x,y) 合并(AMap 同位移语义);`resolveMultiStyle` 改调该函数;文件头与常量注释回填 SDK 核实结论。
  - **LOD 摘挂状态一致性修复**(拾取/可见性失效根因之一):`setPosition` 仅挂载态(multiAttached)调 updateGeometries —— 旧实现隐藏期 setPosition 会把 LOD 摘除的 geometry 重新挂回图层(隐藏变可见 + 可点);隐藏期只原地改共享 geometry 对象,重新挂载时自然带新位置;`setVisible` 在 remove 后(geometry 已注销)置空 no-op 防僵尸重挂。
  - **click 绑定簿记数组化**:`multiClickHandlers`(Map<cb, entry>)→ `multiClickBindings`(数组)——同一 cb 注册到多个 marker 时旧实现后注册覆盖先注册,off/remove 解绑错位;数组按 (cb, id) 精确解绑 + 同 (cb, id) 重复注册去重(防双触发)。
- `server/tests/map-engine-tencent.test.mjs`(+5,53→58)
  - `resolveTMapMarkerAnchor` 纯函数断言:60×60→(30,60) 底部中心、offset 位移合并(40/54 徽章 → (40,60)/(54,81),与既有归组断言同源)、34×50→(17,50) 默认常量对齐、60×60 不得落回常量(原 bug 回归);
  - 缩放一致性(纯函数级):任意 zoom 下 imageTopLeft = 屏幕位 - anchor → 锚点恒钉地理点(2 级缩放前后不漂移);
  - LOD 摘挂后 click 分发不失效:隐藏 → 隐藏期 setPosition 不重挂 → 显示后同 id 命中恢复(handler 跨摘挂存活,同 id 同 geometry 引用无冲突);
  - 同一 cb 注册到两个 marker → off/remove 按 id 精确解绑;remove 后 setVisible no-op。
- `tech/23-map-engines.md`(仅追加 ws-a 节):SDK 源码核实结论 + 三段修复 + 验收表 + 遗留。

## 门禁结果

- npm test:1259 通过 / 0 失败 / 2 skip(基线 1212 + 新增 5;58/58 tencent)
- typecheck:通过
- make docs-check:通过;git diff --check:通过

## 遇到的问题

1. **boss 任务书描述的 anchor 缺陷在基线上已部分修复**(前批 tmap-polish 已把 anchor 改为按 icon 尺寸计算,公式核实正确)。本轮 SDK 源码核实坐实:默认 anchor 常量 (17,50) 不随尺寸归一化 —— 现有显式传 anchor 的做法是唯一正确路径,零公式改动,补纯函数化 + 测试 + 文档。
2. **真机「点击无响应」的 SDK 侧机制**:MultiMarker 点击走每 geometry 的 DOM 拾取元素(非 GL raycast)—— 摘挂状态一致性与绑定簿记是引擎侧可控的失效源,本轮修复;物理点击命中区 == 视觉图标框(anchor 一致)→ 锚点正确化同时修复「点击命中区 ≠ 视觉位置」。
3. **mock 无拾取层**:「隐藏 marker 物理点击不应命中」是 SDK 侧行为(geometry 不在图层 + DOM 拾取元素已摘除),mock 无法模拟,测试只断言引擎侧状态(不重挂/不复活),已在测试注释与 tech/23 说明。
4. 一处 mock 数组顺序差异(remove 后 re-add 的 geometry 在数组尾部)导致的断言修正,已随测试提交。

## 证据

- `cd /Users/acccan/dm-wt-ia/server && node --test tests/map-engine-tencent.test.mjs` → 58 pass / 0 fail
- 全量 `npm test` → 1259 pass / 2 skip / 0 fail;`npm run typecheck`、`make docs-check`、`git diff --check` 全绿
- SDK 源码核实产物:`/tmp/tmap-sdk.js`(v1.8.0.2,2.2MB;关键点:MarkerStyle 构造默认 anchor、Ct fill 的 instanceInfos 公式、着色器 relativeZoomScale、`_fireGeometryOverlayEvent`、`_getRealAdd`/remove 的 _idSet 语义、updateGeometries 缺失 id 重新 add)
- commits(3,均在 fix/tmap-poi-interaction,未 merge 未 push):
  - 78f1ae6 fix(tencent-engine): marker 段三修——anchor 按实际尺寸 + LOD 摘挂状态一致性 + click 绑定数组簿记
  - 6f2d2f3 test(map-engine-tencent): ws-a 追加 5 用例
  - e2e292f docs(tech/23): 回填 ws-a

门禁: PASSED
结论: OK
