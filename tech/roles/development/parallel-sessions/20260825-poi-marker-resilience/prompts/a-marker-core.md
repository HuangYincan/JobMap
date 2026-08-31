# Workstream a-marker-core — POI marker 控制器:replace 语义 + 完整性自动补回

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-a-marker-core`,分支 `fix/poi-marker-autorestore`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**;成果提交到本 worktree 分支即可,合并与推送由 boss 统一做。先看 `git log --oneline -3` 确认起点,然后开工。

## 背景(根因已由 Explore 确认)

1. **核心 bug —「检测删除后自动补回」缺失**:`POIMarkerController`(server/src/lib/map-markers.ts,类定义 :673)是「只增不删」登记簿:`markers: Map<string, MapMarker>`(:678)+ `placed: Set<MapMarker>`(:684,兜底簿记防泄漏);`setPOIs` 非空列表只 add+setPosition(:978-995),离开新列表的旧 id 什么也不做;`removeMarker`(:921)只被 `clear()`/`destroy()` 调用。全 src 无厂商侧删除的被动检测(无 remove 事件监听、无 isAttached/getMap 检查)——若厂商 overlay 被外部删除而 React 的 pois 引用不变,控制器不会发现缺失,也不会补回。
2. **视口 marker 累积需要「全量替换」语义**:Domain 视口刷新时 useWorkViewport 传 `existing: []` 整体换 catalog,但 setPOIs 只增不删,旧视口 marker 只被 setVisiblePOIs 隐藏、永久累积。修复方向:setPOIs 支持 replace 模式(池外 id 销毁),只对收藏 overlay(retainIds)保留「只隐藏不销毁」。

## 任务(仅本 WS 范围)

### 1. `server/src/lib/map-markers.ts` — setPOIs replace 模式

`setPOIs(pois, opts?: { replace?: boolean; retainIds?: Iterable<string> })`:
- **默认行为完全不变**(不传 opts):只增不删,现有全部语义与测试保持。
- `replace: true`:在 add/update 遍历完成后,对 `markers` 中**不在新列表、也不在 retainIds** 的 id 逐个 `removeMarker`(与 clear 同路径,并同步清理 placed/poiById/markerStates 等簿记——读清类实现再动,保持两簿记一致)。保留的 id(新列表 + retainIds)行为与现状一致:update 存量、applyStyle、maybeUpgradeIcon。
- `retainIds`:replace 时绝不销毁的 id 集合(收藏 overlay 层)——即使不在新列表也保留实例(隐藏与否由 setVisiblePOIs 决定)。

### 2. `server/src/lib/map-markers.ts` — `sync()` 完整性自动补回

新增公开方法 `sync(): void`(接口 `POIMarkerController` :43-69 同步加签名):
- 遍历 `markers`(及 `placed` 兜底簿记)中每个 marker,凡 `marker.isAttached?.() === false`(或明确等于 false;undefined = 不支持探测则跳过)→ **重新 add**:按 `poiById`/`markerStates` 保留原状态重建(图标 kind emoji/logo/local、位置、click 回调),重建后必须遵守当前 `visibleIds`(null=显示,否则按集合 hide)、`selectedId`/`highlightedId`;重建成功的实例替换进 markers,placed 簿记同步修正。
- 语义要求:**幂等、O(n)、不触发厂商动画/重排,失败静默跳过**(地图销毁等场景不抛)。
- 注意:本文件有契约测试「不得出现 AMap 专属 API」「`.raw` 出现次数 = 2」——探测一律走契约方法 `isAttached?.()`,**不得本文件内新增 `.raw` 用法**。

### 3. 引擎契约 + 三适配 — `MapMarker.isAttached?(): boolean`

- `server/src/lib/map-engine/types.ts` `MapMarker` 接口(:73-87)新增可选字段 `isAttached?(): boolean`,注释语义:「厂商侧是否仍挂在地图/共享层上(被外部删除时返回 false;不支持探测的引擎可省略)」。
- 三引擎适配层实现(文件位置以实际为准,server/src/lib/map-engine/{amap,tencent,baidu}/ 下;Explore 定位:amap-engine.ts:230+ 契约包装、tencent-engine.ts:647 已有 getMap 包装、baidu-engine.ts:1125):
  - AMap:marker 实例 `getMap()` 是否为真(AMap.Marker.getMap 语义;适配层确认实例上可用,若不可用则用适配层自身可判定的挂载状态)。
  - Tencent:共享 MultiMarker 场景读适配层已有的 attached 状态(tencent-engine.ts:647 的 `getMap`/attached 标志),暴露为 isAttached。
  - Baidu:BMapGL marker 的 getMap 或适配层可判定的挂载状态(worker 读代码确认,不许瞎猜)。
- 探测失败(undefined)时 sync 跳过该 marker——兼容性优先。

### 4. 测试

- `server/tests/fixtures/amap-mock.mjs`:MockMarker 补 `getMap()`(挂载=返回 map,外部移除=null)与模拟外部移除的手段(如 `mockDetach()` 或 map 侧 remove),让测试能模拟「厂商侧删掉 marker」。
- `server/tests/map-markers.test.mjs`、`marker-visibility.test.mjs`、`marker-leak.test.mjs`:
  - **新增**:① replace 模式:池外 id 被销毁、retainIds 保留(实例仍在、可再 show)、存量/选中/高亮状态保持;② 外部移除(模拟 getMap→null)→ `sync()` 重新 add 且状态(图标/可见性/selected)保持;③ isAttached 契约在 mock 上的行为。
  - **保持**:所有现有用例(默认 patch 模式行为被既有测试固化,不许破坏;`marker-leak` 的「往返计数单调不减」针对默认模式,仍须绿)。

## 文件边界

**拥有**:server/src/lib/map-markers.ts、server/src/lib/map-engine/types.ts、map-engine {amap,tencent,baidu} 适配层、tests/fixtures/amap-mock.mjs、tests/{map-markers,marker-visibility,marker-leak}.test.mjs。

**不碰**(其他 WS 拥有,改了他们冲突):server/src/hooks/use-poi-map.ts、server/src/components/map-shell.tsx、server/src/lib/map-engine/switch.ts、server/src/hooks/use-work-viewport.ts、server/src/lib/viewport-search.ts、server/src/lib/poi-service.ts、server/src/app/api/**、server/src/lib/search.ts、tech/23-map-engines.md。

消费方(b-wiring)将依赖你定义的:setPOIs opts 签名、`sync()`、`isAttached?()`——保持这三个名字与语义稳定。

## 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-a-marker-core/server && npm test
cd /Users/acccan/dm-wt-a-marker-core/server && npm run typecheck
cd /Users/acccan/dm-wt-a-marker-core && make docs-check && git diff --check
```

如门禁失败:修到绿;若评估为「测试固化旧行为需更新测试」,只有在语义确实按本 prompt 改变时才改,并在汇报「遇到的问题」写明理由。

## 提交

小步高频,Conventional Commits(如 `feat(marker): setPOIs replace mode + retainIds`、`feat(marker): sync() integrity repair + isAttached contract`、`test(marker): replace/sync/heal cases`)。完成后一次性 `git add -A && git commit`(若已多次提交则无需再提交)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-poi-marker-resilience/reports/a-marker-core.md`,含:改动摘要(文件+要点)、门禁结果(贴命令与关键输出计数)、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

若阻塞:`结论: BLOCKED: <一句话问题>`,并说明卡点。
