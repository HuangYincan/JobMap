# q-agent — Agent 网络与地图动作边界

## 路径

- worktree: `/Users/acccan/dm-wt-q-agent`
- branch: `fix/quality-agent-boundaries`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-agent.md`
- scan: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/quality-scans/20260827-all/scan-report.md` findings #2/#18

## 任务

1. 先逐行复验 #2：`/api/agent/chat` 是否会把 `reasoning` SSE 事件发给网络客户端。若成立，在网络发送边界真正执行显式 allowlist；保留 provider tool-call replay 所需的服务端内部 reasoning，但不得公开发送。
2. 复验 #18：`flyTo.zoom` 是否只校验 finite。若成立，在 action schema 和 bridge 两层使用项目/引擎共同支持范围做拒绝或 clamp，保持既有动作语义。
3. 添加精确回归测试：reasoning 不出 SSE、合法事件仍流式输出、zoom 极端/负值/边界值行为稳定。
4. 如需文档，只更新 Agent/地图动作的专属技术文档；不要改全局 `agent.md`、里程碑或 UI 设计。

## 边界

- 不实现扫描 #3 Memory 产品/隐私交互。
- 不改 CSP（q-csp 负责）。
- 不修改现有 UI 视觉、布局或流程。
- 不打印密钥，不运行 import/geocode/migration/crawl，不安装依赖。

## 门禁与提交

- `cd server && npm test`
- `cd server && npm run typecheck`
- `make docs-check`
- `git diff --check`
- Conventional Commits，小步 commit；不要 merge，不要 push。

## 回报

报告包含：复验证据、改动摘要、测试命令与结果、commit 列表、遇到的问题。末两行必须精确为：

`门禁: PASSED` 或 `门禁: FAILED`

`结论: OK` 或 `结论: BLOCKED: <一句话>`
