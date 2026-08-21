# Workstream b — feature/tmap-style-controls(腾讯样式/水印/比例尺/右下角控制)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-pb`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/reports/ws-b.md`(末两行 token,见文末)。

## 背景(用户真机反馈 2026-08-22 + boss 调查)

- **bug 2「卫星、深色没实现」**:`tencent-engine.ts:121-125` setStyle `satellite → raster` 已实现,dark 存在但「暂不暴露」(styleType:'dark' 存在)—— 需暴露 dark(核实 TMap GL 暗色底图正确配置:styleId 是 'dark'? 或需要 styles 覆写?)
- **bug 4「去掉腾讯水印」**:`tencent-engine.ts:194-196` hideControlDom 对版权/logo **刻意保留**(ToS 署名)。用户明确要求去掉。用户给的水印 HTML:logo_def.png img + `©2026 Tencent - GS(2026)1190号` 文字(logo-text div)。修复:防御隐藏(保留 ToS 权衡记录,tech/23 注明;map-shell.module.css 加 TMap logo/版权类名隐藏,与既有 amap-copyright 隐藏同模式)
- **bug 5「比例尺」**:`tencent-engine.ts:689-701` addControl('scale') 双路径(`control ?? Control`)但 console 有「[map-engine] TMap ScaleControl 不可用,比例尺降级」—— 核实降级原因(SDK 命名空间路径:this.tmap.control? this.tmap.Control? 还是 SDK 版本无 ScaleControl)→ 修复为可用路径,并核实 `ScaleControl({position:'bottomRight'})` 构造参数(SDK 官方:position 取值 'bottomRight'? 还是枚举?)
- **bug 7「右下角控制无效果」**:`map-shell.tsx:1761-1768` `handleZoomIn/handleZoomOut` 经逃生舱 `raw.zoomIn?.()` —— AMap 有 zoomIn/zoomOut,TMap raw 无 → 点击无效。修复:契约化 `view.setZoom(view.getState().zoom + 1)`(zoom+1 / zoom-1,与现有 map-shell 行为一致)

## 任务

### 1. 样式:卫星 + 深色(`tencent-engine.ts` setStyle 段)

- satellite:核实现有 `raster` 实现渲染正确(用户说没实现?核实是否真的切到了卫星)
- dark:暴露 styleType:'dark'(或 SDK 正确暗色配置);核实 SDK 对 dark 的支持(源码/文档:Map 构造 styles? setStyles? styleId 常量)—— 若 SDK 确实不支持暗色,降级 normal + warn(记录),不要假装实现
- 契约 `MapStyleId` 语义不变

### 2. 水印隐藏(`tencent-engine.ts` 隐藏段 + `map-shell.module.css`)

- hideControlDom 现注释「版权/logo 保留可见(ToS 署名),只解除点击拦截」—— 改为隐藏(用户明确要求):copyright/logo/attribution 类名隐藏(注意不改动 `.dm-cluster` 等自有样式)
- map-shell.module.css 补 TMap 专属隐藏类(用户水印 DOM:`img[src*="logo_def.png"]`、`.logo-text`、TMap copyright 类名)—— 与既有 `.amap-copyright/amap-logo` 隐藏同模式;以真实 DOM 核实类名
- **ToS 权衡**:tech/23 追加说明(服务商署名要求的合规权衡 + 用户决策)

### 3. 比例尺真实现(`tencent-engine.ts` scale 段)

- 核实「TMap ScaleControl 不可用」降级触发点与原因(SDK 命名空间/类名/构造参数);修复为可用实现
- 与高德逻辑一致:右下角、随 zoom 自动更新(TMap ScaleControl 是否自动更新?若不自动,核实手动更新路径或降级方案)
- addControl('scale') 契约签名不变

### 4. 右下角 zoom 控制契约化(`map-shell.tsx` 仅 L1755-1775)

- handleZoomIn/handleZoomOut 改走契约:`mapInstance.current?.setZoom((mapInstance.current?.getState().zoom ?? 15) + 1)` 等(保留现有 guard 语义)
- 视觉/交互不变(按钮不变,只改实现)
- 若其他组件也有 `raw.zoomIn/zoomOut` 直连,一并契约化(仅该类调用,勿大改)

### 5. 测试

- 新文件 `server/tests/map-engine-tencent-style.test.mjs`:卫星/深色 setStyle 断言、ScaleControl 可用路径断言(命名空间双路径)、水印隐藏 DOM 类名断言
- `server/tests/component-contracts.test.mjs` 追加:map-shell 不再出现 `raw.zoomIn/zoomOut` 直连(契约测试)
- 全量门禁见批次 README

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(**仅 setStyle/scale/addControl/hideControlDom 段,勿碰 marker/MultiMarker/icon 段**)、`server/src/components/map-shell.module.css`(水印隐藏,追加)、`server/src/components/map-shell.tsx`(**仅 zoom 按钮契约化段**)、`server/tests/map-engine-tencent-style.test.mjs`(新)、`server/tests/component-contracts.test.mjs`(追加)、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:ws-a 的 tencent 段(marker 相关)、`map-markers.ts`、`switch.ts`、`use-map-engine.ts`、三引擎其他文件、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-pb/server && npm test`(基线 1128 零漂移 + 新增)
2. `cd /Users/acccan/dm-wt-pb/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-pb && make docs-check`、`git diff --check`
4. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/reports/ws-b.md`:dark/卫星核实结论(SDK 支持度)、水印隐藏实现与 ToS 权衡记录、ScaleControl 降级原因与修复、zoom 契约化改动、测试用例。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
