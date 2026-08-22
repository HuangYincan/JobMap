# Workstream — fix/tmap-mixed-block(腾讯 POI 混合块:偏移叠印根因定位与修复)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-tmb`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-j.md`(末两行 token,见文末)。

## 背景(boss 真机实测,2026-08-23,dev 6119a2d 含 ws-i 修复)

**上一轮 ws-i 修复了「初始渲染竞态」(首帧 0 徽章:挂图后 setTimeout(0) 全量 setGeometries 重推),5/5 reload 徽章全部渲染。但 boss 主树复验发现 ws-i 未解决的独立问题 —— 「混合块」:**

- 主树 :3000,腾讯引擎,全新 reload:15 个完整 40×40 #007AFF 徽章 + **3 个「混合块」稳定存在**(4 次 reload + 20s 延迟截图全部复现):(656,399)、(894,292)、(362,413)。
- **混合块形态**(1px 像素分析):40px 徽章的**上半 ~13px 消失(平顶,非圆角)**,下半完整(#007AFF 圆角边框 + 内部内容);内部有 38,153,245(SDK 默认蓝)碎片像素 + 彩色像素;上方为白色区域。**结构 = 两个元素垂直偏移 ~13px 叠印:上元素遮住下元素的上半。**
- **行为**:随地图移动(pan 锚定)、**点击无响应**(对照:完整徽章 (699,449) 点击弹「高频杭州」POI 卡)、不在 DOM、非 MultiMarker geometry(ws-i hook 验证:1 实例、每 POI 1 geometry、无 'default' styleId、点击分发正常——15 完整徽章全部可点)。
- **已排除**:底图文字标注遮挡(ws-i 实测 layer rank 70020 > 标注 60000)、DOM 元素、MultiMarker 重复 geometry。
- **注意**:ws-i worker 验收时(worktree :3100)声称「零 34×14 扁块」—— 与主树 :3000 复现矛盾;两处均为 next dev(webpack),差异原因未明。**请先在 :3000 或你自己的环境复现混合块(坐标已知),再二分。**

## 任务(二分定位 + 修复)

### 0. 复现(必须)

- 主树 :3000 或 worktree :3100,腾讯引擎,全新 reload(清 sessionStorage 或全新 context),等待 ≥8s。
- 截图确认 (656,399) 等 3 个混合块存在。**若你的环境无法复现,记录环境差异(viewport/等待时间/页面状态),并改用 boss 的复现条件逐一尝试。**

### 1. 枚举地图 overlay 实体(定位第二套渲染源)

混合块 = 两个元素偏移叠印 → **怀疑存在「第二套渲染实体」**。请:

- hook `TMap.MultiMarker.prototype.add/remove/setGeometries/updateGeometries` + 实例记录到 `window.__mmInsts`(实例数组),页面加载后**枚举每个实例的 geometry 全集**(id/styleId/position),与 MultiMarker hook 的 add 记录对比,找「重复实体」或「同 id 双实例」;
- 尝试 `TMap.Map.prototype.addOverlay` hook(记录全部 overlay 类型:MultiMarker/MultiLabel/MultiCircle/…),确认地图上除了我们的共享 MultiMarker 还有没有**第二个 MultiMarker 或其它 marker 类实体**;
- 对每个 geometry 用 `map.projectToContainer`(实例从 hook 的 addOverlay 记录或 `__mmInsts` 的 map 字段拿)投影到屏幕,与 3 个混合块坐标精确匹配,找出「混合块对应的实体是谁」。

### 2. 二分(按顺序,每步真机截图验证混合块是否消失)

1. **禁 ws-i 的 setGeometries 重推**(注释掉 setTimeout 重推)→ 混合块消失?(验证 ws-i 是否引入/恶化)
2. **禁 LOD 摘挂**(POI 控制器 setVisible 的摘挂循环;观察到 1100 次 add = 22 轮全量摘挂)→ 消失?
3. **禁 icon.horse 候选**(resolveTMapIconSrc 直接返回 fallbackSrc)→ 消失?
4. 若以上都不消失:枚举 overlay 实体(任务 1)的结果里找「第二个实体」的创建路径。

### 3. 修复

根因定位后最小修复。**不要写未证实的结论进代码注释**;注释按实测机制写。

### 4. 真机验收(必须)

- 腾讯:3 个混合块消失(对应位置徽章完整 40×40)、15+ 徽章全部完整、点击弹卡、缩放/pan 后仍完整、reload 3 次复验
- 首会话 console errors 水平不劣化(ws-i 链式预检保持)
- AMap/Baidu 零回归
- `cd server && npm test`、`npm run typecheck`、`make docs-check`、`git diff --check`
- `tech/23-map-engines.md` 回填(仅追加)

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`、`server/src/lib/map-markers.ts`(若根因在 LOD/控制器)、`server/tests/`、`tech/23-map-engines.md`(仅追加)
- **不碰**:baidu-engine.ts、amap 引擎、map-shell.tsx、engine-preference.ts、layers-panel.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-tmb/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-tmb && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-j.md`:复现结果(环境差异)、枚举 overlay 发现、二分各步结论(混合块是否消失)、根因、修复、真机验收。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
