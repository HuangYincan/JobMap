# ws-c 汇报(2026-08-22)

> 分支 `fix/baidu-diagnostics`(worktree `/Users/acccan/dm-wt-ic`,基线 cda385f)。
> 任务:bug 3(百度加载失败诊断 + 幂等核查)+ boss 追加 bug 6(滚轮缩放)+ bug 7(标记锚点/样式)。
> 全程按「SDK 源码核实」方法:实包抓取 getscript 本体(1.2MB)+ `getmodules` marker/mapgl 模块,所有锚点/滚轮结论均有源码依据。

## 实际改动

- `server/src/lib/map-engine/baidu/baidu-engine.ts` → 四个逻辑单元:
  1. **失败分类诊断(bug 3)**:`failBaidu(code, stage, detail, cause?)` 构造带 `code/stage/guidance` 的 Error + `console.error('[map-engine] baidu 加载失败分类', {code, stage, detail, guidance, cause})`;六类:not-configured / script-load-failed / **script-blocked-by-client(新增,boss ERR_BLOCKED_BY_CLIENT 证据)** / namespace-not-ready / map-ready-timeout / unclassified,每类配可操作指引文案(硬刷新、localhost:3000、lbsyun referer 白名单、dev server 重启、拦截器白名单);message 保留原始文案(switch 回滚契约/既有断言按子串匹配,未破坏);
  2. **幂等性修复(核查发现的缺陷)**:命名空间未就绪失败后,loadScript URL 缓存留已 resolve promise + 残缺/占位命名空间 truthy → 重试被双重短路、永不重注入、每次切换白烧 2s 后失败。修复:`baiduScriptLoadBroken` 置位 → 下次 load 删命名空间 + `resetScriptLoader()` 清缓存后重注入;并发/切走切回/onerror 重试路径核查均无死锁(2s 轮询有界);
  3. **bug 6 滚轮缩放**:SDK 源码核实 Map config 默认 `enableWheelZoom: !H.apiVersionIsGL()` → GL 恒 false,mouseWheel 处理器 `if(!config.enableWheelZoom){return}` 静默忽略 → createView 显式 `map.enableScrollWheelZoom()`(API 缺失静默);
  4. **bug 7 标记锚点/样式**:SDK 源码核实(Marker 构造 `offset` 不参与渲染定位;GL quad `imageTopLeft = 屏幕位 - icon.anchor`,DOM content `= 屏幕位 + marker.offset - icon.anchor`;Icon anchor===offset 默认中心;GL 无内容纹理,setContent 走 msTarget DOM)→ createMarker 改为 **icon.anchor = -契约 offset**,content 标记配透明 1×1 锚点图标(否则默认红图钉双重渲染 + (10,25) 偏置 = 用户「样式不对 + 偏移」症状);
- `server/src/hooks/use-map-engine.ts`(仅错误路径段)→ 挂载/切换两个 catch 在错误携带 code/guidance 时补输出分类诊断;无共享 toast/alert 基建(已核查),按任务书不新增 UI 组件,仅 console 结构化输出;
- `server/tests/map-engine-baidu.test.mjs` → 35 → 61 测试:五类失败码 + 指引文案断言、ERR_BLOCKED_BY_CLIENT 启发式(含 performance 缺失/抛错回退)、幂等三断言(并发单注入/切走切回零注入/失败后重试重注入)、滚轮启用 + API 缺失静默、锚点(icon.anchor=-offset、content 透明图标、Icon 构造失败降级);「Marker 构造 offset 透传」断言按 SDK 事实改为「不再传」;
- `server/tests/map-engine-mount.test.mjs` → 源契约断言随 hook 错误路径改版锁步更新(见「遇到的问题」2);
- `tech/23-map-engines.md` → 仅追加 ws-c 回填:失败分类表、幂等核查结论、bug 3 用户端排查清单、bug 6/7 SDK 源码核实记录(含诚实局限)。

## 门禁结果

- npm test:**1270 通过 / 0 失败 / 2 skip**(基线 1212 零漂移 + 58 新增)
- typecheck:通过
- make docs-check:通过;git diff --check:通过

## 遇到的问题

1. **mock.timers 测试挂起**:新幂等重试测试漏了既有超时测试的 `await new Promise(r => setImmediate(r))` 首拍(微任务未排空 → 首 tick 空转 → 末拍轮询永不触发 → 挂起)→ 补齐后修复;顺带暴露 8s 超时会让 finally 不执行、mock 状态泄漏到下个测试(ERR_INVALID_STATE),修复后消失;
2. **允许清单外的锁步测试更新**(需 boss 知晓):`map-engine-mount.test.mjs` 源契约断言(L330)用正则钉死挂载 catch 的**旧形状**——任务要求改的正是该错误路径段 → 不改则门禁红。按仓库先例(ws-d 更新钉旧 'raster' 的十腾断言「修复的必然结果,不改则门禁红」)做最小锁步更新(放宽为 catch 起始 + 新增分类输出断言),只动这一个正则断言;
3. **无 toast/alert 共享基建**:account-panel toast 是局部 demo note;map-shell 注明「后续可接 toast 提示、不新增 UI」→ 按任务书「无则仅在 console 输出结构化错误」,如实记录,不新增 UI 组件;
4. **resetScriptLoader 生产复用**:其注释标注「测试用」,本次为幂等恢复刻意复用(script-loader.ts 不在允许清单,未改注释)→ 在引擎代码注释 + tech/23 显式说明;
5. **分类启发式的诚实局限**:ERR_BLOCKED_BY_CLIENT 错误码浏览器不暴露给 JS → Resource Timing 存在性启发式(被拦请求无 entry);performance 不可用归 script-load-failed(指引文本含拦截分支);已写入 tech/23;
6. typecheck:Icon 构造器声明 2 参 → 3 参(仅接口扩展)。

## 证据

- SDK 源码核实(2026-08-22 实包抓取,留存 /tmp/bmapgl-getscript.js 1.2MB、bmapgl-marker.js 26KB、bmapgl-mapgl.js 263KB):
  - 滚轮:核心 `enableWheelZoom: !H.apiVersionIsGL()`(L303349)+ `if(!mw.config.enableWheelZoom){return}`(L681455)+ `enableScrollWheelZoom:function(){this.config.enableWheelZoom=true}`(L325574);
  - 锚点:Icon `lA` 构造 `var mu=new k1(floor(w/2),floor(h/2)); ... if(C.anchor){i.offset=C.anchor} this.anchor=this.offset=i.offset`;quad 顶点 `(-aw, ah-h)`;marker 模块 `_getPixPos: C.x += mw.width - mv.width(marker.offset - icon.anchor)`;`setContent` 走 domElement.innerHTML;
  - 内容标记:GL Marker 类(l4)源码内 `content` 引用 0 处 → 无内容纹理,必须 DOM 通道;
- 测试输出:npm test 1270 pass / 0 fail / 2 skip;baidu 单文件 61/61(含 mock.timers 快进);typecheck 无输出即通过;
- 幂等缺陷复现序列:load 成功(HTTP 200)→ BMapGL={} 占位永不补全 → 2s 轮询超时抛「命名空间未就绪」→ 再次 load 被 URL 缓存 + truthy 短路 → 不注入、2s 后重复失败(修复前,代码审查 + 测试复现);修复后重试重注入并成功。

门禁: PASSED
结论: OK
