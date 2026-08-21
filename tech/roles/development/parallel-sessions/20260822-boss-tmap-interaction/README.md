# 批次 20260822-boss-tmap-interaction — TMap 交互修复 + 切换状态一致性 + 百度诊断

## 目标

用户真机反馈 4 个 bug(2026-08-22):

1. **腾讯地图下 POI 失效且会随视角缩放偏移** — marker 点击无响应 + 缩放时 marker 视觉偏移
2. **鼠标中间滚动视角不丝滑** — TMap 滚轮缩放卡顿/跳变
3. **百度还是加载不了** — 用户端百度仍无法加载(boss 环境 Playwright 实测正常,bmapPresent=true 渲染成功 —— 排除代码回归,指向用户环境:缓存旧 bundle / 访问 URL 非 localhost:3000 / dev server 未重启)
4. **从腾讯换回高德后原本有的 poi 都消失了** — 引擎切换回高德后 POI 丢失(boss 在 domain 模式复现未果(1574 蓝像素正常),疑似 work 模式公司 POI 路径或时序问题)

## 根因调查线索(boss)

- **bug 1 偏移**:tencent-engine.ts 注释(L39-41):「MarkerStyle 仅图片 src,anchor 是唯一像素偏移(imageTopLeft = 屏幕位 - anchor)」+ L96-97:「anchor 默认 (width/2, height)=(17,50);style.offset 渲染器不消费」—— dataURL 徽章/公司 icon 的尺寸与 anchor 不匹配 → 缩放时视觉偏移(anchor 像素偏移在地图比例变化下表现为漂移)。**LOD zoom tier 摘挂(add/remove 按 id)在 TMap 上的状态一致性需核查**(remove 后重 add 的 id/样式残留)
- **bug 1 失效**:MultiMarker 单实例 click 按 e.geometry.id 过滤分发(ws-1 模式)—— 拾取失效可能与 anchor 偏移(点击命中区与视觉位置不一致)或 hidden marker 摘挂后的拾取状态有关
- **bug 2 滚轮**:TMap GL Map 构造选项 `smoothWheelZoom`(SDK 核实存在与否;默认值;true 时滚轮平滑动画)—— 当前未配置
- **bug 4 切回丢失**:引擎切换回放(replay:POI 集/可见性/选中态)在 高德←→腾讯 双向的对称性;work 模式公司 POI 的 LOD/可见性状态在切换回放后是否恢复(AMap 侧 marker 可见性 = show/hide;腾讯侧 = add/remove 摘挂 —— 回放时可见性语义映射是否丢)

## Workstream 表

| ws | 分支 | 主题 | 拥有文件 | 不碰 |
|---|---|---|---|---|
| a | fix/tmap-poi-interaction | bug 1:POI 失效 + 缩放偏移 | `tencent-engine.ts`(**marker/MultiMarker/anchor/click 段**)、`map-markers.ts`(LOD/聚合相关)、`server/tests/map-engine-tencent.test.mjs` | ws-b 的相机/滚轮段、map-shell 全部 |
| b | fix/tmap-wheel-switch | bug 2+4:滚轮平滑 + 切回 POI 消失 | `tencent-engine.ts`(**Map 构造/相机/滚轮段**)、`switch.ts`/`use-map-engine.ts`(回放状态一致性)、`map-shell.tsx`(若需)、`server/tests/map-engine-switch.test.mjs` | ws-a 的 marker 段 |
| c | fix/baidu-diagnostics | bug 3:百度加载失败诊断 + 防御 | `baidu-engine.ts`(加载失败路径)、`use-map-engine.ts`(错误可见化)、`server/tests/map-engine-baidu.test.mjs` | 腾讯/高德、map-shell 设计 |

**tencent-engine.ts 段切分**:ws-a = createMarker/MultiMarker/anchor/click(约 L240-650);ws-b = Map 构造选项/相机/滚轮(约 L120-240 + 相机方法)。以函数为单位互不侵入。

## 合并顺序

轮1: ws-a、ws-b、ws-c 并行 → 按 a → b → c 合并 → push。

## 门禁(每 WS)

- `cd <wt>/server && npm test`(基线 1212 零漂移 + 新增)、`npm run typecheck`
- `cd <wt> && make docs-check`、`git diff --check`
- 小步 commit(Conventional Commits)

## 纪律

- 进程内 worker 通道;**若中途 API 402 中断:直接退出说明进度,boss 会原地恢复,已 commit 不重做**
- 不 merge、不 push、不切分支、不碰主树、不 npm install、不改现有 UI 设计
- 汇报末两行 token:`门禁: PASSED|FAILED` / `结论: OK|BLOCKED: <一句话>`
