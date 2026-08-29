# q-auth 汇报(2026-08-27)

任务:认证事务原子性 + verified-email 自动挂接(fix/quality-auth-integrity)。续作重派:上一轮 worker 因 API 瞬时错误中断,保留大量未提交改动;本轮回台审阅、修正缺漏、补完并提交。

## 实际改动

### 事务边界(每个逻辑操作 = 同一 pool client 的 BEGIN/COMMIT/ROLLBACK)

- `server/src/lib/account-store.ts` → 新增 `runDbTransaction`(connect→BEGIN→fn→COMMIT,失败 ROLLBACK,`finally` 必 release;ROLLBACK 失败保留原始错误)与 `withDbTransactionWrite`(冲突类错误在回滚后原样映射,其余包 `DbUnavailableError`)。以下写路径全部从 `withDbWrite`(裸 pool.query)切换为 `withDbTransactionWrite`:
  - `upsertIdentity`(OAuth/OTP 建用户+插 identity):`SAVEPOINT oauth_user_insert` → INSERT users(ON CONFLICT subject)→ 23505(邮箱唯一键)时 `ROLLBACK TO SAVEPOINT` + `RELEASE` → `attachIdentityToExistingEmailUser`(同 client 查已有用户+插 identity);非 23505 原样上抛。
  - `registerWithPassword`(SELECT 查重 → INSERT users → INSERT password identity)。
  - `bindPhone`(UPDATE users.phone → DELETE 旧 phone identity → INSERT 新 phone identity;23505 → `PhoneTakenError`)。
  - `bindEmail`(与 bindPhone 对称;23505 → `EmailTakenError`)。
  - `createSession`(DELETE 过期 sessions → INSERT auth_sessions;失败销毁内存 session 镜像)。
  - `issueOtp`(清理过期挑战×2 → INSERT challenge;失败 `memRevokeOtp`)。
  - `consumeOtp`(SELECT 有效挑战 → DELETE 过期挑战 / DELETE 已消费挑战)。

### verified-email 证据路径

- `server/src/lib/oauth/oauth-config.ts` → 新增 `emailEndpoint`(GitHub `https://api.github.com/user/emails`)。
- `server/src/lib/oauth/oauth-exchange.ts` → Google:email 仅当 userinfo `email_verified === true` 时经 `safeEmail` 采用,否则 undefined;GitHub:额外请求 `/user/emails`,仅取 `primary === true && verified === true` 的条目经 `safeEmail` 采用,`/user.email` 字段不再作为证据;subject 校验前置到 email 请求之前,无效 subject 不发多余网络请求。未验证邮箱 → email undefined → `upsertIdentity` 建独立新账号,绝不凭字符串冲突挂接已有用户。

### 测试

- `server/tests/auth-transactions.test.mjs`(新增)→ 失败注入事务测试:第二/三条 SQL 抛错、rollback/release、重试不产生 orphan、ROLLBACK 自身抛错仍 release 且保留错误映射。
- `server/tests/oauth.test.mjs` → GitHub/Google exchange 改用 verified-email 证据;新增 google `email_verified:false`、github 无 verified primary(unverified primary / verified secondary)不挂接回归;修复上一轮误删的 `callback:next 绝对 URL` test 包裹。
- `server/tests/account.test.mjs` / `account-security.test.mjs` / `auth-hardening.test.mjs` / `otp-guard.test.mjs` → fake pool 适配 `connect()`/`release()` client 接口(事务化后的池契约)。

### 文档

- `tech/27-oauth-login.md` → §5 provider 细节改 verified 语义;§9 邮箱冲突挂接限定 verified email + 写路径事务原子性;§10 增加 verified-email 证据路径测试。
- `tech/28-account-security.md` → §4 增加多语句写路径事务原子性契约;§6 增加失败注入事务测试。

## 门禁结果

- npm test: **1693 通过 / 0 失败**(3 skip)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- **上一轮遗留 bug(oauth.test.mjs 整文件失败)**:`callback:next 绝对 URL 在 start 已清洗 → 跳回 /` 的 `test(...)` 包裹被误删,留下裸 `withEnv(...)` 顶层调用 → 整个 oauth.test.mjs 文件级失败。→ 已恢复 `test(...)` 包裹。
- **GitHub 超长 subject 测试缺 `/user/emails` 路由**:exchange 现在总是请求 emails,而 `fakeFetch` 对未匹配路由抛错,该测试(断言 `OauthExchangeError`)会失败。→ 改为在 email 请求前先 `subjectString` 校验,无效 subject 直接拒绝,不再发多余网络请求;既有测试语义不变。
- **范围判定**:history/saved/applications/notifications 等多语句写路径也仍是多语句,但非认证路径,按任务边界(prompt「复验 OAuth、密码注册、手机号/邮箱换绑等」)不纳入本 WS;如需同类加固可另拆 ws。

## 证据

- `npm test`:tests 1696 / pass 1693 / fail 0 / skip 3。
- 失败注入覆盖:`auth-transactions.test.mjs` 中 password 注册第 2/3 条 SQL、OAuth identity 插入、phone/email 换绑 delete+insert、rollback 错误共 6 个场景;每个断言 ROLLBACK 恰 1 次、client release、快照无部分行、重试成功无孤儿。
- verified-email 覆盖:`oauth.test.mjs` google unverified、github unverified primary、github verified-only-secondary 三场景均断言 `result.user.id !== existing.id` 且 `result.user.email === undefined`。

## Commits

1. `45b52e6` fix(auth): 认证多语句写路径改同一 pool client 事务(BEGIN/COMMIT/ROLLBACK)
2. `d57c540` test(auth): 失败注入覆盖事务回滚/释放/重试无 orphan
3. `5fd1404` fix(oauth): 自动挂接仅接受 provider 验证邮箱(Google verified / GitHub primary)
4. `c3f0862` docs(tech): 记录认证事务原子性与 verified-email 证据路径

未 merge、未 push;分支 `fix/quality-auth-integrity` 与 worktree 留原地。

门禁: PASSED
结论: OK
