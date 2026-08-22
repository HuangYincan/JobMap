# Workstream — fix/tmap-badge-overlap(腾讯 POI 徽章被底图文字标注遮挡 + 预检刷屏)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-tov`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-i.md`(末两行 token,见文末)。

## 背景(boss 真机实测实锤,2026-08-23)

**用户报「腾讯底图的公司poi有问题,渲染很奇怪」;boss 实测(Playwright 真机,全新 reload)实锤**:

- **POI 徽章主体渲染正常**:15 个完整 40×40 #007AFF 徽章(与 AMap 视觉一致),点击弹 POI 卡;MultiMarker hook 验证:1 个共享实例、每 POI 1 个 geometry、全部引用 dm-st-N 自定义样式(dataURL SVG 纹理)、无 'default' styleId、无重复 geometry —— **「双渲染」排除,不是 MultiMarker 层 bug**。
- **但存在 3 个「幽灵元素」**(34×14 扁平,白上蓝内):(656,399)、(894,292)、(362,413) —— 地图锚定(pan 跟随)、**点击无响应**、不在 DOM、非 MultiMarker geometry、AMap 视口内无对应 POI。
- **OCR(系统 Vision)实证**:TMap 底图矢量瓦片自带海量 POI 文字标注(「18号級」「文三路」「三里新城」等);**「18号級」(638,393)-(672,403) 与混合块 (656,399) 精确重叠** —— 混合块 = 徽章被底图文字标注遮挡(文字白底盖住徽章上部,只露下半 ~34×14)。
- **为什么腾讯独有**:AMap 徽章是 DOM 元素(z-index 高,画在 canvas 之上);**腾讯 MultiMarker 渲染在 canvas 内,与底图标注层同层竞争 → 文字标注可能覆盖徽章**。
- **次要噪音**:首次会话 370-740 行 console CORS 错误(favicon.im 预检刷屏;185 唯一 URL × 2 行)。**代码根因已定位**:`map-markers.ts` `resolveTMapIconSrc`(L255-278)把**全部 unknown 候选都 push 进 toPreflight**(每 POI 候选链 ~8 个 URL)→ 调用方(L609)`for (const url of toPreflight) preflightRemoteIcon(url)` **全量预检** → 24 POI × ~8 = 192 个失败请求。ws-e/ws-f 的记忆化本身正常(每 URL 只报 1 次),**问题是「一次性预检全部候选」而非「链式推进」**。

## 任务

### A. 徽章层级修复(主修复)

让腾讯 POI 徽章渲染在底图文字标注**之上**。候选方案(worker 查 SDK v1.8.0.2 后选最简可靠者):

1. **MultiMarker zIndex / overlay layer rank 提升**:确认 SDK 的 overlay zIndex → layer rank 是否高于标注层(理论上 overlay 在标注上,实测被盖 → 可能需更大 zIndex 或另有层级参数);
2. **关闭/压低底图标注层**:TMap Map 是否有标注层开关(`setLabelOptions` / baseMap 样式参数 / 图层属性);
3. 其他 worker 实测有效的 SDK 机制。

**验收**:3 个混合块消失(该位置徽章完整 40×40)、15+ 徽章全部完整、点击弹卡、缩放/pan 后仍完整、AMap/Baidu 零回归。

**注意**:若 worker 实测发现「幽灵元素不是底图文字遮挡」(例如禁标注层后仍在)→ 记录并二分:禁 icon.horse 候选(全 dataURL)是否消失;禁 `setStyles` 全量替换(改增量)是否消失;LOD 摘挂(1100 次 add 观测)是否相关。**不要把未证实的结论写进代码注释。**

### B. 预检链式推进(确定性修复)

`map-markers.ts` `resolveTMapIconSrc`:当前把全部 unknown 候选 push 进 toPreflight → 全量预检。改为**只 push 候选链中第一个 unknown**(链式:预检第一个,失败记忆化后下次重建自然试下一个)。保持纯函数契约(返回 {src, toPreflight})与现有测试语义;新增/更新测试覆盖「只返回第一个 unknown」。

**验收**:首次会话 console errors 从 ~370 行降到 ≤~50 行(每个 POI 最多 1-2 个预检失败),第二次会话(记忆化)0 行。

### C. 真机验收(必须)

- worktree 内 `PORT=3100 npm run dev` + Playwright(或主树 :3000 复用):
  - 腾讯:混合块消失/徽章完整、点击弹卡、缩放跟随、底图文字不再遮挡
  - console errors 首会话 ≤50 行、第二会话 0 行
  - AMap/Baidu 零回归(徽章 DOM 路径不受影响)
- `cd server && npm test`、`npm run typecheck`、`make docs-check`、`git diff --check`
- `tech/23-map-engines.md` 回填(仅追加:腾讯徽章层级修复 + 预检链式推进)

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(层级相关)、`server/src/lib/map-markers.ts`(resolveTMapIconSrc 链式推进)、`server/tests/`(相关测试)、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:baidu-engine.ts、amap 引擎、map-shell.tsx、engine-preference.ts、layers-panel.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-tov/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-tov && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-i.md`:混合块根因确认(底图文字遮挡 or 其他)、方案 A/B 实施、真机验收(腾讯徽章完整/点击/缩放/错误数)、AMap/Baidu 零回归证据。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
