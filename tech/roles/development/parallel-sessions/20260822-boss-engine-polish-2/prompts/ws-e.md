# Workstream — fix/baidu-round2(百度 POI 单点渲染 + 深色卫星组合 + 蓝点偏差)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-br2`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-e.md`(末两行 token,见文末)。

## 背景(boss 真机实测,2026-08-22 —— 三项均为实测证据,不是推测)

**A. bug 2 百度 POI 单点级未渲染(核心)**
- boss Playwright 实测:百度引擎 zoom 17(单点级,z>8)下,`document.querySelectorAll('.dm-badge')` 返回 **0 个**;截图无徽章视觉;点击无选中反馈
- 对比:zoom 6-8(聚合级)有蓝簇(聚合走 dataURL icon 路径);zoom 17 单点级应走 content 路径(BMapGL `raw.setContent` + 透明 1×1 锚点图标)—— **DOM 里 0 徽章说明单点 content 路径没生效**
- 注意:前一轮 ws-b 报告「content 路径三环节正确(经读码)」——**实测与其结论冲突,boss 以实测为准**:worker 必须先实测复现(启动 worktree 内 dev server + Playwright,或直接读渲染挂载链),**不要信任旧结论**

**B. 百度深色 ← 卫星组合不生效**
- boss 实测:标准→深色 brightness 235→106(生效 ✅);**卫星→深色停在卫星(亮度/色彩无变化,不生效)** —— 疑似 setMapStyleV2 自定义样式只对 vector mapType 生效;深色切换时应先切回 vector(或 CUSTOM_MAP)再应用 styleJson
- 修复:深色切换时强制 vector mapType(或核实 SDK 正确组合姿势)

**C. 百度定位蓝点与相机中心偏差 ~147px(zoom 17)**
- boss 实测:mock 杭州 (30.2741, 120.1551),点定位 → 蓝点渲染 + 相机移动(中心区域 35% 变化),但**蓝点在 (847,434),屏幕中心 (700,450) 差 147px**
- 疑点:handleLocate 的相机 flyTo 用定位结果(gcj02)直接飞;蓝点 marker 经 createMarker 内 gcj02→bd09 落底图。**两路径坐标应一致**——若相机中心 = mock 位置而蓝点偏移,则蓝点路径转换有误;若蓝点正确而相机飞到别的坐标,则相机路径有误。worker 读码 + 实测判定,修复一致
- 注意:底图是 bd09;定位结果是 wgs84(浏览器)→ 契约输出 gcj02 → 蓝点落底图需 gcj02→bd09

## 任务

1. **POI 单点级**:实测复现 → 定位根因(DOM 0 徽章:content 未设置?marker 未挂图?LOD/可见性逻辑在单点级跳过了 content?)→ 修复 → 实测验收(zoom 17 下 .dm-badge 存在且点击命中)
2. **深色+卫星**:修复组合切换(深色切自卫星也生效)
3. **蓝点偏差**:读码 + 实测判定相机/蓝点两路径坐标一致性,修复
4. 测试:三件事的断言(mock)
5. `tech/23-map-engines.md` 回填(仅追加):三项实测修复摘要

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`、`server/src/lib/map-engine/baidu/`(目录内其他文件,若拆分)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:腾讯/高德引擎、map-markers.ts、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-br2/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-br2 && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-e.md`:三项的实测复现证据、根因、修复、验收。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
