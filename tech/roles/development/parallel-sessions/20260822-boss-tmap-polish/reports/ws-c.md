# ws-c 汇报(2026-08-22)— feature/baidu-ready-signal 百度就绪信号修正 + 全链路验证

## 实际改动

- `server/src/lib/map-engine/baidu/baidu-engine.ts` → 就绪等待段与 createView 时序重构:
  - **根因修复(相机先行)**:`createView` 从「new Map → 等就绪 → centerAndZoom」改为「new Map → centerAndZoom/setTilt/setHeading → 等就绪」。
  - `waitForMapReady` 就绪信号从「setMapReadyCallback + tilesloaded 双通道」改为「setMapReadyCallback(存在时优先,升级兼容)+ 多通道事件 `onfirsttilesloaded` / `tilesloaded` / `onstyle_loaded`(任一即就绪)」;超时 1500ms、文案「BMapGL 地图就绪超时」、channels===0 立即放行、就绪/超时全量解绑均保持。
  - 常量注释/BMapInstance 接口注释按 SDK 核实结论更新。
- `server/tests/map-engine-baidu.test.mjs` → 44 → 47 测试:
  - 改写「就绪等待」测试为「相机先行」时序断言(createView 未 await 时相机已应用 + 就绪后相机保持)。
  - 超时测试:追加相机先行断言;语义不变(1.5s 超时 + 销毁 + 全监听解绑)。
  - 新增「就绪多通道」测试:三事件注册名断言 + 任一触发即就绪 + 解绑;setMapReadyCallback 优先通道回归保持。
  - FakeMap 自动就绪信号 `tilesloaded` → `onfirsttilesloaded`(v1.0 派发原名)。
- `tech/23-map-engines.md` → 仅追加:百度表新增「就绪信号」「就绪时序」两行 + 冒烟记录表 ws-c 行。

## 就绪信号核实过程与结论(SDK 源码静态核实)

抓取 `https://api.map.baidu.com/getscript?type=webgl&v=1.0` 直连本体(HTTP 200,1,197,289 字节,2026-08-22),grep/node 逐段审查:

1. **`setMapReadyCallback` 在 v1.0 SDK 中 0 处命中** —— 确认是 BMapGL 2.0 API,旧优先通道在 v1.0 上是死代码(boss 假设坐实)。
2. **事件系统**:`gd.BaseClass.prototype.addEventListener` 注册名自动补 `"on"+` 前缀(`if(C.indexOf("on")!==0){C="on"+C}`),`dispatchEvent` 按事件 `type` 原样查 `_listeners`。故注册 `tilesloaded` 与派发串 `ontilesloaded` 归一后同键命中 —— 旧 `tilesloaded` 注册名本身没错。
3. **根因(决定性)**:GL 构造器 `function jy(e,mB)` 尾部 `if(!H.apiVersionIsGL()){...centerAndZoomIn(DEFAULT_CENTER,DEFAULT_ZOOM)}` —— **GL 分支跳过默认视图初始化**;webgl 相机方法 `J.prototype.centerAndZoomIn` 中 `if(!this.loaded){this.firstTileLoad=false}` + `if(!this.loaded&&...){...this._addTileLayer(T)...}` + `this.loaded=true` —— **底图图层与瓦片请求只在 centerAndZoomIn 内发生**。旧时序「等就绪再设相机」= 零瓦片请求 = `onfirsttilesloaded`/`ontilesloaded` 永不派发 = **必然 1.5s 超时回滚,与 AK 有效与否无关**。这解释了「AK 已有效但仍失败」。
4. **v1.0 真实就绪事件**(均在 Map 实例上经 BaseClass 派发):`onfirsttilesloaded`/`onfirsttileloaded`(map 级 `_checkTilesLoaded`,GL 分支 `if(H.apiVersionIsGL()){dispatch}`)、`ontilesloaded`(全部瓦片,80ms 稳定期)、`onstyle_loaded`(样式配置加载,早于瓦片)。
5. **轮询兜底选型依据**:事件通道经 SDK 核实可靠(健康路径首帧瓦片数十 ms 内完成),且任何「map 状态可读」类谓词(如 `getZoom()>0`)在相机先行后恒真 → 会**打破禁用 AK 的回滚契约**(100ms 内误判就绪,返回空图而非回滚)。故不引入轮询,保留事件多通道 + 1.5s 超时;禁用 AK 时瓦片 403 走 4s×3 重试路径,1.5s 内无信号 → 超时销毁 + 抛错 → switch 回滚契约不变。
6. **「等就绪再设相机」旧注释的担忧无 SDK 依据**:GL 从不应用 `_initViewport`(仅非 GL 分支读取),`_asyncRegister` 只跑注册插件、`kS.setMap` 是 WebGL 材质 setter —— 无任何异步初始化重置相机。

## 门禁结果

- npm test:1142 通过 / 0 失败(2 skip 为基线既有;基线 1128 之上新增 14 个含本 WS 3 个新增/改写;含共享 lifecycle fixture 回归,baidu 徽章生命周期/摘除测试通过)
- typecheck / docs-check / git diff --check:通过

## 遇到的问题

- 共享 lifecycle fixture(`map-engine-lifecycle.test.mjs` RawMap,文件边界不碰)自动派发**无前缀** `tilesloaded`(精确键匹配,无 on 前缀归一)→ 若注册 SDK 派发原名 `ontilesloaded` 则 fixture 永不就绪、跨引擎回归超时。处理:注册原名 `tilesloaded`(真实 SDK 中经 BaseClass 归一命中 `ontilesloaded`,双兼容)—— 非问题,最终方案。
- 真实验证(有效 AK 下浏览器冒烟)本 WS 无浏览器环境 → 代码侧以 mock 断言就绪信号注册/时序/超时;真实验证待 boss 合并后 Playwright(预期:createView 数十 ms 内就绪、相机不丢;禁 AK 应 1.5s 超时回滚)。

## 证据

- 提交:37d324a `fix(baidu)`(engine + tests)、cdb1918 `docs(baidu)`(tech/23 回填);基线 c7e5625,worktree 干净,未 merge/push。
- 测试输出摘要:`npm test` → tests 1142 / pass 1140 / fail 0 / skipped 2;baidu 文件 47 全绿。
- SDK 证据:getscript v1.0 本体存于本机 `/tmp/bmapgl-v1.js`(1.2MB);关键定位:构造器 `function jy`(GL 跳过默认视图)、`J.prototype.centerAndZoomIn`(底图图层创建点)、`gd.BaseClass.prototype.addEventListener/dispatchEvent`(on 前缀归一)、`_checkTilesLoaded` GL 分支派发 `onfirsttilesloaded`。

门禁: PASSED
结论: OK
