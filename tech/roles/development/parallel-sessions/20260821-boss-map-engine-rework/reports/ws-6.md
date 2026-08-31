# ws-6 汇报(2026-08-22)

## 实际改动

### 1. 百度加载器修复(`server/src/lib/map-engine/baidu/baidu-engine.ts`)

**核实结论(为什么 document.write 被拦)**:官方 `/api` 加载器
(`https://api.map.baidu.com/api?type=webgl&v=1.0&ak=...`)本身只有 401B,内部
`document.write` 注入 getscript 子脚本 + bmap.css。SPA 运行时动态注入脚本时,
document 已完成解析且脚本非 parser-inserted → 浏览器按 HTML 规范拦截
`document.write`(`Failed to execute 'write' on 'Document'`)→ 子脚本不加载 →
`BMapGL` 命名空间永不就绪。**`v=3.0` 的 /api 包装器与 v=1.0 逐字节相同
(2026-08-22 实测抓取),升级版本号不解决 document.write** —— 方案 B 排除。

**所选方案(方案 B′:直连 getscript 本体,实测坐实)**:直接加载包装器
document.write 的目标子脚本 `https://api.map.baidu.com/getscript?type=webgl&v=1.0&ak=<AK>`
(实测 1.2MB,grep **零 document.write**,同步定义 `window.BMapGL` + `BMAPGL_*`
常量)。叠加任务书方案 A 的同步注入语义:

- `BAIDU_SCRIPT_URL` 改为 getscript 直连 URL;
- 百度专用同步注入器(`injectBaiduScript`):`script.async=false` + `defer=false`
  + 挂 document.head 最前(script-loader 默认 async=true 路径不动,AMap/TMap
  无感;script-loader.ts 零改动);
- `load()` 追加就绪轮询 `waitForBaiduNamespace`(50ms × 40 ≈ 2s 超时):
  getscript 开头即 `window.BMapGL={}` 占位,半载/残缺命名空间由轮询兜住;
  超时抛既有「命名空间未就绪」错误(switch 回滚契约文案不变);
- `isLoaded()` 改功能判定(`typeof ns.Map === 'function'`),残缺命名空间视为
  未就绪(比「存在」严格,engine-mock 兼容);
- bmap.css 幂等注入(`injectBaiduCss`,包装器第二支 document.write 的等价物;
  querySelector 守卫 + 失败静默,不阻塞主流程)。

### 2. TMap MultiMarker 批量化(`server/src/lib/map-engine/tencent/tencent-engine.ts`)

**设计(单共享实例 + 身份映射 + 样式归组)**,SDK v1.8.0.2 源码实测核实
`add/remove(ids)/updateGeometries/setStyles/getGeometryById/setMap/setZIndex/
setVisible` 全部存在:

- **几何组织**:首次 createMarker 惰性构造共享 `MultiMarker` 实例(带首批
  geometry/归组样式/zIndex),后续 `raw.add([geometry])` 增量;145 marker →
  1 实例 1 数据层(消灭「数据层过多」警告 + mousemove 监听泄漏);
- **身份映射**:`multiGeometries`(id → 活 geometry 引用,setPosition 原地改后
  `updateGeometries` 保留 styleId)+ `multiAttached`(当前挂载 id 集)+
  `multiZIndexes`(id → zIndex);
- **样式归组**:icon 规格 + offset 签名 → styleId(`dm-st-N`),同签名共享(样式
  字典不随 marker 数膨胀);新签名 `setStyles` 全量替换上实例(必须先于 add,
  geometry 引用的 styleId 不能缺失);无 icon/offset → `default`(SDK 内建 pin);
- **层级**:zIndex 实例级(overlay layer rank,SDK 无 per-geometry zIndex)→
  `max(全部 marker)` 近似契约语义:选中 100/高亮 80 整体抬升、移除/降级回落
  (值未变不调用);老 SDK 无 setZIndex → 一次性 warn 降级;
- **可见性**:setVisible 经 `remove([id])`/`add` 摘挂单 geometry —— 隐藏 = 不在
  图层,天然不可点击/零渲染开销;实例级 setVisible 会误伤全部 marker,弃用
  (老 SDK 无实例级 setVisible 也照常工作,无降级路径);
- **事件**:单实例 click 按 `e.geometry.id` 过滤分发(ws-1 模式扩展,
  `multiClickHandlers` 改为 cb → `{id, handler}`,共享实例下 off 缺省 cb 必须
  按 id 精确解绑本 marker,不能清全量);remove 同步清理回调簿记;
- `destroy()` 显式 `setMap(null)` 摘除共享实例 + 清全部簿记。

**契约不变**:types.ts 零改动;MapMarker 包装形态/方法签名/返回形态不动;
单点 Marker 路径(npm SDK 形态)原样保留。

## 门禁结果

- npm test:1106 测试,1104 通过 / 2 skip / 0 失败(基线 568 → 全量跑通)
- npm run typecheck:通过
- git diff --check:通过(工作树干净,无越界文件)
- make docs-check:**基线红(非本批)** —— 仅
  `tech/roles/development/parallel-sessions/20260821-boss-agent-thinkfix/
  merge-report.md:20` 复述 grep 正则自匹配(先于本批并入 dev,ws-5 同款记录);
  本批 tech/23 追加零新增违例

## 遇到的问题

1. **node:test mock.timers 陷阱**:就绪轮询是「timer → 微任务续 → 下一 timer」
   链,mock.timers.tick 只触发 tick 时已存在的 timer,续体需交替
   `await Promise.resolve()` 排空;且 `p.then()` 派生 promise 随 p 同错 reject,
   裸 then 会被 node:test 判「async activity after test ended」→ 派生链必须带
   catch。已修(测试内注释留档),超时用例逐拍快进 39+1 tick 后断言抛错。
2. **真实验证不可做**(headless worker 无浏览器工具;worktree 无 .env.local)
   → 以 mock 测试 + 厂商 SDK 源码/脚本实测为验收主依据,真实验证由 boss 合并
   后 Playwright 冒烟回填(tech/23 已记 deferred)。

## 证据

- 厂商脚本实测(2026-08-22 抓取,存档 /tmp):`/api?v=1.0` 与 `/api?type=webgl&v=3.0`
  包装器 401B 且逐字节相同、各含 2 处 document.write;getscript 本体 1.2MB、
  document.write 计数 0、`window.BMapGL=window.BMapGL||{}` + `BMAPGL_NORMAL_MAP`
  常量定义;TMap GL SDK v1.8.0.2(2.2MB)MultiMarker 方法面核实
  (add/remove/updateGeometries/setStyles/getGeometryById)。
- `map-engine-baidu.test.mjs`:43/43 绿(新增:getscript URL/async=false/轮询补全/
  2s 超时抛错/CSS 幂等/isLoaded 功能判定)
- `map-engine-tencent.test.mjs`:49/49 绿(新增批量化专项:145 marker 单实例
  「数据层不爆炸」、样式归组共享、off 缺省按 id 隔离、remove 摘单不误伤、
  zIndex max 收敛/回落、可见性摘挂)
- 全量 engine 套件:map-engine-*.test.mjs + map-markers 共 163/163 绿

门禁: FAILED
结论: OK
