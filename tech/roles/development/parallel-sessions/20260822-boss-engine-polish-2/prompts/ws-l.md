# Workstream — fix/baidu-blink(百度滚轮缩放 POI 闪烁)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-bbl`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-l.md`(末两行 token,见文末)。

## 背景(boss 真机实测,2026-08-23,dev c6a919a)

**用户报:「百度地图下滚动地图会导致poi闪烁」;boss 高频帧序列实测实锤**:

- 百度引擎,滚轮放大,60ms 间隔 15 帧截图(视口 1400×900):
  - f00→f01(滚轮触发瞬间):**30 个徽章位置全部瞬移(消失 23 + 新增 23)**
  - f01→f02:再瞬移 11;f02 之后稳定
- **即:滚轮缩放开始的 ~120ms 内,全部徽章位置整体跳变两次,再稳定** —— 用户感知「闪烁」。
- 相关既有机制(历史修复,勿回退):
  - `scheduleMarkerContentInjection`(ws-e/r3/r4):content 注入厂商 BMap_Marker 点击目标 DOM,定时器兜底;
  - `pointToOverlayPixelIn` 实例遮蔽 fixPosition:false + moveend/zoomend/tilesloaded 校准(ws-g r5,修复 ±worldSize 反绕);
  - LOD 摘挂(setVisible → remove/add)。
- **「全部徽章瞬移」= 相机变化瞬间徽章按旧/新相机交错渲染,或校准循环在缩放动画期间反复触发,或注入 DOM 重建。**

## 任务

### 1. 复现 + 定位(必须)

- 复现:百度引擎,滚轮缩放,高频截图(60ms 间隔)确认瞬移帧。
- **二分定位**(每步真机验证瞬移是否消失):
  1. **禁校准循环**(moveend/zoomend/tilesloaded → 重定位)是否消失?—— 若相关:校准时机/防抖优化(如缩放动画期间(缩放进行中)跳过校准,idle 后一次收敛;或按帧同步相机);
  2. **禁 LOD 摘挂**(setVisible 循环)是否消失?
  3. **禁注入定时器兜底**(scheduleMarkerContentInjection 的定时器)是否消失?
- 定位后最小修复。**不要写未证实的结论进代码注释;注释按实测机制写。**

### 2. 真机验收(必须)

- 百度:滚轮连续缩放(放大/缩小各 3 次)高频帧序列 **0 瞬移帧**(徽章平滑跟随,位置连续变化);点击弹卡;reload 复验;无 console 报错;
- AMap/Tencent 零回归;
- `cd server && npm test`、`npm run typecheck`、`make docs-check`、`git diff --check`
- `tech/23-map-engines.md` 回填(仅追加:百度缩放闪烁机制 + 修复)

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`(校准/注入相关)、`server/tests/`(相关测试)、`tech/23-map-engines.md`(仅追加)
- **不碰**:tencent-engine.ts、amap 引擎、map-markers.ts、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-bbl/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-bbl && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-l.md`:复现帧证据、二分各步结论(瞬移是否消失)、根因、修复、真机验收(0 瞬移帧)。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
