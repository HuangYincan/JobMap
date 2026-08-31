# q-auth — 认证事务原子性与 verified-email 链接

## 路径

- worktree: `/Users/acccan/dm-wt-q-auth`
- branch: `fix/quality-auth-integrity`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-auth.md`
- scan findings: #7 #10

## 任务

1. 复验 OAuth、密码注册、手机号/邮箱换绑等多语句写路径。把每个逻辑操作改为同一 pool client 的 `BEGIN/COMMIT/ROLLBACK`，确保任何中间失败不会留下半完成用户/identity/凭证。
2. 保持现有错误映射语义；rollback 后再映射冲突/可用性错误，client 始终 release。
3. OAuth 自动链接只允许 provider 明确验证且可声明的邮箱：Google 检查 `email_verified === true`；GitHub 使用 verified primary email 证据。未验证时不得仅凭字符串冲突挂接现有用户，采用现有最安全兼容行为或明确拒绝。
4. 新增失败注入测试覆盖第二/第三条 SQL 抛错、rollback/release、重试不产生 orphan；覆盖 Google 未验证邮箱和 GitHub 未验证/无 primary email。
5. 只更新认证专属技术文档；不改 UI 流程。

## 边界

- 不实现 #8 client IP/代理拓扑。
- 不更改现有登录 UI、绑定交互或视觉。
- 不打印/提交 env，不安装依赖，不运行迁移 apply。

## 门禁与提交

- `cd server && npm test`
- `cd server && npm run typecheck`
- `make docs-check`
- `git diff --check`
- Conventional Commits；不要 merge，不要 push。

## 回报

报告列出每个事务边界、verified-email 证据路径、失败注入测试和 commit。末两行：

`门禁: PASSED` 或 `门禁: FAILED`

## Boss 裁决附录（续作重派）

上一轮 worker 因 API 提供商瞬时错误中断，未提交、未写报告。**工作树保留大量未提交改动**：`server/src/lib/account-store.ts`、`server/src/lib/oauth/{oauth-config,oauth-exchange}.ts`、新增 `server/tests/auth-transactions.test.mjs`，以及多个既有测试文件的修改。请先审阅 `git status` / `git diff`：保留范围内且内容正确的改动并补完，缺漏则补齐/修正。随后小步 Conventional Commit、跑门禁、写报告。不要重做已完成的核对，不要创建空提交。

`结论: OK` 或 `结论: BLOCKED: <一句话>`
