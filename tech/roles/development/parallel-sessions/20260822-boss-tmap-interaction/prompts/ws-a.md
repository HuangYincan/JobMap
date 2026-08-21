# Workstream a — fix/tmap-poi-interaction(腾讯 POI 失效 + 缩放偏移)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-ia`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-a.md`(末两行 token,见文末)。

## 背景(用户真机反馈 + boss 调查线索)

**bug 1「POI 失效且随视角缩放偏移」**:
- 偏移线索:`tencent-engine.ts` L39-41 注释「MarkerStyle 仅图片 src,anchor 是唯一像素偏移(imageTopLeft = 屏幕位 - anchor)」+ L96-97「anchor 默认 (width/2, height)=(17,50);style.offset 渲染器不消费」—— dataURL 聚合徽章/公司 icon 的**实际尺寸与 anchor 不匹配**(如 60×60 徽章用默认 17,50 anchor)→ 锚点错位;缩放级别变化时像素偏移与地图比例不联动 → 视觉漂移
- 失效线索:MultiMarker 单实例 click 按 e.geometry.id 过滤分发(ws-1 模式)—— 拾取失效可能因 anchor 错位(点击命中区 ≠ 视觉位置)或 LOD 摘挂(add/remove)后的拾取状态

## 任务

### 1. anchor 正确化(tencent-engine.ts MultiMarker 段)

- 核实 SDK MarkerStyle 的 anchor 语义与默认值(源码/文档:anchor 是否按 icon 尺寸归一化?)
- 修复:每个 styleId 的 anchor 按 icon 实际尺寸计算(如 dataURL 徽章 60×60 → anchor (30,30) 或按 AMap content 语义底部居中 (30,60)?)—— 与高德 marker 的视觉锚点语义对齐(高德 content 的锚点是底部中心,聚合徽章/POI pin 都钉在地理点上)
- 契约 offset 语义保持(若 offset 也被用于锚点调整,核实合并规则)
- **验收标准**:缩放 2 个级别前后,marker 视觉位置钉在同一地理点(不漂移);点击 marker 视觉本体能命中

### 2. 点击拾取修复

- 核实单实例 click 分发链路:on('click') → e.geometry.id → 契约 cb;LOD 摘挂(add/remove)后 id 是否残留/重复(remove 不销毁 geometry?add 时 id 冲突?)
- 修复拾取失效根因(anchor 或摘挂状态);补充点击命中测试(mock 事件 e.geometry.id 分发)

### 3. 测试

- `server/tests/map-engine-tencent.test.mjs` 追加:anchor 计算断言(按 icon 尺寸)、LOD 摘挂后 click 分发断言、缩放后位置一致性断言(纯函数级)
- 全量门禁见批次 README(基线 1212)

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(**仅 marker/MultiMarker/anchor/click 段**)、`server/src/lib/map-markers.ts`(LOD/聚合相关,若需)、`server/tests/map-engine-tencent.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:ws-b 的相机/构造段、`switch.ts`、`use-map-engine.ts`、`map-shell.tsx`、`map-shell.module.css`、其他引擎、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-ia/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-ia && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-a.md`:anchor 核实结论(SDK 语义)、修复实现、拾取链路核查、测试。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
