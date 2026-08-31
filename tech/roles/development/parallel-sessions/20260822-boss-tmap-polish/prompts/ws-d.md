# Workstream d — feature/tmap-satellite(TMap 卫星底图修正)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-pd`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/reports/ws-d.md`(末两行 token,见文末)。

## 背景(boss 真实验证 2026-08-22,Playwright)

ws-b 合并后真机验证:7 项 bug 中 6 项通过(百度渲染 ✅/水印隐藏 ✅/比例尺 ✅/zoom 控制 ✅/深色样式 ✅/聚合徽章+公司 icon ✅),**唯一失败:卫星样式** —— 切「卫星」后 TMap 地图**全白**(中心亮度 231/标准差 21,瓦片未渲染;console 无瓦片请求错误 = 请求根本没发出)。

现状:`tencent-engine.ts` setStyle 把 `satellite → { type: 'raster' }`(L121-125)。raster 模式切换后底图瓦片源未正确加载。

## 任务

### TMap GL 卫星底图正确实现(`server/src/lib/map-engine/tencent/tencent-engine.ts` setStyle 段)

- **核实 TMap GL JS API 卫星底图正确配置**(可做尽做):
  - SDK 官方文档:`TMap.Map` 构造选项的 `baseMap`/`styles`/`styleId`;卫星底图是 `new TMap.Map({ baseMap: { type: 'raster' } })` 还是 `map.setMapStyleId('style2')`/`setStyles`?或需要 raster 图层 URL 配置?
  - 读已加载的 SDK 源码(console getscript URL 可抓;或浏览器 evaluate `Object.keys(TMap)`、`TMap.Map` 构造选项)
  - 线上验证环境:主仓库 dev server 在跑、腾讯 key 有效 —— 若你能在浏览器 evaluate 验证,记录;不能则以 SDK 源码核实为准
- **修复**:setStyle('satellite') 在 TMap 上切到真实卫星底图(核实到的正确 API);切回标准/dark 正常;失败仍降级 normal + warn(如实记录,不假装)
- 契约 `MapStyleId` 语义不变;其他引擎零改动

### 测试

- `server/tests/map-engine-tencent-style.test.mjs` 追加:卫星 setStyle 调用断言(按核实到的 API 形态,mock 断言)
- 全量门禁见批次 README(基线 1171)

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(**仅 setStyle 段**)、`server/tests/map-engine-tencent-style.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:其他引擎、`map-markers.ts`、`map-shell.tsx`、`map-shell.module.css`、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-pd/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-pd && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/reports/ws-d.md`:卫星底图 API 核实结论(SDK 证据)、修复实现、测试、真实验证状态。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
