# WS-1: 收藏图层切换后 POI 全部消失 — 结构性修复

## 背景
用户报告:点按切换「收藏图层」后,地图上所有 POI 消失。
Explore 已定位根因(证据 file:line 见下)。这是 bug 修复,保持现有设计语义,不改 UI 设计。

## 任务
在 **/Users/acccan/dm-wt-saved-layer-toggle** 内完成修复(worktree 已预建,分支 `fix/saved-layer-toggle`,基于 dev b8da5d8)。
**不要 merge / 不要 push**,boss 统一合并。

## 根因证据(Explore,2026-08-22)

### 根因 #1(主因,必须修)
- 收藏开关 UI:`layers-panel.tsx:117-134`,接线 `map-shell.tsx:2324`(桌面)/ `map-shell.tsx:2703`(移动)。
- `useSavedLayer().toggle`:`use-saved-layer.ts:75-98`;打开时 `map.setBounds(收藏点外接框)`(`:87-97`),仅打开分支 `if (!next) return`(`:83`)。
- 抑制窗口是**时间窗补丁**:`use-work-viewport.ts:35`(500ms)/ `:241`(仅事件到达时刻检查);`use-saved-layer.ts:84-86` 注释自认是补丁。
- 失效链路:setBounds 动画 `moveend/zoomend` 晚到窗口外 → 视口刷新(`use-work-viewport.ts:171-209`)
  → 新视野(收藏区域)空批次 → `catalogRef.current=[]; setCatalog([])`(`:203-208`)
  → `markerPois` 坍缩(`map-shell.tsx:1292-1298`)→ `setPOIs([])` → `controller.clear()`
  逐个 `remove()` 全部 marker(`map-markers.ts:564-568 / 515-522 / 447-454`),**只删不建**。
- 引擎契约:AMap `remove=setMap(null)`(`amap-engine.ts:271-273`);BMapGL `remove()` 无 setMap(`baidu-engine.ts:407-409`);Tencent `remove=setMap(null)`(`tencent-engine.ts:419-420`)。

### 根因 #2(work 模式,判定后处置)
- `distanceOrigin = mapCenter`(`map-shell.tsx:1079-1089`),`workMarkerPois` pipeline 以新圆心 distance 过滤(`map-shell.tsx:1263-1288`);toggle 后圆心变收藏区域中心,radius 外全裁。

### 根因 #3(dev 专属,评估)
- Layers 面板 dynamic import(`map-shell.tsx:58`)→ disconnect/reconnect(`use-map-engine.ts:243-282`)→ `setView(null)` → `use-poi-map.ts:82-87` 销毁控制器摘全部 marker → 重连回放。

## 修复方向(boss 裁决,实现由你定,需自证正确)
结构性修复——使「收藏图层 toggle 引起的相机移动」不会触发视口刷新清空 catalog。候选(可组合):
- a) 把 setBounds 抑制从时间窗改为**事件/状态语义**(如 ref 标记「收藏同步中」,视口刷新跳过该次);
- b) 收藏 overlay 直接从收藏数据渲染,不依赖 catalog(收藏点不受视口批次影响);
- c) 空批次 ≠ 无数据:防止空批次把 catalog 置空,仅在真正搜索/视野变化时重建。
⚠️ **禁止只调时间常数(500ms→2000ms)的补丁。** 必须:打开收藏 → 动画期间任何事件 → POI 不消失;关闭收藏后视口刷新恢复正常。

## 文件边界(优先只碰这些;改其他文件需在汇报列理由)
- `server/src/hooks/use-saved-layer.ts`
- `server/src/hooks/use-work-viewport.ts`
- `server/src/components/map-shell.tsx`(相关段落)
- `server/src/hooks/use-poi-map.ts` / `server/src/components/map/map-markers.ts`(仅当根因判定需要)
- 对应单测文件(新增回归测试)

## 不做
- 不 merge / 不 push(worktree 由 boss 统一合并)
- 不改现有 UI 设计(布局/交互/视觉)
- 不跑 Env-only 步骤(import:seed:apply / geocode / db-up)
- 不 npm install / npm ci

## 门禁(全部通过才写 OK)
1. `cd /Users/acccan/dm-wt-saved-layer-toggle/server && npm run typecheck`
2. `cd /Users/acccan/dm-wt-saved-layer-toggle/server && npm test`(全绿;测试数以实际运行结果为准)
3. `cd /Users/acccan/dm-wt-saved-layer-toggle && make docs-check`
4. `git diff --check`
5. **新增/更新至少一个回归测试**:覆盖「收藏 toggle 后 catalog 不被空批次清空 / overlay 打开时 POI 不消失」或等价逻辑(jsdom 可测层)。

## 提交
小步 Conventional Commits(`fix: ...`),多提交 OK;提交前确认 worktree 内 `git status` 干净。

## 回报
写 **/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-toggle/reports/ws-1.md**:
- 改动摘要(每文件 1-2 行)
- 根因 #1 修复方式 + 为何是结构性的(不是时间窗补丁)
- 根因 #2 判定(预期 or 修了什么,理由)
- 根因 #3 判定(修 or 记录)
- 遇到的问题
- 门禁实际输出摘要(测试总数 pass/skip)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
