# Workstream a — fix/baidu-style(百度卫星常量修正 + 深色实现)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-bs`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-a.md`(末两行 token,见文末)。

## 背景(boss 侦察,2026-08-22)

**用户 bug 1「百度的卫星和深色没有实现」**:
- `baidu-engine.ts` L391-393 `STYLE_CONSTANT`:`{ normal: 'BMAPGL_NORMAL_MAP', satellite: 'BMAPGL_SATELLITE_MAP' }` —— **卫星常量名存疑**:BMapGL 的 mapType 常量可能是 `BMAP_SATELLITE_MAP`(BMap 系)而非 `BMAPGL_SATELLITE_MAP`,常量名错误 → `resolveGlobalConstant` 取到 undefined → setMapType 无效 → 卫星切换无效果(用户报「没实现」)
- L443-449 `applyMapStyle`:只处理 normal/satellite;其他样式 → `console.warn('baidu 不支持底图样式')` 回退 normal —— **深色完全没有实现**

## 任务

### 1. 卫星核实与修正

- 核实 BMapGL SDK 实际支持的底图常量名(SDK 源码/文档/全局对象探测:`window.BMAP_SATELLITE_MAP` vs `window.BMAPGL_SATELLITE_MAP` vs `BMAP_HYBRID_MAP`)
- 修正 STYLE_CONSTANT(如需);normal 同理核实
- 卫星切换验收:setStyle('satellite') 后底图变卫星影像(实测/断言常量解析)

### 2. 深色实现

- 百度暗色 = `map.setMapStyleV2({ styleJson: [...] })`(BMapGL 自定义样式,官方 styleJson 格式;或 styleId 若 SDK 支持) —— 核实 API 形态后实现
- 深色 styleJson:以官方暗色样式为基(可参考 BMapGL 官方 dark 示例/文档),保证底图可读(水系/道路/建筑分层)
- `setStyle('dark')` → 深色;切回 normal → 恢复
- 与腾讯/高德深色语义一致(图层面板「深色」选项)

### 3. 测试与文档

- `server/tests/map-engine-baidu.test.mjs` 追加:常量解析断言(修正后)、setStyle('satellite'/'dark'/'normal') 调用断言(mock)
- `tech/23-map-engines.md` 回填(仅追加):BMapGL 常量名核实结论 + 深色实现方式
- 全量门禁见批次 README(基线 1364)

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`(**仅 STYLE_CONSTANT / applyMapStyle / setStyle / 样式常量段**)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:baidu-engine.ts 的 POI/content/icon/定位段(ws-b 拥有)、腾讯/高德引擎、map-markers.ts、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-bs/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-bs && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-a.md`:常量核实结论(SDK 证据)、深色实现方式、测试。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
