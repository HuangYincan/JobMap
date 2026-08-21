# Workstream 3 — feature/engine-switch-lifecycle(切换生命周期修正)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-rw3`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-3.md`(末两行 token,见文末)。

## 背景(诊断坐实,根因 2/3/7/9)

- **破坏性切换无回滚**:`switch.ts:121` `from.destroy()` 先于 `to.load()/createView()`;目标失败时旧 view 已死,`viewRef.current` 仍指向已销毁视图 → 后续 `readMapViewSnapshot` 对死 map 调 `getCenter()` 抛错 → 应用进入错误态,**地图永久空白直到刷新("卡死"最强候选)**
- **切换重入被丢弃**:`use-map-engine.ts:139` `switchingRef` 硬门,快速来回切第二击丢失;TMap idle 3s 超时期间全部点击丢失 →「不能来回切换」
- **POI 重建靠隐式 setState 链**:`use-poi-map` 的 view 是 `mapInstance.current` **ref 值**(map-shell.tsx:1538),重建依赖 `syncView` 的 setState 恰好触发——非契约化,任何一环变化 POI 就不重建(「切换后 POI 消失」机制之二)
- **挂载/切换竞态**:`use-map-engine.ts:242-258` 挂载 createView 与切换并发 → 同容器双实例无兜底;`.then` 分支若 teardown 恰在 resolve 后发生,已创建视图无人销毁(StrictMode dev 下可触发)

## 任务

### 1. `server/src/lib/map-engine/switch.ts` — 安全切换(失败可恢复)

- 改编排顺序:**先 `await to.load()` + `to.createView(...)` 成功,再 `from?.destroy()`**。问题:同一 container 上创建新 view 时旧 view 还在——核实三引擎在**同一容器上先建新 map 是否与旧 map 冲突**(AMap/TMap/BMapGL 一般允许容器上有新 map 实例,旧 map destroy 后新 map 接管;但 GL 引擎可能在旧 map destroy 前 canvas 冲突)。**以核实为准的两个方案**:
  - 方案 A(推荐):新 view 创建到**临时离屏容器**(`document.createElement('div')`,style 尺寸与正式容器一致),成功后:旧 view destroy → 把新 view 的厂商实例**迁移到正式容器**(核实三引擎是否支持实例迁移;AMap 的 map.setContainer?TMap/BMapGL 的对应 API?)——若迁移不可行,降级方案 B
  - 方案 B:顺序改为 `to.load()`(脚本就绪,最耗时部分)成功 → `from?.destroy()` → `to.createView(正式容器)`(此时失败概率已极低;createView 抛错时**捕获 state 并重建旧引擎 view 回滚**,`from.engine` 的脚本已加载,重建快速)
- **无论哪个方案,失败路径必须恢复可用**:抛错前 `try { 重建旧 view } catch { 清空 }`,返回错误信息;禁止留下「已销毁 view 存活在 ref 里」的状态
- 切换 token/generation:支持调用方取消(见任务 2)

### 2. `server/src/hooks/use-map-engine.ts` — 最新意图优先 + 错误态清理

- 切换竞态改**「最新意图优先」**:每次 `switchEngine` 递增 generation;在飞切换 resolve 后若 generation 不匹配(已有更新的意图)→ 丢弃结果并 `destroy` 刚创建的 view;不再用 `switchingRef` 硬丢弃第二次点击
- `isSwitching` 仅作视觉指示(可短暂连点,UI 层保持 aria-disabled 提示但不再拦截请求)
- **错误路径**:catch 后清空 `viewRef.current`/`setView(null)`/`engineView` 状态,暴露可重试(下次 switchEngine 正常走),并 `console.error` 详情
- 挂载/切换竞态兜底:挂载 createView resolve 后检查「期间是否已发生切换/卸载」——是则 `created.destroy()`;teardown 在 resolve 后发生时同样销毁(补 `cancelled` 检查缺口)
- 保持 keepalive 交棒(StrictMode 修复,dev 双调用)语义不被破坏

### 3. `server/src/components/map-shell.tsx` — view 状态化(显式重建)

- 把传给 `usePOIMap` 的 view 从 `mapInstance.current`(ref)改为 **state**(如 `engineView` state,由 use-map-engine 的 `view` 提供);usePOIMap 的创建 effect deps `[view]` 随切换自然触发**显式重建**(新 controller 在新 view 上 applySync 回放 pois/visible/selected/highlighted)
- `mapInstance.current` ref 保留给需要同步读的地方(事件回调内),但 POI 重建不再依赖它
- **不改** POI 数据流(map-shell L827-1042 主加载 effect)与 domain/work 分支逻辑

### 4. 测试

- `server/tests/map-engine-switch.test.mjs`:失败回滚(目标 createView 抛错 → 旧 view 重建或容器可用 + 错误可重试)、重入取代(两次切换,后发赢)、generation 取消
- `server/tests/hooks-contracts.test.mjs` 或对应契约:map-shell 的 usePOIMap view 参数来自 state(正则断言,若现有契约有 hooks 模式)
- 现有全部测试保持绿

## 文件边界

- 只允许改:`server/src/lib/map-engine/switch.ts`、`server/src/hooks/use-map-engine.ts`、`server/src/components/map-shell.tsx`(**仅 view state 化相关行段**,其他会话并行改动 agent 相关,勿碰)、`server/tests/map-engine-switch.test.mjs`、`server/tests/hooks-contracts.test.mjs`(如适用)
- **不碰**:`map-markers.ts`(ws-2 并行做,不要动)、三引擎实现、`types.ts`、`poi-service.ts`、`amap-api.ts`、`tech/`、`server/docs/`、数据文件

## 门禁

1. `cd /Users/acccan/dm-wt-rw3/server && npm test`(基线 1034 零漂移 + 新增)
2. `cd /Users/acccan/dm-wt-rw3/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-rw3 && make docs-check`(基线红如实报告)、`git diff --check`
4. 汇报给出:方案 A/B 核实结论(引擎实例迁移可行性)、失败回滚路径说明、重入语义
5. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-3.md`。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```