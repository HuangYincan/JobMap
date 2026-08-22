# Workstream — fix/tmap-content-scope(腾讯 POI 堆叠修复:DOM overlay 收窄到无 icon content)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-tc`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-h.md`(末两行 token,见文末)。

## 背景(boss 真机实测 + 根因实锤,2026-08-22)

**用户报「来回切换底图导致 POI 各种奇怪 bug」;boss 实测实锤根因**:

- 腾讯引擎(全新 reload,非切换残留):`document.querySelectorAll('.dm-badge')` = 100 个,**全部堆叠在 (0,900) 一个点**(unique=1,xRange=[0,0])
- 徽章父链:`.dm-badge` → `.dm-engine-content`(引擎 content 容器)→ 地图容器。**`.dm-engine-content` 容器 = `tencent-engine.ts` 的 `createContentOverlay`(L505:content 存在即走 DOM overlay)**
- **引入者**:`f2e4f60 fix(map-engine): tencent content marker 改走 DOM overlay 渲染(ws-pinfix2)` —— 动机是修「content+offset 无 icon 的 agent marker 被 MultiMarker 拒绝」;但副作用是**所有 content marker(含公司 POI 徽章,它们 content+icon 并存)都改走 DOM overlay** → `lngLatToContainerPoint` 定位失败(100 徽章全在 (0,900),redraw 未生效/API 不可用)→ POI 全部堆叠
- **对照**:ws-pinfix2 之前,公司 POI(content+icon)走 MultiMarker icon 纹理路径(验证过正常,锚点 ws-c 修正);agent 蓝点(content 无 icon)在 ws-pinfix2 前不可见(它要修的目标)

## 任务

### 1. DOM overlay 收窄(主修复,方案 A)

`tencent-engine.ts` `createMarker` 的分派逻辑:
- **content 存在且无 icon** → `createContentOverlay`(保留,ws-pinfix2 目标场景:agent 蓝点等)
- **content 存在且有 icon / 有 icon** → 走既有 icon 路径(MultiMarker 纹理,ws-c 修正后的锚点公式)—— 公司 POI 恢复
- 无 content 无 icon → 现有单点/MultiMarker 路径不变
- 注意:当前 L527-528 注释「content 与 icon 并存 → content 为渲染主机制」需改为「icon 为渲染主机制」(回归 ws-c 语义);检查 `createContentOverlay` 的调用点与 `createContentFallback` 的兜底链是否需同步调整

### 2. 顺带排查 lngLatToContainerPoint(方案 B,双保险)

- 若 worker 实测确认 `this.raw.lngLatToContainerPoint` 在真实 TMap GL 上**存在但定位错**(或 API 名差异),顺手修 DOM overlay 定位(agent 蓝点也受益);若 API 不存在,记录结论即可(方案 A 已把公司 POI 移出 DOM overlay,蓝点定位缺陷单独记入汇报,不阻塞)

### 3. 真机验收(必须)

- worktree 内 `PORT=3100 npm run dev` + Playwright(或主树 :3000 复用):
  - 腾讯引擎:`.dm-badge` 不堆叠(唯一位置数 = 视口内徽章数),徽章在 POI 位置,点击命中,缩放跟随
  - agent 蓝点(无 icon content):仍可见(ws-pinfix2 目标不回归)—— 可 mock 或检查 DOM overlay 路径仍存在
  - 百度/高德引擎零回归(百度 r5 的 Marker 注入不受影响)
- 测试 + `tech/23-map-engines.md` 回填(仅追加)

### 4. 保底方案(若方案 A 真机验收失败或 worker 判断风险高)

用户已明确授权:**「不能修就先暂时只用高德,不让用户切换其他」** —— 实现方式(worker 判断最简):
- 图层面板「地图源」section 只显示/只允许高德(其他选项禁用 + 文案说明「暂不可用」),引擎偏好强制 amap
- 或隐藏整个地图源 section
- 选择不破坏现有 UI 设计语义的最小改动(禁用/隐藏);若 worker 认为这属于「改现有 UI 设计」范畴,则只做**引擎层强制 amap**(engine-preference 忽略非 amap 偏好)并记录 UI 改动建议,由 boss 裁决
- 验收:任何会话状态都无法切到腾讯/百度(引擎恒 amap)

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(createMarker 分派/content overlay 段)、`server/src/lib/map-engine/engine-preference.ts`(保底方案,若需)、`server/src/components/layers-panel.tsx`(保底方案 UI,若需)、`server/tests/`(相关测试)、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:baidu-engine.ts、amap 引擎、map-markers.ts、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-tc/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-tc && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-h.md`:堆叠根因确认、方案 A/B 实施、真机验收(腾讯徽章不堆叠/蓝点不回归/其他引擎零回归)、保底方案是否触发及实现。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
