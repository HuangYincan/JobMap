# Workstream d — feature/map-engine-tencent(腾讯引擎)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-eng-d`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/d.md`(末两行 token,见文末)。

## 背景

引擎内核(轮 1 已合并)定义了 `MapEngine/MapView/MapSearchProvider` 接口与 `coord-utils`。本 WS 实现**腾讯地图 JS API GL** 引擎,兑现「只配腾讯一家也可用」。vendor API 细节以官方文档核实为准(https://lbs.qq.com/webApiCenter/glAPI/glAPI 与 JS API GL 服务文档),**核实结论必须记录进汇报**(boss 汇总进 tech/23)。

## 任务

### 任务 1:`server/src/lib/map-engine/tencent/tencent-engine.ts`(新建)

按接口实现 `MapEngine`:
- `id: 'tencent'`、`label: '腾讯地图'`、`namespace: 'TMap'`、`coordSystem: 'gcj02'`(腾讯原生 gcj02,零转换)、`keyVar: 'NEXT_PUBLIC_TENCENT_JSAPI_KEY'`
- `isConfigured()`:`process.env.NEXT_PUBLIC_TENCENT_JSAPI_KEY` trim 非空
- `load()`:脚本 URL `https://map.qq.com/api/gljs?v=1.exp&key=<KEY>`(以官方文档为准),经 `script-loader` 注入;幂等;失败清理
- `createView(opts)`:官方 API 创建地图实例;视图方法(center/zoom/pitch/rotation/样式/事件/createMarker/createCircle/flyTo/setBounds/destroy)逐一映射到 TMap API——**API 命名以官方文档核实为准**,接口签名必须与 types.ts 一致(引擎内适配)
- `search`:TMap 官方服务 API(PlaceSearch 等)实现 `searchPOI/fetchSuggestions/getCurrentPosition/geocodeAddress`,结果归一化为 gcj02 `DomainPOI`/`AmapSuggestion` 形状(与 amap-api 现有返回对齐)
- `setStyle`:**核实腾讯支持的底图样式**(标准/卫星/暗色);不支持的 → 回退 normal + `console.warn`

### 任务 2:测试 `server/tests/map-engine-tencent.test.mjs`(新建)

- 用 `engine-mock`(installEngineMock 装到 `TMap` namespace)测:createView 参数传递、createMarker(offset 元组转换)、setStyle 映射/降级、search 归一化(含 gcj02 断言)、isConfigured env 开关
- env 用 `process.env.NEXT_PUBLIC_TENCENT_JSAPI_KEY = 'test-key'` + try/finally 还原
- 真实脚本 URL/API 命名的断言(mock 内注册的 TMap 对象,按官方文档核实后的形状)

## 文件边界

- **只允许改**:`server/src/lib/map-engine/tencent/tencent-engine.ts`(新)、`server/tests/map-engine-tencent.test.mjs`(新)
- **不碰**:`map-engine/` 其他任何文件、`map-shell.tsx`、`amap-api.ts`、`site-geocode.ts`、`scripts/`、`tech/`、`server/docs/`、`server/data/**`

## 门禁

1. `cd /Users/acccan/dm-wt-eng-d/server && npm test`(基线含轮1:**全部绿零漂移** + 本 WS 新增)
2. `cd /Users/acccan/dm-wt-eng-d/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-eng-d && make docs-check`、`git diff --check`

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/d.md`。内容:**vendor API 核实记录**(脚本 URL、地图/marker/circle/样式/服务 API 确切命名与参数,附官方文档链接)、实现摘要、测试用例、已知限制(如无真实 key 的冒烟缺口——用户尚未配置 NEXT_PUBLIC_TENCENT_JSAPI_KEY,记入 deferred)。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
