# fix-tencent-markers 汇报(2026-08-21)

WS:腾讯引擎 createMarker 崩溃修复(v=1.exp 全局 TMap 无单点 Marker → MultiMarker 聚合适配)。
worktree `/Users/acccan/dm-wt-eng-fix4`,分支 `fix/map-engine-tencent-markers`,基 `7c7acec` 全新建,无遗留。

## SDK 核实记录(真实源码,非猜测)

本轮重新下载真实 SDK(`https://map.qq.com/api/gljs?v=1.exp`,webpack bundle,版本 **v1.8.0.2**,2222398 字节),已留存到批次 logs 供后续轮次复用:
`tech/roles/development/parallel-sessions/20260821-boss-map-engine/logs/tmap-gljs-v1.8.0.2.js`。核实结论(均从 minified 源码逐条提取):

1. **全局命名空间导出表**(`Yd={Map:...,LatLng:...,Point:...,LatLngBounds:...,Event:...,GradientColor:...,GeometryOverlay:...,MultiMarker:...,MarkerStyle:...,MultiPolygon:...,PolygonStyle:...,MultiCircle:...,CircleStyle:...,MultiRectangle:...,MultiLabel:...,LabelStyle:...,InfoWindow:...,DOMOverlay:...,MarkerCluster:...,constants:{...}}`)——**无 `Marker`、无 `Circle`**。用户实机 `typeof TMap?.Marker === 'undefined'` 与推断成立;`MultiMarker`/`MarkerStyle` 均为构造函数。
2. **MultiMarker 构造**(`hf` factory,extends GeometryOverlay):options `{ map, geometries, styles?, zIndex?, id?, minZoom?, maxZoom?, geometryProcessMode?, disableInteractive?, isStopPropagation?, enableCollision?, collisionOptions? }`;`zIndex` 构造存 `e.zIndex>=0?e.zIndex:0`,并经 `setZIndex → rank=un(level,zIndex)` 驱动图层排序(越大越靠上)。
3. **geometry 校验**(`_checkGeometries`):`{ id?, position: LatLng(instanceof 校验), styleId?(缺省被改写为 "default"), content?(仅 string 文本标签), markerAnimation?, rank? }`;id 缺失 SDK 自动 uniqueId;position 非 LatLng 只 console.error 不抛。
4. **MarkerStyle**(module 80844):`{ src(图片 URL/dataURI,必填,缺省默认 pin 图), width, height, anchor: Point, rotate, opacity, faceTo, enableRelativeScale, relativeScaleOptions, color, strokeColor, strokeWidth, size, direction, offset(渲染器不消费), wrapOptions, background* }`——**仅图片 src,无 HTML content 选项**;anchor 校验 duck-typed(`'x' in t && 'y' in t && isNumber`),`new TMap.Point(x,y)`(module 24974)即合法。
5. **渲染偏移公式**:`imageTopLeft = 屏幕位 - style.anchor`(四角计算逐字核实);默认样式 34x50、anchor 默认 `(width/2, height)=(17,50)`。`style.offset` 在渲染管线中**零消费**(icon 配置硬编码 `offset:{x:0,y:0}`)→ anchor 是唯一像素偏移机制。
6. **方法面**:`setMap(map|null)`(官方加入/移除,`setMap(null)` → `_removeLayer()+map=null`)、`getMap`、`setGeometries`、`updateGeometries(geos[,opts])`(**按 id 整体替换 raw geometry**——部分对象会丢 styleId,必须携带)、`add(geos)`(按 id 去重)、`remove(ids)`(按 id 字符串)、`getGeometryById`、`setStyles`;**无 `updateGeometry`(单数)**——用复数。
7. **事件**:继承 EventEmitter(`setMaxListeners(500)`),公共 `on/off/emit`;点击经 `_emitGeoEvent → emit('click', { ...mapEvent, geometry, type, target })` → **`e.geometry.id` 可用**(逐字核实 `_bindBubbleHandler`/`_emitGeoEvent`)。
8. **geometry.content**:仅 GL 文本标签(`showGeometryContent/hideGeometryContent` 注释原文「控制文本显隐」)——传 HTML 会渲染成字面标签文本,不是 DOM。

## 实际改动

### 1. `server/src/lib/map-engine/tencent/tencent-engine.ts`(仅 createMarker 及构造器解析 helper + 头注释/常量)

- `createMarker` 重构为**构造器多路径分派**:
  1. `typeof this.tmap.Marker === 'function'` → 单点路径(原实现原样抽为 `createSingleMarker`,零行为变化)
  2. `typeof this.tmap.MultiMarker === 'function'` → 新 `createMultiMarker` 聚合路径
  3. 两者皆无 → `console.error('[map-engine] TMap 无 Marker/MultiMarker,命名空间:', Object.keys(this.tmap || {}))` + throw(保留 addMarker 簿记语义)
- `createMultiMarker`(每 marker 独立 MultiMarker 实例,单 geometry,简单正确优先):
  - 构造 `new tmap.MultiMarker({ map, geometries:[{ id: 'dm-mk-N', position: LatLng, styleId: 'default' }], zIndex: opts.zIndex ?? 10 })`;id 用 view 内递增序列(私有字段 `multiMarkerSeq`)
  - 保留**活 geometry 引用**:`setPosition` 原地改 `geometry.position` 后 `updateGeometries([geometry])`(规避 SDK「整体替换」丢 styleId 的坑)
  - 契约 `offset [x,y]`(相对锚点屏幕位移)→ `MarkerStyle.anchor = new TMap.Point(17 - x, 50 - y)`(默认锚点 (17,50) 平移;公式 `imageTopLeft = 屏幕位 - anchor` ⇒ Δanchor=-(x,y) 即整图位移 (x,y);常量 `TENCENT_DEFAULT_MARKER_ANCHOR`)
  - `setContent(html)` → **降级**:忽略 + `console.warn('[map-engine] TMap MultiMarker 不支持 HTML content,徽章降级为默认点')` 一次性(私有字段 `multiContentWarned`;构造期 content 与后续 setContent 合计只告警一次)
  - `onClick` → `mm.on('click', e => { if (e?.geometry?.id === id) cb() })`(SDK 事件载荷核实)
  - `remove()` → `mm.setMap(null)`(官方移除方式,与单点一致)
  - 构造失败同单点语义:`console.error('[map-engine] TMap MultiMarker 创建失败', err)` + rethrow
