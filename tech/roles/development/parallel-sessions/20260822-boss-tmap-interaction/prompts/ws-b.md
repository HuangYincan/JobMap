# Workstream b — fix/tmap-wheel-switch(滚轮平滑 + 切回 POI 消失)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-ib`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-b.md`(末两行 token,见文末)。

## 背景(用户真机反馈 + boss 调查线索)

**bug 2「鼠标中间滚动视角不丝滑」**:TMap GL 滚轮缩放卡顿/跳变 —— 疑似 Map 构造选项 `smoothWheelZoom` 未启用(或 SDK 默认禁用)。核实 SDK 支持的滚轮平滑选项(源码/文档),启用后与高德滚轮体验对齐。

**bug 4「从腾讯换回高德后原本有的 POI 都消失了」**:引擎切换回放(replay)链在 高德←→腾讯 双向的一致性。boss 在 domain 模式复现未果(切回高德蓝像素 1574 正常),**疑似 work 模式公司 POI 路径或时序**:公司 POI 的 LOD/可见性状态在切换回放后是否恢复(AMap 侧可见性 = show/hide;腾讯侧 = add/remove 摘挂 —— 回放时可见性语义映射是否丢失);或切换后 POI 重建依赖 moveend/视口事件,切回后未触发(等待超时未对齐)。

## 任务

### 1. 滚轮平滑(tencent-engine.ts Map 构造/相机段)

- 核实 TMap GL `smoothWheelZoom`(或等价)构造选项:Sdk 源码/文档;启用方式(构造传参?或运行时 setOption?)
- 启用滚轮平滑,与高德滚轮体验对齐(平滑动画、无跳变)
- 测试:mock 断言构造选项含平滑配置

### 2. 切回高德 POI 消失(switch.ts / use-map-engine.ts 回放一致性)

- 核查切换回放链:switchEngine 的 replay(视口 POI 集/可见性/选中态)在 from=腾讯 → to=高德 方向是否完整(对比 高德→腾讯 方向);**可见性语义映射**:map-markers 的 LOD/聚合 show-hide 状态在腾讯(摘挂)与高德(show/hide)间的回放映射
- work 模式公司 POI:核实 work 视口加载器(use-work-viewport)在引擎切换后的重建触发条件(依赖 moveend?切换后是否触发?)—— 若切换后不触发视口对齐,POI 不加载
- 修复缺失环节;补切换回放测试(双向对称性断言)

### 3. 测试

- `server/tests/map-engine-switch.test.mjs` 追加:双向回放对称性、可见性语义映射、work 视口重建触发
- 全量门禁见批次 README(基线 1212)

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(**仅 Map 构造/相机/滚轮段**)、`server/src/lib/map-engine/switch.ts`、`server/src/hooks/use-map-engine.ts`、`server/src/hooks/use-work-viewport.ts`(若需)、`server/tests/map-engine-switch.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:ws-a 的 marker 段、`map-markers.ts`(ws-a 拥有)、`map-shell.tsx`、`map-shell.module.css`、其他引擎、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-ib/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-ib && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-b.md`:滚轮平滑核实与启用方式、回放链核查结论(双向对称性/可见性映射/work 视口触发)、修复、测试。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
