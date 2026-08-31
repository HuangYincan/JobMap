# q-front — 搜索 readiness 与 tier 0 边界

## 路径

- worktree: `/Users/acccan/dm-wt-q-front`
- branch: `fix/quality-frontend-edges`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-front.md`
- scan findings: #17 #25

## 任务

1. 复验 Domain query 在地图引擎晚于输入就绪时是否永不重放。用稳定 engine identity/readiness 或现有总线事件触发当前 query 重试，保留 debounce、取消守卫和 mode 切换语义，避免重复请求/StrictMode 回归。
2. 修复 `viewport-search.ts` 把合法 `maxTier=0` 当成未设置；用显式 nullish 判断。
3. 加回归测试：先输入后 engine ready 能得到建议、旧请求取消、mode 切换不串结果、tier 0 被发送、undefined/null 不发送。
4. 若更新文档，只改搜索状态/viewport 专属说明。

## 边界

- 这是 bugfix：不得改变现有 UI 布局、视觉、文案或产品流程。
- 不改地图生命周期 keepalive 设计，不安装依赖，不运行 Env-only 操作。

## 门禁与提交

- `cd server && npm test`
- `cd server && npm run typecheck`
- `make docs-check`
- `git diff --check`
- Conventional Commits；不要 merge，不要 push。

## 回报

报告说明 readiness 触发模型、StrictMode/取消风险与边界测试。末两行：

`门禁: PASSED` 或 `门禁: FAILED`

`结论: OK` 或 `结论: BLOCKED: <一句话>`