- 头注释 Marker 条目更新为核实事实(v=1.exp 无 Marker;MultiMarker 形态);新增 `TENCENT_DEFAULT_MARKER_ANCHOR` 常量。

### 2. `server/tests/fixtures/engine-mock.mjs`(+1 类)

- 新增 `MockMultiMarker`(忠实 v=1.exp 形态:构造 `{map, geometries, styles, zIndex}`、`updateGeometries` 按 id 更新(同引用替换)、`setGeometries/add/remove/getGeometryById/setMap/getMap/on/off/trigger`)。共享 fixture 只增不改,amap/baidu 测试零影响。

### 3. `server/tests/map-engine-tencent.test.mjs`(+5 用例 + 双面补 Point/MarkerStyle)

- `installTMapDouble` 补 `ns.Point`(x/y)、`ns.MarkerStyle`(opts 记录)——忠实真实 TMap 形状。
- 新增:
  1. **仅 MultiMarker(无 Marker)→ 聚合路径**:`delete ns.Marker; ns.MultiMarker = MockMultiMarker`;断言 `instanceof MockMultiMarker`、geometry `id /^dm-mk-\d+$/`、position LatLng 纬度在前、styleId 'default'、`map === view.raw`、zIndex 透传、offset [4,-6] → anchor (13,56)(`ns.Point` 实例 + `MarkerStyle` 注入)
  2. **setPosition → updateGeometries 同 geometry 引用(保留 styleId)+ remove → setMap(null)**
  3. **onClick 按 `e.geometry.id` 过滤**:其他 id 不触发、本 id 触发、可重复触发
  4. **HTML content 降级一次性 warn**:构造 content + setContent 合计 1 次 warn;content 不写入 geometry
  5. **Marker/MultiMarker 皆无 → console.error 命名空间诊断(keys 数组)+ throw**
- 原有单点路径 3 用例(构造/无 content 默认 zIndex/构造失败 rethrow)零改动保持绿。

## 门禁结果

- npm test:**1033 通过(1031 pass / 2 skip / 0 fail)**——全量零漂移 + 新增 5 用例(tencent 文件 35/35)
- typecheck:通过(tsc --noEmit 无输出)
- **make docs-check:失败(基线与 dev 均红,非本 WS 引入,详见下)**
- git diff --check:通过(无空白错误)

## 遇到的问题

1. **`make docs-check` 基线即红(非本 WS 引入)**:失败唯一来源是 `tech/roles/development/parallel-sessions/20260821-boss-agent-thinkfix/merge-report.md:20`——thinkfix 批次把「复述 grep 正则本身(`docs/roles/` 等)」写进 merge-report 造成自匹配;该文件由 `36ffa02`(thinkfix 批次入库)进入 dev,`git grep` 在 **HEAD 基线上即可复现**。本 WS 改动**零 `.md` 文件**;排除 `parallel-sessions/` 目录后全仓等价 grep **零匹配**。**需 boss 裁决**:修该行(thinkfix 批次的 merge-report)或给 docs-check 加 `--exclude-dir=parallel-sessions`(会话产物不入库的既定约定)。
2. **`createCircle` 同样会在 v=1.exp 下崩溃(范围外,deferred)**:核实导出表**无 `Circle`**(只有 `MultiCircle` + `CircleStyle`),当前 `new this.tmap.Circle(...)` 在真实全局版必抛。属 createMarker 范围外,按文件边界未动,请 boss 决定是否派独立 WS(参照本 WS 的 MultiCircle 适配)。
3. **距离手柄/徽章 HTML 降级**:map-shell 距离手柄 marker、map-markers 招聘/聚合徽章均传 HTML content → 腾讯引擎下降级为默认 pin 点 + 一次性 warn(界面可见性:POI 点位仍全渲染,仅徽章样式缺失)。已按预案记 deferred,由 boss 决定是否跟进(如 dataURI 图片徽章方案)。

## 证据

- SDK 核实源文件:已留存 `parallel-sessions/20260821-boss-map-engine/logs/tmap-gljs-v1.8.0.2.js`(2.2MB,真实 `map.qq.com/api/gljs?v=1.exp` 下载);关键结论逐条出处见上「SDK 核实记录」。
- 改动文件仅 3 个:`tencent-engine.ts`(+100/-2)、`engine-mock.mjs`(+71)、`map-engine-tencent.test.mjs`(+155/-3)。
- `node --test tests/map-engine-tencent.test.mjs` → 35 pass / 0 fail;全量 `npm test` → tests 1033, pass 1031, fail 0, skipped 2。
- docs-check 基线复现:`git grep -n -E 'docs/roles/|docs/zh-cn/' HEAD -- '*.md'` → 仅 thinkfix merge-report.md:20。

## commit 列表(worktree 分支 fix/map-engine-tencent-markers,未 merge 未 push)

1. `e686d92 fix(tencent-engine): createMarker 构造器多路径——无 Marker 时走 MultiMarker 聚合标注`
2. `38373d0 test(tencent-engine): MultiMarker 路径用例——构造/委托/事件过滤/降级/双无诊断`

门禁: FAILED
结论: OK
