# Workstream e — feature/map-engine-baidu(百度引擎)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-eng-e`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/e.md`(末两行 token,见文末)。

## 背景

引擎内核(轮 1 已合并)定义了 `MapEngine/MapView/MapSearchProvider` 接口与 `coord-utils.ts`(含 bd09 转换)。本 WS 实现**百度地图 GL(BMapGL)** 引擎——全计划唯一坐标分叉点:`coordSystem: 'bd09'`,适配器在 createMarker/setCenter/getState 等**边界做 bd09↔gcj02 转换**(内部用 coord-utils),漏转症状≈700m 偏移,测试必须钉住。vendor API 细节以官方文档核实为准(https://lbs.baidu.com/index.php?title=openwebgl 与 webgl 相关文档),**核实结论记录进汇报**(boss 汇总进 tech/23)。

## 任务

### 任务 1:`server/src/lib/map-engine/baidu/baidu-engine.ts`(新建)

按接口实现 `MapEngine`:
- `id: 'baidu'`、`label: '百度地图'`、`namespace: 'BMapGL'`、**`coordSystem: 'bd09'`**、`keyVar: 'NEXT_PUBLIC_BAIDU_AK'`
- `isConfigured()`:`process.env.NEXT_PUBLIC_BAIDU_AK` trim 非空
- `load()`:脚本 URL `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=<KEY>`(以官方文档为准),经 `script-loader` 注入;幂等;失败清理
- `createView(opts)`:官方 API 创建地图;视图方法映射(注意:BMapGL 的俯仰是 `setTilt`/`enableTilt` 语义,与 AMap 的 `setPitch` 不同——适配器内部换算,接口签名保持 types.ts 一致)
- **bd09 边界转换**(重点):
  - `createMarker`/`createCircle` 入参 gcj02 → bd09(调 `gcj02ToBd09`)
  - `setCenter`/`getState`/`getBounds` 边界:getState 返回 gcj02(规范坐标),内部坐标 bd09
  - search 返回归一化 gcj02
- `search`:BMapGL 官方服务(PlaceSearch / Autocomplete / geolocation / geocoder,以官方文档核实的命名)实现四方法
- `setStyle`:核实百度支持的样式(标准/卫星/暗色);不支持的 → 回退 normal + `console.warn`

### 任务 2:测试 `server/tests/map-engine-baidu.test.mjs`(新建)

- 用 `engine-mock`(installEngineMock 装到 `BMapGL` namespace,`coordSystem:'bd09'`)测:
  - **bd09 转换断言(核心)**:createMarker 收到的位置 === 传入 gcj02 坐标经 `gcj02ToBd09` 的结果;**断言用往返自洽**(`bd09ToGcj02(gcj02ToBd09(p)) ≈ p`,±1e-5)——注意:网传「天安门 bd09 对照点 (116.403963, 39.915119)」与百度官方公式差 ~4.5e-4(ws-b 已实测确认),**不要用网传对照值做固定点位断言**;getState 返回 gcj02
  - createView 参数、setStyle 映射/降级、search 归一化(gcj02 输出)、isConfigured env 开关
- env 用 `process.env.NEXT_PUBLIC_BAIDU_AK = 'test-key'` + try/finally 还原

## 文件边界

- **只允许改**:`server/src/lib/map-engine/baidu/baidu-engine.ts`(新)、`server/tests/map-engine-baidu.test.mjs`(新)
- **不碰**:`map-engine/` 其他任何文件、`map-shell.tsx`、`amap-api.ts`、`site-geocode.ts`、`scripts/`、`tech/`、`server/docs/`、`server/data/**`

## 门禁

1. `cd /Users/acccan/dm-wt-eng-e/server && npm test`(基线含轮1:**全部绿零漂移** + 本 WS 新增)
2. `cd /Users/acccan/dm-wt-eng-e/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-eng-e && make docs-check`、`git diff --check`

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/e.md`。内容:**vendor API 核实记录**(脚本 URL、地图/marker/tilt/样式/服务 API 确切命名与参数,附官方文档链接)、bd09 转换清单(哪些边界转了)、测试用例(含固定点位断言值)、已知限制。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

## 【续作重派附录 — boss 裁决 2026-08-21】

前一次 claude -p 会话异常退出(日志仅 1 行「Typecheck passes…」,无汇报,exit 0 但进程中止)。**分支零 commit**;worktree 内已有未跟踪文件 `server/src/lib/map-engine/baidu/`(草稿,未提交)。

裁决(续作重派,同一 worktree):
1. 先审阅 `server/src/lib/map-engine/baidu/` 现有草稿内容:完成度足够则修订复用,半途则重写,以**最终产物正确**为准。
2. **必须先 commit** 已审定的代码(小步 commit),再进行后续任务;完成后跑全部门禁、写汇报。
3. 本附录不改变原任务范围、文件边界、汇报契约(末两行 token 不变)。
