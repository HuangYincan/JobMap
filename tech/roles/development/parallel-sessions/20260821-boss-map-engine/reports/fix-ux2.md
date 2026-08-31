# fix-ux2 汇报(2026-08-21)

worktree:`/Users/acccan/dm-wt-eng-fix3`(分支 `fix/map-engine-ux2`,基于 `b9b5576` merge/fix/map-engine-runtime-errors)
腾讯引擎实跑反馈三问题修复:默认引擎回高德、默认控件遮挡、腾讯模式 POI 不渲染。

## 实际改动

### 问题 1:默认引擎变成腾讯(用户要求默认高德)

- `server/src/lib/map-engine/engine-preference.ts`
  - 改前:`window.localStorage` 持久化 `domain-map:engine` 偏好,用户历史切过腾讯 → 每次启动都选腾讯。
  - 改后:读写全部切到 `window.sessionStorage`(会话级偏好)。新会话/新标签页默认无偏好 → `resolveEngine` 回落 `configured[0]` = amap(ENGINE_PRIORITY 第一);会话内手动切换仍记住。旧 localStorage 遗留值不读取、不迁移、不清除。注释同步说明。
- 契约/断言同步清单:
  - `server/tests/map-engine-selection.test.mjs`:4 处 `window = { localStorage: makeStorage(...) }` → `sessionStorage`;新增用例「preference 会话级:localStorage 旧偏好不生效;write 只写 sessionStorage」(断言:旧 localStorage 存 tencent 时 read 为 null、resolveEngine 回落 amap;write 后 sessionStorage 有值;新会话回落 amap)。
  - `server/tests/component-contracts.test.mjs` L707 契约:保留 `/domain-map:engine/`(key 不变),新增 `assert.match(preference, /sessionStorage/)` + `assert.doesNotMatch(preference, /localStorage/)`(源码已无 localStorage 字面量)。
  - 未触碰 `guest-search-history`(独立 localStorage 功能)、`mode-cache`(已是 sessionStorage)。

### 问题 2:腾讯地图自带控件层级高,遮挡/拦截原 UI 点击

- `server/src/lib/map-engine/tencent/tencent-engine.ts`
  - 改前:createView 构造 options 仅 `{ center, zoom, pitch, rotation, baseMap }`,TMap 默认创建 zoom/scale 控件,内部 DOM z-index 高于 map-shell UI。
  - 改后(多路径防御,**全部经真实 TMap GL SDK v1.8.0.2 源码核实**,非猜):
    1. 构造 options 传 `showControl: false`(官方选项:false 时不再创建 zoom/scale 默认控件,**版权标识仍保留**——ToS 署名合规,与 boss 预案「版权浮层也禁」做了收敛取舍,仅解除其点击拦截)。
    2. 构造后 `getControl('zoom'|'scale')` + `removeControl(ctrl)` 摘除已建控件(老 SDK 忽略构造选项时;控件 id 从 SDK 枚举核实:zoom/scale)。
    3. `setShowControl(false)` 阻止后续重建(SDK 核实:仅设标志,构造后调用不摘除已建控件,故放在 removeControl 之后作补充)。
    4. DOM 兜底 `hideControlDom`:`getContainer()` 内查询交互控件元素(`[class*="control"/"zoom"/"scale"/"rotate"]`)→ `display:none` + `pointer-events:none`;版权元素(`[class*="copyright"/"logo"/"attribution"]`)→ 仅 `pointer-events:none`(保留可见)。**不碰 canvas / marker overlay**。
  - 新增常量 `TENCENT_MAP_READY_TIMEOUT_MS`、`TENCENT_MARKER_DEFAULT_ZINDEX`;头注释补充核实依据。

### 问题 3:腾讯模式下本地 POI 没在地图上加载

