# Workstream 4 — feature/engine-zindex(层级隔离 + 控件防御 + TMap 超时)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-rw4`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-4.md`(末两行 token,见文末)。

## 背景(诊断坐实,根因 4/5)

- **vendor z-index 逃逸**:`.mapCanvas`(`map-shell.module.css:41-46`)无 z-index、不构成 stacking context;`.shell` 有 `isolation:isolate` → 厂商内部高 z-index 层(TMap 控件/覆盖物面板、BMapGL `.BMap_omView` z-index 1000 量级)直接参与全局竞争,盖过 sidebar(5)/topTools(5)/mapControls(10)/AgentBall(11)→「原组件点不了」。AMap 正常是因其内部 z-index 低 + 专有 CSS 隐藏。
- **TMap 控件防御时序错误**:`tencent-engine.ts:679-680` `disableDefaultControls(raw)` 在 `waitForMapReady(raw)` **之前**执行——`new TMap.Map()` 立即返回,控件 DOM 异步才建立,`getControl`/`hideControlDom` 扫空 DOM 全部空转;唯一生效的是构造项 `showControl:false`。且 `hideControlDom` 只覆盖 control/zoom/scale/rotate 类名,不处理 canvas 与 marker overlay 面板。
- **Baidu 零控件防御**:`baidu-engine.ts:659-673` createView 不禁默认控件(zoom 左上/版权右下)。
- **TMap idle 3s 超时**:`tencent-engine.ts:78` `TENCENT_MAP_READY_TIMEOUT_MS = 3000`;idle 不触发(瓦片失败/网络被拦)时每次切换冻结 3s,期间点击全丢 →「卡死」观感。

## 任务

### 1. 层级隔离(唯一彻底解)

`server/src/components/map-shell.module.css`:
- `.mapCanvas` 加 `z-index: 0; isolation: isolate;`(把厂商内部 z-index 困在容器内,不参与 shell 全局竞争)
- 加 TMap/BMapGL 专有隐藏 CSS(对齐既有 `.amap-copyright/amap-logo` 隐藏模式,48-55 行):腾讯版权/控件类名、百度版权 `.BMap_cpyCtrl` 等——以真实 DOM 类名核实(或宽泛选择器,谨慎不误伤 UI)
- 重审 UI 层叠:确认 sidebar/topTools/mapControls/AgentBall 等在新 stacking context 下仍然可见(z-index 相对关系不变即可)

### 2. TMap 控件防御时序修正(`server/src/lib/map-engine/tencent/tencent-engine.ts`)

- `disableDefaultControls` 与 `waitForMapReady` **顺序对调**:先等 ready,再禁用/隐藏控件(控件 DOM 已建立)
- ready 后**二次执行** hideControlDom(或把 disable 逻辑移入 ready 回调)
- `hideControlDom` 覆盖面补:canvas 与 marker overlay 面板层(`pointer-events: none` 处理;核实 TMap DOM 类名)
- `TENCENT_MAP_READY_TIMEOUT_MS`:3s → **1.5s**(卡顿减半;仍保留兜底),或加 `tilesloaded` 条件(核实 SDK 事件,不可靠则纯收紧)

### 3. Baidu 控件防御(`server/src/lib/map-engine/baidu/baidu-engine.ts`)

- createView 补默认控件禁用:zoom/scale 等(核实 BMapGL API:`map.disableDoubleClickZoom` 等是交互;控件如 `BMapGL.ScaleControl` 默认已带?核实默认控件与禁用方式;防御式:创建后移除/隐藏默认控件 DOM,类名 `.BMap_*` 核实)
- 版权 DOM 隐藏(与任务 1 的 CSS 配合)

### 4. 测试

- `server/tests/map-engine-tencent.test.mjs`:顺序断言(ready 后再 disable,以 mock 事件序列断言)、超时常量 1.5s 断言
- `server/tests/map-engine-baidu.test.mjs`:控件禁用防御断言(有/无控件 API 都不抛)
- 契约:map-shell.module.css 含 `.mapCanvas` z-index/isolation 断言(component-contracts 追加,若该文件已有 map-shell css 断言模式)

## 文件边界

- 只允许改:`server/src/components/map-shell.module.css`、`server/src/lib/map-engine/tencent/tencent-engine.ts`、`server/src/lib/map-engine/baidu/baidu-engine.ts`、`server/tests/map-engine-{tencent,baidu}.test.mjs`、`server/tests/component-contracts.test.mjs`(追加)
- **不碰**:`map-shell.tsx`(ws-3 并行做,勿动)、`map-markers.ts`(ws-2)、三引擎其他文件、`types.ts`、`tech/`、`server/docs/`、数据文件

## 门禁

1. `cd /Users/acccan/dm-wt-rw4/server && npm test`(基线 1034 零漂移 + 新增)
2. `cd /Users/acccan/dm-wt-rw4/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-rw4 && make docs-check`(基线红如实报告)、`git diff --check`
4. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-4.md`:层级方案说明(containing block 原理简述)、TMap 时序修复、Baidu 控件防御、CSS 类名核实记录、测试用例。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```