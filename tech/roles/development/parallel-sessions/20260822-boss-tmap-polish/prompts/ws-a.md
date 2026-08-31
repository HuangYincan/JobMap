# Workstream a — feature/tmap-poi(腾讯 POI 缩放/聚合 + 公司 icon)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-pa`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/reports/ws-a.md`(末两行 token,见文末)。

## 背景(用户真机反馈 2026-08-22 + boss 调查)

- **bug 1「poi 缩放与聚合没做好」**:城市聚合徽章/POI 在 TMap 上:聚合徽章是 HTML content(`map-markers.ts` 的 `.dm-cluster` div)→ TMap MultiMarker 不支持 HTML → 降级默认点(console: `[map-engine] TMap MultiMarker 不支持 HTML content,徽章降级为默认点`);POI zoom tier(LOD)/聚合分桶的 show/hide 在 TMap 上的可见性映射需核查
- **bug 6「公司 poi 样式需带公司 icon」**:公司 POI 的 icon(HTML/img)→ 同样被降级。契约 `icon: {src, size}` 已存在(ws-1),MultiMarker 路径已有 styleId 归组(`setStyles` 按 icon/offset 签名)—— 公司 icon 应走 `IconStyle({src, width, height})` 真图标路径

## 任务

### 1. 公司 POI icon 真图标(`tencent-engine.ts` MultiMarker 段)

- 核实现有 icon → styleId 归组实现:opts.icon 存在时,styleId 归组键应含 icon.src+size,`setStyles` 提供 `new this.tmap.IconStyle({ src, width, height })`(SDK 核实类名:`IconStyle`?或 `MarkerStyle` 内嵌 src)—— 目前如果 icon 被忽略/降级,补上
- 单点 Marker 路径(若 SDK 有):`setIcon({src, width, height})` 已有(L394-404),核实生效
- 契约行为不变:opts.icon 缺省 → 默认 pin;opts.icon 存在 → 真图标

### 2. 聚合徽章 TMap 渲染形态(`map-markers.ts` + `city-cluster.ts` 若需)

- 核实 createCityClusterMarker 在 TMap 的降级路径:HTML content → 默认点。目标:聚合徽章在 TMap 上以**可渲染形态**出现(带计数)
- 方向(核实后选):(a) 徽章内容经 `icon: {src}` 传**数据图**(Canvas 生成 count 徽章 → dataURL → IconStyle)—— 保持与 AMap HTML 徽章同视觉(白底圆角 + #007AFF 描边 + 城市名 + 计数);(b) TMap MultiMarker 若有 DOM content 支持(核实 v1.exp 是否只有 GL 文本标签 geometry.content)—— 若有文本标签路径则用 geometry.content(简单)
- 注意:`createCityClusterMarker` 返回句柄的 `remove()` 与可见性语义(ws-5 徽章清理契约)不得破坏
- zoom tier(LOD)的 setVisible 在 TMap 的实现(经 add/remove 摘挂 geometry):核实缩放边界(zoom≤8 聚合 / >8 个体)切换时 TMap 表现正确

### 3. 测试

- `server/tests/map-engine-tencent.test.mjs` 追加:icon 规格 → styleId 归组/setStyles 调用断言;聚合徽章在 TMap 的渲染形态断言(icon src 为 dataURL 或 content 文本);LOD 可见性摘挂断言
- 全量门禁见批次 README

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(**仅 marker/MultiMarker/icon/visible 段,勿碰 setStyle/scale/addControl/隐藏段**)、`server/src/lib/map-markers.ts`(聚合徽章 TMap 适配)、`server/src/lib/city-cluster.ts`(若需)、`server/tests/map-engine-tencent.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:ws-b 的 tencent 段(style/scale/addControl/hideControlDom)、`map-shell.tsx`、`map-shell.module.css`、`switch.ts`、`use-map-engine.ts`、三引擎其他文件、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-pa/server && npm test`(基线 1128 零漂移 + 新增)
2. `cd /Users/acccan/dm-wt-pa/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-pa && make docs-check`、`git diff --check`
4. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/reports/ws-a.md`:icon 归组实现与 SDK 核实记录、聚合徽章 TMap 渲染方案(选型依据)、LOD 可见性核查结果、测试用例。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