- `server/src/lib/map-engine/tencent/tencent-engine.ts`
  - 改前:createView 构造后立即返回,`new TMap.Marker(...)` 直接构造,异常被 map-markers 的 try/catch 吞掉,无可见性;POI marker 无 content 且 zIndex 未传。
  - 改后:
    a) 新增 `waitForMapReady(raw)`:SDK 核实 **Map 无 ready 事件** → 监听 `idle`(首次渲染完成后底层 moveend/zoomend 后 300ms debounce 触发)+ 预留 `ready`;就绪后解绑(off 清理);3s 超时兜底不阻塞;事件系统不可用直接放行。createView 等就绪后再返回。
    b) `createMarker` 构造包 try/catch:失败 `console.error('[map-engine] TMap Marker 创建失败', e)` 后 **rethrow**(保留 addMarker 簿记语义)。
    c) zIndex 未显式时默认 `10`(SDK 核实:zIndex → DOM overlay `style.zIndex`,显式传值无副作用;纯 position POI 在底图之上可见)。
  - 风险说明:若真实环境首次渲染后 idle 不触发(极端),createView 最多延迟 3s 兜底返回——已在代码注释与汇报中记录,属 boss 预案「超时兜底不阻塞」。

## 测试用例(map-engine-tencent.test.mjs 新增/更新)

- `createView:TMap.Map 参数传递`(更新):新增 `opts.showControl === false`、构造后 `setShowControl(false)`、就绪监听已解绑 3 个断言。
- 新增 `createView:地图异步初始化——等 idle 事件就绪再返回;超时兜底不阻塞`:DeferredReadyMap(不自动就绪)→ 30ms 内 createView 必须挂起,手动 `trigger('idle')` 后 <1s 返回,监听解绑。
- 新增 `createView:老版本 SDK 忽略 showControl → getControl/removeControl 摘除默认控件`:模拟老 SDK 已建 zoom/scale,断言构造后全部摘除。
- 新增 `createView:控件 API 全缺失 → DOM 兜底隐藏控件层(不碰 canvas,版权保留可见)`:忠实模拟 querySelectorAll 选择器语义;断言交互控件 `display:none`、版权仅 `pointer-events:none` 且可见、canvas 不受影响。
- 新增 `createMarker:无 content(纯 position POI)+ 默认 zIndex`:content 不注入、zIndex 默认 10、offset 元组转换、挂载到当前地图。
- 新增 `createMarker:构造失败 → console.error 可见 + rethrow`:ThrowingMarker,断言错误原样抛出 + `[map-engine] TMap Marker 创建失败` 日志。
- 测试基建:`installTMapDouble` 的 Map 构造后延迟 10ms 触发 idle(模拟异步初始化,所有 createView 用例走就绪路径);viewPatches 补 `getContainer`/`setShowControl`/`getControl`/`removeControl`;`off` 改为空键删除(保持 listeners 语义)。
- map-engine-selection.test.mjs:storage 断言同步 + 会话级新用例;component-contracts.test.mjs:sessionStorage 契约。

## 门禁结果

- npm test:984 通过 / 0 失败 / 2 skip(与基线一致,零漂移 + 新增 6 用例)
- typecheck:通过(tsc --noEmit)
- make docs-check:通过;git diff --check:通过

## commit 列表(branch fix/map-engine-ux2,worktree 内,未 merge 未 push)

1. `6bf3c60 fix(map-engine): 引擎偏好改会话级 sessionStorage——新会话默认回落高德`
2. `25f67e3 fix(tencent-engine): 默认控件禁用 + createView 等地图就绪 + createMarker 容错`

## 遇到的问题

- TMap 官方文档站是 JS 渲染 SPA,静态抓取拿不到 API 定义 → 直接下载真实 SDK(`map.qq.com/api/gljs?v=1.exp`,v1.8.0.2)从源码核实:`showControl` 构造选项语义、无 ready 事件(idle 为 300ms debounce)、控件 id(zoom/scale)、getContainer/removeControl/setShowControl 方法面、zIndex → DOM style。全部修复基于核实结果,非猜测。
- 「版权浮层」处理取舍:SDK 核实 `showControl:false` 后版权标识仍强制创建(ToS 署名)。若按预案直接隐藏版权有合规风险 → 保留可见、仅 `pointer-events:none` 解除点击拦截(用户目标「全部可点」达成)。如需彻底隐藏版权,需 boss 裁决(可能违反腾讯 ToS)。
- `setShowControl(false)` 构造后调用仅设标志不摘除已建控件(SDK 核实)→ 不作为唯一手段,排在 removeControl 之后作补充。
- 极端情形:真实环境首次渲染后 idle 事件若不触发,createView 最坏等 3s 超时兜底(预案允许);若实跑确认频繁 3s 延迟,可后续把就绪信号改为 marker 排队机制。

门禁: PASSED
结论: OK
