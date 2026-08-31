# ws-3 汇报(2026-08-21)

## 实际改动

- `server/src/lib/map-engine/switch.ts` → 编排改「先就绪、后销毁」安全顺序:
  `to.load()` 成功(最耗时步骤,旧 view 全程存活、画面不中断)→ 销毁前再捕获
  最终相机状态(加载期间用户移图不丢失)→ `from?.destroy()` → `to.createView()`。
  createView 失败 → **回滚重建旧引擎视图**(`from.engine.createView`,脚本已加载
  重建快速):成功返回 `{ view: 回滚视图, created: false, rolledBack: true, error }`;
  回滚也失败 → 抛错(容器清空,调用方清 ref 暴露重试)。新增 `EngineSwitchSignal`
  取消 token:load 后 / createView 后两个检查点;load 阶段取消 → 旧 view 零触碰,
  createView 阶段取消 → 已建视图销毁(容器由更新意图接管)。旧 view 销毁失败不再
  阻断切换(warn 后继续)。
- `server/src/hooks/use-map-engine.ts` → **最新意图优先**:删除 `switchingRef` 硬门,
  改 `generationRef` 代际——每次 switchEngine 递增;在飞切换 resolve 后代际不匹配
  → 丢弃结果并 destroy 刚建视图(快速连点第二击不再丢失)。新意图发起时置旧
  `activeSignalRef.aborted`(load 阶段早期让路);卸载 cleanup 也让路在飞切换。
  `isSwitching` 仅作视觉指示。**错误路径**:catch 清空 `viewRef.current` /
  `setView(null)` 暴露可重试,`console.error` 详情;回滚成功路径保留旧引擎视图
  状态、不写偏好、上报原始 error。**挂载/切换竞态兜底**:挂载 createView resolve
  后若 teardown 已发生 → `created.destroy()`(补 cancelled 检查缺口);切换落地时
  销毁期间落地的挂载视图(同容器双实例兜底);卸载恰逢切换 resolve → 销毁新 view。
- `server/src/components/map-shell.tsx` → `usePOIMap` 的 view 参数从
  `mapInstance.current`(ref)改为 `engineView`(useMapEngine 的 state):引擎切换
  `setView(新视图)` 触发重渲染,usePOIMap 创建 effect deps `[view]` 随切换**显式
  重建**控制器,在新 view 上 applySync 回放 pois/visible/selected/highlighted,
  不再依赖隐式 setState 链。`mapInstance` ref 保留给事件回调内同步读
  (readMapViewSnapshot/locateForMap 等)。
- `server/tests/map-engine-switch.test.mjs` → 更新 2 处编排顺序断言(load →
  destroy → createView);新增 6 例:失败回滚(rolledBack+error+POI 回放)、回滚也
  失败抛错、from=null 无旧视图可回滚抛错、load 阶段取消(旧 view 保留)、
  createView 阶段取消(已建视图销毁)、重入取代(后发置前发 signal → 前发让路后发赢)。
- `server/tests/hooks-contracts.test.mjs` → 新增 ws-3 生命周期契约正则断言:
  useMapEngine 代际/错误清理/取消 token/挂载竞态 + map-shell `usePOIMap(engineView`。

## 方案 A/B 核实结论(引擎实例迁移可行性)

- **方案 A(离屏容器 + 实例迁移)不可行**:AMap 有 `map.setContainer(el)`(官方 API
  地图迁移),BMapGL 亦有 `map.setContainer`(webgl API 索引);但 **TMap GL 无
  setContainer**(仅 getContainer)——三引擎无法统一迁移。且迁移需扩展
  `types.ts` 契约(MapView.setContainer)并改三引擎实现,二者均在「不碰」清单。
- **方案 B(采纳,任务书推荐降级路径)**:`to.load()` 成功(脚本就绪,最耗时部分)
  → `from?.destroy()` → `to.createView(正式容器)`;createView 失败概率已极低,
  失败时捕获 state 回滚重建旧引擎视图,绝不留下「已销毁 view 存活在 ref」的状态。

## 失败回滚路径说明

- 目标 createView 抛错时:**若 signal 已 aborted(更新意图在飞)→ 不回滚**(避免
  旧引擎视图与更新意图的新视图同容器共存),按取消返回;否则 `try { 重建旧引擎
  view }`——成功:返回回滚视图(controller 同样回放),hook 保留旧引擎状态、
  console.error 原始错误、**不写引擎偏好**;失败:抛错,hook catch 清
  viewRef/setView(null),下次 switchEngine 从 viewRef=null 正常走(可重试)。
- 回滚视图以目标 style 重建(旧 view 样式契约不可读;回滚是罕见失败路径,
  「接近原状」即可,引擎对不支持样式自行降级)。

## 重入语义

- 两次快速切换,后发赢:第二击不再被丢弃——generation 递增 + 新意图置旧 signal;
  旧切换 load 阶段即放弃(旧 view 零触碰),createView 阶段已建视图销毁;resolve
  后 hook 再按代际校验,不匹配销毁结果;`isSwitching` 仅视觉指示(UI aria-disabled
  提示,不再拦截请求)。
- 残余窗口(已知,如实):在飞 createView 无法中止(厂商无 abortable API),TMap
  idle 3s 等待期间第二击到达时两视图短暂同容器叠加,旧意图 resolve 后自毁——
  **瞬态双实例,无永久双实例**;实测优先级:该窗口内第二击正常落地。

## 门禁结果

- npm test: **1076 通过 / 0 失败 / 2 skip**(基线 1034 + ws-1 契约扩展 34 + 本 WS 8)
- typecheck(`npm run typecheck`): 通过
- docs-check: **失败——基线红,非本批**:仅
  `tech/roles/development/parallel-sessions/20260821-boss-agent-thinkfix/merge-report.md:20`
  与 `20260821-boss-tencent-geocode/merge-report.md:17`(复述 grep 正则自匹配,dev
  早已存在,36ffa02/7c7acec 已并入);本 WS **零 .md 改动**
- git diff --check: 通过(含提交 diff `527e631..HEAD` 与工作树)

## 遇到的问题

- docs-check 基线红(上) → 需 boss 派 docs 修复批次或 docs-check 加
  `--exclude-dir=parallel-sessions`;与本批无关,不阻塞 ws-3。
- 方案 A 不可行(TMap 无 setContainer,且契约/三引擎在「不碰」清单)→ 方案 B,结论
  见上。

## 证据

- 定向:`node --test tests/map-engine-switch.test.mjs tests/hooks-contracts.test.mjs`
  → 21/21 pass(0 fail)
- 全量:`cd server && npm test` → 1076 tests / 1074 pass / 2 skip / 0 fail
  (duration ~5.3s);`npm run typecheck` 零错
- commits(3 个,均在 feature/engine-switch-lifecycle):
  - `a5b0178` fix(map-engine): 切换先就绪后销毁+失败回滚+signal 取消(switch.ts)
  - `9b4d36b` fix(map-engine): 切换最新意图优先 + 错误态清理 + view 状态化
  - `390aebb` fix(map-engine): 卸载恰逢切换 resolve 时销毁新 view(补 aliveRef 缺口)
- 分支基线 527e631(含 ws-1 契约扩展),未 merge、未 push

门禁: FAILED
结论: OK
