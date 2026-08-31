# Workstream — fix/baidu-r3(百度渲染卡死 + 标记消失紧急修复)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-br3`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-f.md`(末两行 token,见文末)。

## 背景(boss 真机实测,2026-08-22 —— 紧急)

ws-e(fix/baidu-round2)合并后,**百度引擎整体退化**:
1. **渲染卡死**:Playwright 截图持续超时(合成器卡住),滚轮无响应,zoom 值不更新
2. **标记全部消失**:zoom 6-16 全级别 `document.querySelectorAll('.dm-badge')` = 0、无 overlay 节点、无聚合图标 —— 聚合级和单点级都不渲染(ws-e 前聚合级正常)
3. JS 主线程正常(evaluate 可执行),console 无 JS 错误 —— 卡点在**渲染层/定时器层**

嫌疑(ws-e diff 摘要,2026-08-22):
- ws-e 新增 `scheduleMarkerContentInjection(raw)`:厂商 BMap_Marker 点击目标 DOM 注入,「schedule」疑似定时器/轮询实现 —— **若轮询高频/无限重试(等待 BMap_Marker DOM 出现而 marker 未挂图),可能阻塞渲染循环或死循环**
- 透明 1×1 锚点图标路径 + Overlay 主路径共存(merger 冲突「保留双方」)—— 可能两条路径互相干扰(如 Overlay 路径创建了透明图标但 content 走注入,或注入时机与挂图时序错位)

## 任务

1. **实测复现**(必须):worktree 内 `npm run dev` + Playwright(或直接读 `scheduleMarkerContentInjection` 实现推理 + 最小复现测试):
   - 百度引擎加载,检查:标记渲染(聚合+单点)、截图是否超时、滚轮是否响应
   - 定位卡死根因(定时器?死循环?渲染层?)
2. **修复**:让百度标记正常渲染(聚合+单点)、渲染不卡、点击命中 —— 与 ws-e 目标一致但实现正确
3. **回归**:聚合级(z≤8)与单点级(z>8)都渲染;深色/卫星切换正常;无 console 报错
4. 测试:断言(mock 或集成)
5. `tech/23-map-engines.md` 回填(仅追加):r3 修复摘要

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`(含 `scheduleMarkerContentInjection` 相关)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:腾讯/高德引擎、map-markers.ts、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-br3/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-br3 && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-f.md`:复现证据、卡死根因、修复、回归验证。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
