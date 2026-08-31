# Workstream b-marker-wiring — usePOIMap 接线 + 聚合徽章 engineView + 文档更新

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-b-marker-wiring`,分支 `fix/poi-marker-wiring`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**;合并与推送由 boss 统一做。先看 `git log --oneline -3` 确认起点。

## 背景(根因已由 Explore 确认)

1. a-marker-core(并行,先合并)会给 `POIMarkerController` 新增:`setPOIs(pois, opts?: { replace?: boolean; retainIds?: Iterable<string> })`(replace=true 时销毁池外 id,retainIds 恒保留)、`sync()`(完整性扫描,isAttached===false 的 marker 自动补回)、`MapMarker.isAttached?()` 契约字段。**本 WS 消费这三者,不得改 map-markers.ts / map-engine/types.ts / 引擎适配层,不得另起名。** 若你开工时它们尚未落入分支,按上述签名写(这是既定契约)。
2. **聚合徽章切引擎不重建**:map-shell.tsx:1455-1491 cluster effect 依赖 `[clusterState, mapReady, modeConfig.color]` + 内部用 `mapInstance.current`(ref)。切引擎时三者均不变 → 徽章随旧 view 销毁后不重建(tech/23-map-engines.md:750-758 已记录为遗留,修复建议即「依赖加 engineView」)。
3. **Domain 视口替换需要 replace 接线**:map-shell markerPois memo(:1423-1429,domain = `mergeMapPois(pois, overlayPois, savedOverlay && Boolean(user))`)→ usePOIMap(:1688-1693)→ applySync(use-poi-map.ts:45-58)→ setPOIs。当前只增不删 → 旧视口 marker 永久累积。接线后:domain 同步用 replace,收藏 overlay id 恒保留。
4. usePOIMap 现在只在 `[view, accentColor]` 变化时显式重建(use-poi-map.ts:82-107),无状态变化时被外部删除的 marker 无人补回 → 需要轻量周期性/事件触发。

## 任务(仅本 WS 范围)

### 1. `server/src/hooks/use-poi-map.ts`

- `UsePOIMapOptions` 新增:`replacePOIsOnSync?: boolean`(默认 false)、`retainPOIIds?: Iterable<string> | null`(默认 null)。
- `applySync`(:45-58):`controller.setPOIs(pois)` → `controller.setPOIs(pois, { replace: opts.replacePOIsOnSync ?? false, retainIds: opts.retainPOIIds ?? [] })`(写成带 opts 的一次调用;顺序保持 setPOIs → setVisiblePOIs → select/deselect → highlight/unhighlight);**applySync 末尾追加 `controller.sync()`**(每次同步顺带完整性补回)。
- **无状态变化的自动补回**:在创建控制器的 effect(:82-107)里挂一个轻量补回触发——优先用 `view` 契约(server/src/lib/map-engine/types.ts MapView)上的可用事件(moveend/zoomend 之类,读契约确认有哪些 on/off 或 addListener;若契约无事件 API,退化为 ~5s 间隔的 interval sweep);cleanup 里与 controller.destroy() 一起解绑/clear。要求:`sync()` 在该触发下执行,销毁后不再触发。

### 2. `server/src/components/map-shell.tsx`

- **cluster effect 依赖数组**(:1491)加入 `engineView`(该变量已从 useMapEngine 解构,:272)。effect body 用 `mapInstance.current`(:1456)——确认 :602-632 的 `mapInstance.current = engineView` 效果(依赖 [engineView])先于本 effect 执行(同 commit 内按声明序);若存在竞态风险(如 mapInstance.current 尚未更新),改为 effect body 直接用 `engineView ?? mapInstance.current` 并读代码确认行为一致。
- **usePOIMap 调用点**(:1688-1693):domain 模式(`canonicalMode(mode) === 'domain'`)传 `replacePOIsOnSync: true`;work 模式不传(默认 false,workMarkerPois 语义不变)。`retainPOIIds`:传入**收藏层 overlay 的 id 集合,且即使当前 savedOverlay 关闭/用户未登录也要保留最近一次已知的 overlay id**(用 ref 记住 lastOverlayIds,避免收藏层切换时被 replace 销毁——已有语义「marker 实例保留不销毁,秒恢复零重查」(:1500/:1509-1510)必须保持)。
- 更新相关注释(:1500 附近「离开 marker 池的 id → 隐藏,不销毁」→ 说明:池外 id 在 replace 语义下销毁,retainIds(收藏 overlay)除外;LOD/聚合/个体 pin 仍在池内,不受影响)。
- 确认 `visiblePOIIds`/`mutexVisibleIds` 逻辑与 replace 组合无回归(它们只切 show/hide,不销毁)。

### 3. 文档

`tech/23-map-engines.md` 约 :750-758 的「⚠ 遗留」记录更新为**已修复**:cluster effect 依赖已加 engineView,切引擎后徽章在新 view 重建;保留「MapShell 主链路不传 replayController(usePOIMap 随 view 重建 + sync 补回覆盖)」的现状说明(如文中 :736-740 已有则保留)。

### 4. 测试

- `server/tests/hooks-contracts.test.mjs`(现 :170-174 断言 `usePOIMap(engineView, {` 保持):新增契约断言——applySync 中 `setPOIs(` 调用含 `replace` 键、含 `sync()` 调用;或等价源码级断言(遵循该文件现有断言风格)。
- cluster 相关契约(city-cluster.test.mjs / component-contracts.test.mjs 若已有类似断言):补「cluster effect 依赖含 engineView」的契约断言;现有断言全保持。
- 跑既有测试确认无回归(尤其 marker-visibility / marker-leak / map-engine-switch / hooks-contracts / component-contracts)。

## 文件边界

**拥有**:server/src/hooks/use-poi-map.ts、server/src/components/map-shell.tsx、tech/23-map-engines.md、tests/{hooks-contracts,component-contracts,city-cluster,map-engine-switch}.test.mjs。

**不碰**:server/src/lib/map-markers.ts、map-engine/{types,amap,tencent,baidu}/** 适配层、server/src/hooks/use-work-viewport.ts、server/src/lib/viewport-search.ts、server/src/lib/poi-service.ts、server/src/app/api/**、server/src/lib/search.ts。

## 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-b-marker-wiring/server && npm test
cd /Users/acccan/dm-wt-b-marker-wiring/server && npm run typecheck
cd /Users/acccan/dm-wt-b-marker-wiring && make docs-check && git diff --check
```

注意:提交前若 a-marker-core 的分支已合并进 dev,先 `git merge dev` 拉取其实现再验证;未合并则按上述契约签名实现(消费方写法不变)。

## 提交

小步高频,Conventional Commits(`feat(poi-map): replace sync + integrity triggers`、`feat(map-shell): cluster effect engineView dep + domain replace wiring`、`docs(map-engines): cluster badge rebuild fixed`、`test(...)`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-poi-marker-resilience/reports/b-marker-wiring.md`,含改动摘要、门禁结果、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
