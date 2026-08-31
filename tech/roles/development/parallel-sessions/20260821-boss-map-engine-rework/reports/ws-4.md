# ws-4 汇报(2026-08-21)

分支 `feature/engine-zindex`(worktree `/Users/acccan/dm-wt-rw4`,基线 527e631),5 个小步 commit,零 merge/零 push,「不碰」文件零改动。

## 实际改动

- `server/src/components/map-shell.module.css`
  - `.mapCanvas` 追加 `z-index: 0; isolation: isolate;` → 构成独立 stacking context
  - 新增厂商专有隐藏 CSS(对齐既有 `.amap-copyright/.amap-logo` 模式):TMap `tencent-map-ctrl-zoom/rotate/copyright` + `tencent-map-copyright`;BMapGL `.BMap_cpyCtrl/.BMap_omView/.BMap_zoomCtrl`。刻意**不**含 `tencent-map-ctrl-scale` / `.BMap_scaleCtrl`——那是引擎 `addControl('scale')` 自建的比例尺,防误伤 UI
- `server/src/lib/map-engine/tencent/tencent-engine.ts`
  - `createView` 时序修复:`await waitForMapReady(raw)` 与 `disableDefaultControls(raw)` **顺序对调**(先等就绪,再摘控件)
  - `hideControlDom` 覆盖面补:canvas 与 marker/overlay 面板层(`tencent-map-pane/marker/overlay/canvas` 子串 + 裸 `canvas`)统一 `pointer-events: none`;版权保留可见(仅解除点击拦截)
  - `TENCENT_MAP_READY_TIMEOUT_MS`:**3s → 1.5s**(idle 不触发/瓦片失败时切换冻结减半,仍保留兜底)
- `server/src/lib/map-engine/baidu/baidu-engine.ts`
  - 新增 `hideBaiduDefaultControls(map)`:createView 构造后立即 DOM 隐藏 `.BMap_omView`(3D 指北针,z-index 1000 量级)+ `.BMap_zoomCtrl`(左上默认缩放);有/无 `getContainer`/`querySelectorAll`、DOM 探测抛错均静默不炸
  - `BMapInstance` 接口补 `getContainer?()`
- 测试:`server/tests/map-engine-tencent.test.mjs`(+3 新用例、DOM 兜底用例扩展)、`server/tests/map-engine-baidu.test.mjs`(+2 新用例)、`server/tests/component-contracts.test.mjs`(+1 mapCanvas 契约)

## 层级方案说明(containing block 原理简述)

`.shell` 原有 `isolation: isolate`,但其子级 `.mapCanvas` 无 z-index、不构成 stacking context → 厂商内部高 z-index 层(TMap 控件/覆盖物面板、BMapGL `.BMap_omView` 1000 量级)直接参与 **shell 全局**层叠竞争,盖过 sidebar(5)/topTools(5)/mapControls(10)/AgentBall(11)。给 `.mapCanvas` 加 `z-index: 0`(position:absolute 时显式 z-index 即触发 stacking context)+ `isolation: isolate`(双保险)后,厂商内部层被困在 mapCanvas 自己的层叠上下文内,**只能与容器内其他子层竞争**;shell 层所有 UI(sidebar 5 / topTools 5 / mapControls 10 / AgentBall 11 / offlineBanner 12 / skipLink 40)恒在 mapCanvas(0)之上——「原组件点不了」根治。UI 层 z-index 相对关系未动,仅新增 mapCanvas 这一更低基座。

## TMap 时序修复

诊断坐实:原 `disableDefaultControls(raw)` 在 `waitForMapReady(raw)` **之前**执行,而 `new TMap.Map()` 立即返回、控件 DOM 异步才建立 → `getControl`/`hideControlDom` 扫空 DOM 全部空转。修复后顺序为:构造(showControl:false)→ `waitForMapReady`(idle/ready 事件或 1.5s 超时)→ `disableDefaultControls`(getControl+removeControl 摘 zoom/scale、setShowControl(false) 防重建、hideControlDom DOM 兜底)。注意:map-shell 的 `addControl('scale')` 在 createView 返回后调用,不受此时 hideControlDom 的 `[class*="scale"]` 影响。

## Baidu 控件防御

BMapGL 无「构造选项禁用默认控件」形态、默认控件实例无法经 removeControl 摘除(那是 addControl 自建实例的反向)→ 构造后防御式 DOM 隐藏(`.BMap_omView` + `.BMap_zoomCtrl`,display:none + pointer-events:none)。版权 `.BMap_cpyCtrl` 由 CSS 隐藏(与 AMap 同款处理);`.BMap_scaleCtrl`(自建比例尺)不在隐藏列。

