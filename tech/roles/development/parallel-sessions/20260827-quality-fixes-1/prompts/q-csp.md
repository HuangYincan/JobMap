# q-csp — CSP 收紧且保持地图兼容

## 路径

- worktree: `/Users/acccan/dm-wt-q-csp`
- branch: `fix/quality-csp`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-csp.md`
- scan: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/quality-scans/20260827-all/scan-report.md` finding #22

## 任务

1. 复验 `server/next.config.ts` 是否把 `'unsafe-inline'` 与 `'unsafe-eval'` 扩散到全站。
2. 在不破坏 Next.js 16、React 19、AMap 及现有账号/Agent 页面行为的前提下实施可验证的 CSP 收紧。优先 route-specific 或按实际 SDK 需求最小化，不做虚假的“删字符串但运行即坏”。若 nonce/hash 在现有架构不可稳妥落地，采用最小安全增量并把剩余限制写清。
3. 新增/更新 header 配置测试，至少证明非地图路由比地图路由更严格、必要 SDK host 仍受控允许。
4. 更新 CSP/部署专属文档，说明残余 `'unsafe-*'` 的精确范围与原因。

## 边界

- 不修改任何 UI 视觉或交互流程。
- 不动 Agent SSE、认证业务、地图组件代码，除非是让 header 判定有可靠路由信息所需的最小改动。
- 不安装依赖，不运行 Env-only 操作。

## 门禁与提交

- `cd server && npm test`
- `cd server && npm run typecheck`
- `make docs-check`
- `git diff --check`
- Conventional Commits；不要 merge，不要 push。

## 回报

说明复验、实际 CSP 差异、地图兼容证据、测试结果与残余风险。末两行：

`门禁: PASSED` 或 `门禁: FAILED`

`结论: OK` 或 `结论: BLOCKED: <一句话>`
