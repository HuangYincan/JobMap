# Workstream 7 — feature/engine-baidu-ready(百度就绪超时回滚)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-rw7`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-7.md`(末两行 token,见文末)。

## 背景(boss 真实验证结论,2026-08-22 Playwright)

轮6 修复后真实验证:百度加载器已生效(getscript 直连无 document.write 拦截、命名空间就绪轮询通过)。但用户 Baidu AK 被禁用(服务端弹窗「APP服务被禁用了」)→ **SDK 内部异步崩溃**(`BMapGL._rd` null 等 telemetry 错误),`new BMapGL.Map()` 创建**成功但不渲染、不抛错** → switch 报告成功 → UI 显示百度选中但地图全空,无回滚(旧 AMap 已销毁,容器无图)。

根因:`baidu-engine.ts:842-859` `createView` 构造 Map 后**直接返回,不等就绪事件**——SDK 对象创建成功即通过,异步渲染失败无法触发回滚。对比:腾讯引擎(ws-4)已有 `TENCENT_MAP_READY_TIMEOUT_MS=1.5s` 就绪超时模式,百度缺失。

## 任务

### Baidu createView 就绪等待 + 超时抛错(`server/src/lib/map-engine/baidu/baidu-engine.ts`)

- createView 中 `new ns.Map()` 后,**等待首个就绪信号**再返回:
  - 就绪信号候选:BMapGL `tilesloaded` 事件(官方事件集,`baidu-engine.ts:254-260` 已有事件映射 `complete: 'tilesloaded'`)、或 `map.addEventListener('tilesloaded', ...)` + 首次触发 resolve;核实 SDK 是否还提供 `map.setMapReadyCallback`(BMapGL 2.0 API,若存在优先)
  - 超时:`BAIDU_MAP_READY_TIMEOUT_MS = 1500`(与腾讯一致);超时 → `throw`(文案含「BMapGL 地图就绪超时」)—— switch.ts 的 rollback 契约依赖 createView 抛错(`switch.ts:181-206` 已实现回滚,零改动)
  - 就绪后返回前,`centerAndZoom`/`setTilt`/`setHeading`/`setStyle` 时序:核实当前先 centerAndZoom 后等待是否丢失相机(若 SDK 创建后立即 centerAndZoom 会在就绪后被重置,则调整为就绪后应用相机状态)
- 不抛错路径保持:正常 AK 下 tilesloaded 快速触发,延迟 ~数十 ms,不可感知

### 测试

- `server/tests/map-engine-baidu.test.mjs` 追加:就绪事件触发 → 返回视图;就绪不触发(模拟 tilesloaded 永不 fire)→ 1.5s 超时抛错;超时错误文案含「就绪超时」;正常路径相机状态保持
- 全量:`cd /Users/acccan/dm-wt-rw7/server && npm test && npm run typecheck`;`cd /Users/acccan/dm-wt-rw7 && make docs-check`(基线红如实报告)、`git diff --check`
- 小步 commit(Conventional Commits)

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(验证结果回填,仅追加)
- **不碰**:`switch.ts`(回滚已就绪,零改动)、`types.ts`、`tencent-engine.ts`、`map-markers.ts`、`map-shell.tsx`、`map-shell.module.css`、`server/src/components/**`、`server/data/**`、`tech/01|03|06`、`agent.md`

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-7.md`:就绪信号选型核实(BMapGL 事件 vs setMapReadyCallback)、相机时序处理、超时常量、测试用例。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
