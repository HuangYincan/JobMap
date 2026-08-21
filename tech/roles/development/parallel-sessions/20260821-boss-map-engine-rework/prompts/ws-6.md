# Workstream 6 — feature/engine-fixes(百度加载器 + TMap 批量 MultiMarker)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-rw6`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-6.md`(末两行 token,见文末)。

## 背景(boss 真实验证结论,2026-08-22 Playwright 冒烟)

轮1-5 重构全部合入 dev 后,boss 用 Playwright 对真实 dev server 冒烟验证:

1. **默认高德 ✅**、**高德↔腾讯往返 ✅**(渲染/POI 创建/UI 可点/无崩溃)
2. **高德→百度 ❌**:`api.map.baidu.com/api?v=1.0&type=webgl&ak=...` 异步注入时 SDK 内部 `document.write` 被现代浏览器拦截(console: `Failed to execute 'write' on 'Document'`)→ BMapGL 命名空间永不就绪 → `BaiduEngine.load` 抛「命名空间未就绪」→ switchEngine 失败回滚(回滚路径 ✅ 但百度不可用)
3. **TMap ⚠️**:当前适配层每 marker 建一个独立 MultiMarker 实例 → ~145 个数据层 → TMap 连续警告「数据层过多,影响点击拾取」+ `MaxListenersExceededWarning 301 mousemove` 监听泄漏

## 任务

### 1. Baidu 加载器修复(`server/src/lib/map-engine/baidu/baidu-engine.ts`)— 必须项

诊断:老式 `api.map.baidu.com/api` 加载器内部用 `document.write` 注入子脚本,异步加载(script 标签 append)时浏览器禁止 document.write → 子脚本(GlMap 等)未加载 → `window.BMapGL` 就绪回调不触发或命名空间残缺。

修复方向(核实后选):
- **方案 A(推荐)**:改为同步注入 —— `script.async = false` + `script.defer` 不使用 + 在 document.head 最前插入,并等待 `BMapGL` 轮询就绪(带超时);若仍不行,
- **方案 B**:用百度 **v3.0 GL JSAPI 新加载器**(`https://api.map.baidu.com/api?type=webgl&v=3.0&ak=...` 或 GL 独立入口)——需核实 v3.0 是否仍用 document.write;若 v3.0 可用则直接升级加载 URL;
- **方案 C**:`document.write` 显式兼容 —— 在同步脚本执行窗口内注入(如用 `document.write` 包装的同步 script,只在地图引擎首次加载时调用,确保在页面生命周期早期/同调用栈内)。

**验收标准(真实浏览器)**:dev server 上切换 高德→百度:百度地图渲染、无 document.write 报错、无「命名空间未就绪」、POI 出现(百度 HTML marker)、控件不遮挡 UI、再切回高德/腾讯往返正常。**离线验收兜底**:mock 断言加载器注入方式(同步注入时 script.async=false)与就绪轮询/超时。

### 2. TMap MultiMarker 批量化(`server/src/lib/map-engine/tencent/tencent-engine.ts`)— 优化项

诊断:每 marker 一个 MultiMarker → 数据层爆炸(~145)+ 监听泄漏(301 mousemove)+ 点击拾取降级。

修复方向:单组 MultiMarker 承载全部 marker:
- 一个 `MultiMarker` 实例 + `geometries: [{id, styleId, position}]` 数组;`styleId` 归组样式(默认/徽章/自定义);几何变化用 `updateGeometries` 增量更新
- marker 身份 ↔ geometry id 映射表(id→marker 元数据);`setZIndex`/`setVisible` 映射到 styleId 分组或 updateGeometries 重建
- 事件:现有 `e.geometry.id` 过滤模式复用(ws-1 已实现该模式,核实后扩展)
- **契约不变**:MapMarker 包装形态、方法签名、返回形态一律不动(types.ts 零改动);三引擎语义一致性测试不得回归

**验收标准**:TMap 下 marker 数量多时**不再出现**「数据层过多」错误与监听泄漏警告;marker 增删改(添加/移除/可见性/层级/点击)行为与单点 MultiMarker 一致(现有契约测试全绿 + 新增批量化专项测试)。

### 3. 测试与门禁

- 新增:`server/tests/map-engine-baidu.test.mjs`(加载器注入/就绪/超时)、`server/tests/map-engine-tencent.test.mjs`(批量 MultiMarker:geometries 组织、updateGeometries、事件过滤、增删改)
- 全量:`cd /Users/acccan/dm-wt-rw6/server && npm test && npm run typecheck`;`cd /Users/acccan/dm-wt-rw6 && make docs-check`(基线红如实报告)、`git diff --check`
- 小步 commit(Conventional Commits)

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`、`server/src/lib/map-engine/tencent/tencent-engine.ts`、`server/tests/map-engine-{baidu,tencent}.test.mjs`、`tech/23-map-engines.md`(验证结果回填,仅追加)
- **不碰**:`types.ts`、`map-markers.ts`、`map-shell.tsx`、`switch.ts`、`use-map-engine.ts`、`map-shell.module.css`、`server/src/components/**`、`server/data/**`、`tech/01|03|06`、`agent.md`

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-6.md`:加载器修复方案(核实结论:为何 document.write 被拦、所选方案与验证)、批量 MultiMarker 设计(几何组织/身份映射/事件)、测试用例、**真实验证记录(若环境允许 dev server + Playwright;boss 已验环境可用:主仓库 server/.env.local 三 key 齐、dev server 运行中,但 .env.local 不在 worktree —— 真实验证需在主仓库跑,无法则在汇报注明)**。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
