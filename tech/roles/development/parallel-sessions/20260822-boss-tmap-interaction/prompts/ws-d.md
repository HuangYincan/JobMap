# Workstream d — fix/geolocation-blue-dot(非 AMap 引擎用户定位蓝点)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-id`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-d.md`(末两行 token,见文末)。

## 背景(用户真机反馈 2026-08-22)

**bug 5「腾讯地图之类连用户定位点都消失了」**:用户定位蓝点在腾讯/百度引擎上不渲染。根因:`map-shell.tsx` L611-612 注释「非 AMap 走引擎 search 纯定位(无蓝点渲染,deferred)」—— 蓝点渲染是 AMap 专属路径(amap-api 的 Geolocation 蓝点+精度圈),腾讯/百度引擎只做了定位(改相机)没做蓝点。用户期望三引擎蓝点一致。

## 任务

### 蓝点实现(引擎无关,走契约)

- 定位成功后,在非 AMap 引擎上创建用户定位蓝点 marker:
  - 用 `view.createMarker({ position, icon: { src: 蓝点 dataURL, size } })`(契约 icon 已支持 src/size,腾讯 MultiMarker/百度 Marker 均走 icon 路径)
  - 蓝点视觉与 AMap 蓝点一致:蓝色圆点(#007AFF 系)+ 可选精度圈;dataURL 生成(圆点 SVG/Canvas → dataURL,或复用现有蓝点素材若存在)
  - 位置更新:定位/移动时 `marker.setPosition` 更新;`marker.remove()` 清理(切引擎/卸载时)
- **不碰现有 AMap 蓝点路径**(amap-api 不动);非 AMap 引擎走新路径
- 蓝点与 POI marker 共存(LOD/聚合不误删蓝点 —— 蓝点是独立 marker,不参与聚合)
- 测试:mock 断言非 AMap 引擎定位后创建蓝点 marker(icon src 为 dataURL、setPosition/remove 调用);AMap 路径零变化断言

## 文件边界

- 只允许改:`server/src/components/map-shell.tsx`(**仅定位/蓝点段**)、`server/tests/`(相关测试)、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:`map-markers.ts`(ws-a 拥有)、`tencent-engine.ts`/`baidu-engine.ts`(ws-a/b 在改,蓝点走既有 icon 契约路径,引擎文件零改动)、`switch.ts`、`use-map-engine.ts`、`map-shell.module.css`、`amap-api.ts`、其他引擎、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-id/server && npm test`(基线 1212 零漂移 + 新增)、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-id && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-d.md`:蓝点实现方案(dataURL 生成/生命周期/与 POI 共存)、测试。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