## CSS 类名核实记录

本环境无网/无 key,无法抓真实厂商 DOM 实测;类名以 SDK 源码记忆 + 宽泛子串选择器防御:
- TMap GL:`tencent-map-ctrl-{zoom,scale,rotate,copyright}`(控件容器)、`tencent-map-copyright`(独立版权)、`tencent-map-pane` 系(canvas/marker/overlay 面板)。引擎侧 hideControlDom 原有 `[class*="control"/"zoom"/"scale"/"rotate"]` 选择器即基于此类名,保持一致
- BMapGL:`.BMap_omView`(任务书点名,z-index 1000)、`.BMap_zoomCtrl`、`.BMap_cpyCtrl`(任务书点名)
- 选择器全部作用域 `.mapCanvas` 内(`:global()`),vendor 内部类名与 app UI 类名无交集,误伤面为引擎自建比例尺——已刻意排除(见上)
- **需 boss 裁决/浏览器实测复核**:canvas/marker 面板 `pointer-events: none` 的假设是「TMap GL 事件/命中检测绑定在 container 元素」;若实测 MultiMarker 点击失效,回退为只对 `tencent-map-pane`(不含 canvas 本体)做 pointer-events:none

## 测试用例

- tencent 新增:
  - `控件防御时序——先等就绪再摘除默认控件`:ManualReadyMap(不自动 idle),断言 ready 前 removeControl/setShowControl/DOM 扫描零调用 → 手动触发 idle 后摘除 zoom/scale、setShowControl 一次、DOM 兜底执行、监听解绑
  - `idle 永不触发 → 1.5s 超时兜底放行`:mock.timers,tick(1400) 仍挂起,tick(150) 放行
  - DOM 兜底用例扩展:忠实 TMap 类名(tencent-map-ctrl-zoom/copyright/canvas/marker),断言 canvas/marker 面板 `pointer-events: none` 且 `display` 不动、版权保留可见
- baidu 新增:`createView:BMapGL 默认控件 DOM 防御——zoom/omView 隐藏,版权/比例尺不误伤`;`无控件 DOM/querySelectorAll 抛错均不炸`
- component-contracts 追加:`mapCanvas 层级隔离契约(z-index:0 + isolation:isolate + 厂商版权隐藏 + UI 层叠相对关系审计)`

## 门禁结果

- npm test:**1073 通过 / 0 失败**(2 skip;基线 1034 零漂移 + 39 新增)
- typecheck:通过(tsc --noEmit 零错误)
- git diff --check:通过
- make docs-check:**基线红(非本批)**——仅两处历史自匹配告警:`parallel-sessions/20260821-boss-agent-thinkfix/merge-report.md:20` 与 `20260821-boss-tencent-geocode/merge-report.md:17`(后者即说明前者早已并入 dev);本批零 `.md`/`tech/` 改动,无新增告警

## 遇到的问题

1. **mock.timers 测试挂起污染全文件** → 新写的「1.5s 超时」测试 `await p` 永久挂起(createView 头部是 `await load()` 异步链,1500ms 定时器在微任务排空后才创建,同步 `tick()` 落在定时器创建之前空转);且 node:test 超时中断导致 finally 不执行、mock 定时器残留,后续每个 createView 等 25s 超时。修复:先 `await setImmediate` 排空微任务再 tick;`mock.timers.reset()` 提到最外层 finally(断言失败也不污染)。已单独 commit(`fix(test)`)并全量复跑绿
2. **docs-check 基线红** → 与 ws-4 无关(两个历史 merge-report 的自匹配,本批零 .md 改动);建议 boss 派 docs 修复批次或给 docs-check 加 `--exclude-dir=parallel-sessions`
3. **TMap/BMapGL DOM 类名无法本环境实测**(无网/无 key)→ 用 SDK 源码记忆 + 宽泛子串选择器,并在汇报中记录假设与回退方案(见「CSS 类名核实记录」)

## 证据

- commit:`8630487`(CSS 隔离)→ `bd3e42f`(tencent 时序)→ `921b955`(baidu 防御)→ `587c137`(测试)→ `8a223d6`(mock.timers 修复)
- `npm test` 摘要:`tests 1073 / pass 1071 / fail 0 / skipped 2`
- 定向跑:tencent 44 pass(~520ms)、baidu+contracts 94 pass(~110ms)
- 边界核对:`git diff 527e631..HEAD --name-only` 恰为允许清单 6 文件,「不碰」零改动

门禁: PASSED
结论: OK
