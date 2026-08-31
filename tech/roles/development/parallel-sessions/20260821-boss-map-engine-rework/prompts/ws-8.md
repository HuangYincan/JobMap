# Workstream 8 — feature/engine-mount-fallback(挂载失败回退默认引擎)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-rw8`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-8.md`(末两行 token,见文末)。

## 背景(boss 真实验证结论,2026-08-22 Playwright)

交互式切换失败回滚已全部验证通过(百度 AK 类型错误 → 1.5s 就绪超时 → 抛错 → 自动回滚高德,地图完整恢复)。**唯一剩余缺口:页面挂载时** —— sessionStorage 偏好 = 百度(故障引擎)→ 刷新页面 → 挂载切换失败 → **`use-map-engine.ts:316-318` 只 console.warn,engine 状态停留在失败引擎、无视图、地图空白**,UI 显示「百度 · 手动选择」但无图。此时无「from」旧引擎可回滚(挂载时 from=null)。

## 任务

### 挂载失败回退(`server/src/hooks/use-map-engine.ts`)

- 挂载路径(L293-318):`resolved.load().then(createView).catch(...)` 失败时,当前只 warn。修复:
  - catch 中:**回退到第一个已配置引擎**(按 `ENGINE_PRIORITY` 顺序或 registry 的已配置列表;参考 `resolveEngine()` 的排序逻辑)重试 load+createView;重试也失败 → 保持现有 warn 行为(或记 deferred)
  - 回退成功 → `setEngine(fallback)` + `setActiveSearchProvider(fallback.search)` + 正常挂载视图(viewRef/setView 与主路径一致)
  - **失败不写偏好**(沿用 L213 语义:挂载回退也不覆盖 sessionStorage 偏好;若希望回退成功后写偏好以利下次加载,请在汇报中说明取舍)
  - 取消/竞态保护与主路径一致(cancelled 检查、viewRef.current 双实例防护)
- 不触碰 switch.ts(交互式路径已完整);不触碰 engine-preference/registry 语义

### 测试

- `server/tests/map-engine-switch.test.mjs` 或新测试文件:mock 首引擎 load/createView 失败 → 断言回退到第二引擎、view 挂载、engine 状态正确;回退也失败 → 保持空视图 + warn;取消路径不泄漏
- 全量:`cd /Users/acccan/dm-wt-rw8/server && npm test && npm run typecheck`;`cd /Users/acccan/dm-wt-rw8 && make docs-check`(基线红如实报告)、`git diff --check`
- 小步 commit(Conventional Commits)

## 文件边界

- 只允许改:`server/src/hooks/use-map-engine.ts`、`server/tests/map-engine-switch.test.mjs`(或新测试文件)、`tech/23-map-engines.md`(验证结果回填,仅追加)
- **不碰**:`switch.ts`、`types.ts`、三引擎、`map-markers.ts`、`map-shell.tsx`、`map-shell.module.css`、`server/src/components/**`、`server/data/**`、`tech/01|03|06`、`agent.md`

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-8.md`:回退顺序依据、偏好写入取舍、竞态防护、测试用例。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
