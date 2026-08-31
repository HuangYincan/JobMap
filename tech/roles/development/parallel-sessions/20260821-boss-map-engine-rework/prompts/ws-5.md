# Workstream 5 — feature/engine-search-cleanup(搜索引擎化 + 清理 + 验证)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-rw5`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-5.md`(末两行 token,见文末)。

## 背景(轮 1-2 已合入:契约扩展 + 控制器引擎无关化;轮 3-4 已合入:切换生命周期 + 层级)

收尾三项 + **全面验证**。

## 任务

### 1. domain 搜索引擎化(`server/src/lib/poi-service.ts`)

- 诊断:关键词回退硬绑 `amap-api.searchPOI`(L154),与 `viewportFallbackSearch`(L48-91,已引擎 provider 化)不同口径
- 修复:关键词回退改走活跃引擎 `activeSearchProvider.searchPOI`(与视口兜底同口径);`amap-api.searchPOI` 保留为无 provider 时的回落(与现有逻辑一致)
- 核实 L42-46 的 provider 注入机制,保持一致

### 2. 聚合徽章清理(`server/src/components/map-shell.tsx`)

- 诊断:聚合徽章清理(L1343-1351)调 `marker.setMap(null)` — BMapGL 无 setMap → 静默 no-op → 跨 zoom 分桶切换旧徽章泄漏叠图
- 修复:改用 `createCityClusterMarker` 返回句柄的 `remove()`(或统一走契约 remove;核实返回形态)——与 POI marker 清理(ws-2 已契约化 remove)同口径
- 只动该行段,不碰其他

### 3. 全面验证(本 WS 特有,验收级)

离线验证(可做尽做):
- 三引擎 marker 生命周期测试贯通:创建 → setZIndex/setVisible/on/off → remove(用 engine-mock 断言三引擎语义一致)
- 切换失败回滚 + 重入取代 + 层级隔离 CSS 断言合并后的整体测试(跑全量 `npm test`)
- **契约 grep**:map-shell/map-markers/poi-service 不再出现 `setMap(null)` 直调裸实例、`wrapper.raw` 直操、AMap 专属 API 应用于非 AMap

真实验证(若环境允许,必做并记录;不允许则如实报告 + 记 deferred #1 依赖 key):
- `npm run dev` + 用户已配 key(高德/百度),切三家:
  - 默认高德(会话级偏好已改,新会话回落高德)
  - 高德→腾讯:地图渲染、控件不遮挡、POI 出现、可点、来回切 3+ 次不卡死不丢 POI
  - 高德→百度:同
  - 徽章/聚合:work 模式公司 POI 徽章、城市聚合在腾讯(MultiMarker 降级)/百度(HTML 徽章)的表现
- 结果逐项记录到汇报(通过/失败/现象),失败项给出复现步骤

## 文件边界

- 只允许改:`server/src/lib/poi-service.ts`、`server/src/components/map-shell.tsx`(**仅聚合徽章清理行段,勿碰其他**)、`server/tests/`(贯通测试)、`tech/23-map-engines.md`(验证结果回填,仅追加)
- **不碰**:`map-markers.ts`、三引擎、`types.ts`、`switch.ts`、`use-map-engine.ts`、`map-shell.module.css`、`amap-api.ts`、`server/docs/`、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-rw5/server && npm test`(全量,含合并后基线 + 本 WS 新增)
2. `cd /Users/acccan/dm-wt-rw5/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-rw5 && make docs-check`(基线红如实报告)、`git diff --check`
4. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-5.md`:**全面验证结果表**(每项通过/失败/现象/复现步)、验证方式(离线/真实)、搜索引擎化与聚合清理改动、回填 tech/23 摘要。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```