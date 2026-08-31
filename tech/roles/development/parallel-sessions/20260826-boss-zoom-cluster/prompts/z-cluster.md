# Workstream z-cluster — 聚合边界用真实 zoom 判定(点 marker 后一批个体 POI「消失」)

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-z-cluster`,分支 `fix/zoom-cluster-boundary`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(boss 已定位根因,用户反馈:「点击 poi 后 poi 会消失」)

用户(桌面)点击地图 POI marker 后,**一批 POI 从地图消失**。

### 根因链

1. **zoom 取整存 state** — `server/src/components/map-shell.tsx:847-849`:
   ```js
   const offZoomChange = view.on("zoomchange", () => {
     const currentZoom = view.getState().zoom;
     setZoom(Math.round(currentZoom));   // ← 取整
   });
   ```
2. **聚合判定用 round 后的 state** — `server/src/lib/map-markers.ts:547-549`:
   ```js
   export function clusterZoomForZoom(zoom: number): number {
     if (!Number.isFinite(zoom)) return CLUSTER_MAX_ZOOM + 1;
     return zoom <= CLUSTER_MAX_ZOOM ? Math.floor(zoom) : CLUSTER_MAX_ZOOM + 1;
   }
   ```
   `map-shell.tsx:1451` `const clusterZoom = clusterZoomForZoom(zoom)`(zoom = state,已 round);`clusterState` useMemo 依赖 clusterZoom,聚合条件 `zoom <= CLUSTER_MAX_ZOOM(8)`。

3. **误判**:real zoom `8.4`(个体区间,>`8`)被 round 成 `8` → `clusterZoomForZoom(8)` → `8 <= 8` → **聚合**。real `8.6` round `9` → 个体。即 **real 8.1~8.5 被误判为聚合,8.6+ 才个体** —— 边界不一致。

4. **点 marker 触发跨边界**:点 marker → `setRailPanel("explore")` + `setDetailPoi(poi)` → detail/explore 面板打开 → **地图容器宽度变化** → AMap 自适应 zoout(resize 处理)→ `zoomchange` → real 从 ~8.6 降到 ~8.4 → state round `9→8` → `clusterState` 从个体切到聚合 → **个体 marker 全部隐藏,变城市聚合徽章 → 用户看到「一批 POI 消失」**。

> 触发前提:用户 zoom 在 8~9 边界(城市放大看个体的常见区间,fan-out 后 POI 多更常见)。seed-city / fan-out 修复后聚合能正确收 seed 站,个体也更多,边界更易踩中。

### 关键语义(city-cluster.ts 注释)

- `CLUSTER_MAX_ZOOM = 8`:`zoom <= 8 启用聚合,>8 切回个体`(用户批准阈值,tech/21)。
- 聚合区间计数与 zoom 无关(2026-08-20 修订);个体区间全量显示(LOD 已取消,2026-08-25)。
- 分桶记忆化(b2):聚合状态依赖整数 zoom;`clusterZoomForZoom` 聚合区间返回 `floor(zoom)`(分桶常数),个体区间返回 `CLUSTER_MAX_ZOOM + 1`(恒 9)。

## 任务

### 核心修复:聚合/个体边界用「真实 zoom」判定,而非 round 后的 state

**目标**:real 8.4 必须是个体(>,8);只有 real ≤ 8 才聚合。点 marker 引起的容器 resize→zoout 只要 real 仍 >8,就**不**切换聚合。

### 1. 引入真实 zoom(不改 round 的既有用途,除非必要)

- `map-shell.tsx`:zoomchange 时**额外保存真实 zoom**(如 `setRealZoom(currentZoom)` 或 `realZoomRef.current = currentZoom`),state `zoom` 可保留 round(供其它需取整处用)或改为 real(视用途)。
- 聚合判定(`clusterZoom` / `clusterState` useMemo)改用**真实 zoom** 判断:`realZoom <= CLUSTER_MAX_ZOOM ? Math.floor(realZoom) : CLUSTER_MAX_ZOOM + 1`(分桶仍 floor)。
- **审查**:`maxTierForZoom`(map-shell 传 `/api/pois` 的 maxTier)仍用 state zoom?LOD 客户端过滤已取消(2026-08-25),确认 server 端 maxTier 是否还需要 / 用 floor 语义;若 `maxTier` 传参处因改 state 受影响,一并修正(用 floor(realZoom) 保持「tier <= floor(zoom)」语义)。改前先 `grep` 看清楚所有 `zoom` state 消费点,别破坏分桶记忆化(依赖整数分桶)。

### 2. `clusterZoomForZoom` 语义注释/实现同步

- 若其输入改为 real zoom,更新注释(输入 real;聚合判定 real<=8;分桶 floor(real))。
- 保持 `CLUSTER_MAX_ZOOM + 1` 个体哨兵语义不变。

### 3. 测试(风格跟随 city-cluster.test.mjs / map-markers 测试)

- `clusterZoomForZoom(8.0)` → 8(聚合);`clusterZoomForZoom(8.1)` → 9(个体哨兵);`(8.4)` → 9;`(8.6)` → 9;`(7.9)` → 7(聚合分桶);`(0)` → 0。
- **边界回归**:**8.4 必须个体**(当前实现返回 8 = 聚合,需修复为个体)—— 这是本 bug 的核心断言。
- 若 maxTierForZoom 逻辑变动,补对应断言。
- 全量门禁。

### 4. 文档

- `tech/21-city-clustering.md`(聚合阈值/边界):补一句「聚合/个体边界用真实 zoom 判定(2026-08-26 fix/zoom-cluster-boundary),缩放 8.1~8.5 保持个体,不被取整误判聚合;容器 resize(点 marker 开面板)引起的 zoom 微降不触发聚合切换」。

### 5. 门禁(必须真跑)

```bash
cd /Users/acccan/dm-wt-z-cluster/server && npm test
cd /Users/acccan/dm-wt-z-cluster/server && npm run typecheck
cd /Users/acccan/dm-wt-z-cluster && make docs-check && git diff --check
```

## 文件边界

**拥有**:`server/src/components/map-shell.tsx`、`server/src/lib/map-markers.ts`(clusterZoomForZoom)、`server/src/lib/lod.ts`(如 maxTier 语义需同步)、`server/tests/{city-cluster,marker-visibility}.test.mjs`(按需)、tech/21。

**不碰**:`server/src/lib/{city-cluster,spatial-query,recruitment-*,server-catalog,mode-cache}.ts` 其它逻辑、`server/data/**`、crawler/**、`.env*`、主树。

## 提交

Conventional Commits(`fix(map-shell): 聚合/个体边界用真实 zoom 判定 — 点 marker 容器 resize 不再误切聚合`、`test(cluster): 8.4 边界保持个体回归用例`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260826-boss-zoom-cluster/reports/z-cluster.md`,含改动摘要、**边界测试结果(重点 8.4 个体)**、门禁结果、遇到的问题、结论。末两行:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
