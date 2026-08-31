# Workstream — fix/baidu-r5(注入徽章定位错乱紧急修复)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-br5`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-g.md`(末两行 token,见文末)。

## 背景(boss 真机实测,2026-08-22 —— 紧急)

r4 修复后主树复验:
- ✅ 注入成功(0 警告,`document.querySelectorAll('.dm-badge')` = **400 个**)
- 🔴 **全部徽章定位错乱**:`getBoundingClientRect()` 返回 x≈5,009,397(500 万 px,屏幕外);截图视觉**零徽章**(19 个蓝簇均为底图/UI 元素,非徽章)
- 即:徽章 DOM 存在但位置全错 → 用户仍看不到 POI

**嫌疑(worker 判定,不限于此)**:
1. r4 定时器兜底在 marker 定位未就绪时注入(注入时 BMap_Marker 点击目标 DOM 位置未初始化)→ 注入后 BMapGL 不移动已注入内容(或移动的是不同节点)
2. 注入节点层级错误:注入到静态层而非 BMapGL 会移动的定位节点(domElement 的定位由 SDK 管理,内容应放在 SDK 会移动的子节点内)
3. BMapGL 覆盖物容器 transform/坐标基准(注入坐标系与页面像素错位)

## 任务

1. **实测复现**(必须,worktree 内 dev server + Playwright):主树同条件 —— 百度引擎 work 模式,加载后:
   - 确认 .dm-badge 数量与 rect 坐标(是否 500 万 px 级)
   - 截图确认视觉无徽章
   - 读注入链路:徽章注入到哪个节点、该节点的定位机制(SDK 何时/如何移动它)
2. **修复**:徽章位置正确(钉在 POI 地理点上,聚合+单点),视觉可见、点击命中
   - 若 r4 注入时机过早 → 注入改为「marker 定位就绪后」(或注入到 SDK 会移动的定位子节点)
   - 若节点层级错误 → 修正注入目标节点
3. **回归**:聚合(z≤8)+ 单点(z>8)徽章可见、位置正确、点击命中;滚轮/缩放后位置跟随;深色/卫星切换正常;零注入超时警告;无 console 报错
4. 测试 + `tech/23-map-engines.md` 回填(仅追加)

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`(注入/定位相关)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:腾讯/高德引擎、map-markers.ts、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-br5/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-br5 && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-g.md`:复现证据、定位错乱根因、修复、回归验收。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
