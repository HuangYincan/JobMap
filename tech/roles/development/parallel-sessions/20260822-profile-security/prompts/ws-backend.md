# WS: ws-backend — 账号安全后端 API(foundation)

你是 headless 开发 worker。工作目录是**你的 worktree**:`/Users/acccan/dm-wt-ps-backend`(已预建,分支 `feature/account-security-api`,从 dev 切出)。代码在 `server/src/`(Next.js 16 + React 19)。**worktree 已预建,boss 统一合并;你绝不 merge / push / 建分支。** 完成后写汇报到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-profile-security/reports/ws-backend.md`(末两行 token)。

## 背景

平台认证现状:OTP 验证码登录(邮箱 Resend / 手机阿里云)、OAuth(GitHub/Google/WeChat)、username+password 注册登录(scrypt)。**账号安全管理后端零实现**:无修改密码、无绑定/更换手机邮箱;`loginWithPassword` 只认 username。本 WS 补齐这些 API,前端(ws-frontend)与文档(ws-docs)并行依赖你。

关键现状(已探明):
- `server/src/lib/account-store.ts:362` `loginWithPassword(username, password)` — 只 `WHERE lower(u.username) = $1 AND u.password_hash IS NOT NULL`。
- `server/src/lib/account-store.ts:266` `upsertIdentity`、`:542` `issueOtp`、`:583` `consumeOtp`、`:316` `registerWithPassword`。
- `server/src/lib/password.ts:10-41` — scrypt,`hashPassword` / `verifyPassword`。
- `server/src/lib/account.ts:40-56` — `AccountUser` 类型(displayName/accountLabel/avatarUrl/phone/email/username/provider/preferences)。
- `server/src/app/api/auth/me/route.ts` — PATCH 仅 displayName/avatarUrl/preferences;GET 返回 `{ user }`。
- `server/src/app/api/auth/otp/verify/route.ts` — 参考 consumeOtp 错误处理模式(OtpTooManyAttemptsError → 429)。
- users 表已有 phone/email/username/password_hash(迁移 005/014,phone 部分唯一 + lower(email) 部分唯一),**无需新迁移**。
- 测试:`server/tests/*.test.mjs`(Node 测试,如 `oauth.test.mjs`、`otp.test.mjs` 先例,看它们的 mock 方式:memory store 走 `withDbRead/withDbWrite` 的 mem 分支)。

## 任务(全部在 worktree 内)

### 1. `loginWithPassword` 支持邮箱
改 `server/src/lib/account-store.ts:362`(含 mem 分支 `memLoginWithPassword`):查询条件改为
`WHERE (lower(u.username) = $1 OR lower(u.email) = $1) AND u.password_hash IS NOT NULL`。
行为不变:失败统一返回 null(路由 401 INVALID_CREDENTIALS,不泄露账号是否存在)。

### 2. user JSON 增加 `hasPassword`
`server/src/lib/account.ts` `AccountUser` 加 `hasPassword: boolean`;`account-store.ts` 的 `asUser`(或等价处)
计算 `hasPassword: !!password_hash`。**GET /api/auth/me 与登录响应都带该字段**,其余字段不动。检查所有
asUser 调用路径(mem 分支同样处理),避免类型错误。

### 3. 新路由 `POST /api/auth/me/password`(文件 `server/src/app/api/auth/me/password/route.ts`,新建)
契约(与 README 一致,禁止漂移):
- 未登录 → 401 `UNAUTHORIZED`(参照 me/route.ts 的 `readSessionUser` 模式)。
- body `{ oldPassword?, otp?: { provider: 'email'|'phone', target, code }, newPassword }`。
- 校验:`newPassword` 必须 ≥8 位(复用 password.ts / register 路由的校验)→ 400 `PASSWORD_TOO_SHORT`。
- 身份验证(二选一,由用户当前是否有密码决定,后端不猜前端):
  - 已有 `password_hash`:必填 `oldPassword`,`verifyPassword` 失败 → 401 `WRONG_PASSWORD`。亦可传 `otp` 替代(此时不再要求 oldPassword)。
  - 无 `password_hash`:必填 `otp`。`otp.provider` 必须是 `'email'|'phone'` 之一,`otp.target` 必须等于该用户绑定的 email/phone(不匹配 → 401 `NOT_BOUND`),然后 `consumeOtp(provider, target, code)` 失败 → 401 `INVALID_CODE`。
- 成功:更新 `users.password_hash`(hashPassword),返回 200 `{ ok: true, user }`(user 含 hasPassword:true)。
- 错误处理参照 otp/verify 路由的 catch 模式(不泄漏内部错误;不要打印 env/密钥)。
- 注意:不要把 password_hash 返回给前端(沿用现有 asUser 剥离逻辑)。

### 4. 新路由 `POST /api/auth/me/phone`(文件 `server/src/app/api/auth/me/phone/route.ts`,新建)
- 未登录 → 401。body `{ phone, code }`。
- 手机格式校验(参照现有 phone 校验,如 isValidPhone 类函数或 otp/send 的校验)→ 400 `BAD_REQUEST`。
- `consumeOtp('phone', phone, code)` 失败 → 401 `INVALID_CODE`。
- 新手机已被他人绑定 → 409 `PHONE_TAKEN`(依赖 `users_phone_uidx` 唯一冲突 23505,或显式查询;与 register 的 username 冲突处理同风格)。
- 成功:更新 `users.phone`;**auth_identities 语义**:新 phone 行 upsert(provider='phone', subject=phone),旧 phone 行删除(若有);返回 200 `{ ok: true, user }`。

### 5. 新路由 `POST /api/auth/me/email`(文件 `server/src/app/api/auth/me/email/route.ts`,新建)
- 与 phone 对称:body `{ email, code }`;`consumeOtp('email', email, code)`;409 `EMAIL_TAKEN`(lower(email) 唯一);
  更新 `users.email` + auth_identities 新 email 行 upsert + 旧 email 行删除。200 `{ ok: true, user }`。
- 邮箱格式校验同 otp/send。

### 6. 测试(`server/tests/account-security.test.mjs`,新建)
参照现有测试(memory store 分支)覆盖:
- login:邮箱+密码登录成功;username+密码仍成功;错误密码 → null;未知账号 → null(与 username 登录同消息路径)。
- me/password:有密码用户旧密码正确→成功、错误→WRONG_PASSWORD;无密码用户 OTP 正确→成功、错误→INVALID_CODE;
  newPassword 过短→PASSWORD_TOO_SHORT;未登录→401。
- me/phone / me/email:验证码正确→更新成功且返回脱敏前原始值;验证码错误→INVALID_CODE;占用→PHONE_TAKEN/EMAIL_TAKEN;未登录→401。
- hasPassword 字段:设密码前后 user JSON 中 hasPassword false→true。
- 若现有测试断言 `AccountUser` 形状的地方需要补 hasPassword,一并更新(小改)。

## 文件边界
拥有:`server/src/lib/account-store.ts`、`server/src/lib/account.ts`、`server/src/lib/password.ts`(仅如需,一般不动)、
`server/src/app/api/auth/me/password/route.ts`(新)、`server/src/app/api/auth/me/phone/route.ts`(新)、
`server/src/app/api/auth/me/email/route.ts`(新)、`server/tests/account-security.test.mjs`(新)、
`server/tests/` 内受影响的既有断言(小改)。
**不碰**:auth-modal.tsx、account-panel.tsx、i18n.ts、任何 `tech/*` 文档、otp/send 与 oauth 路由、.env*。
不要新建数据库迁移(users 表已够)。

## 门禁(必须在 worktree 内跑,全部通过才算 OK)
```bash
cd /Users/acccan/dm-wt-ps-backend/server && npm test
cd /Users/acccan/dm-wt-ps-backend/server && npm run typecheck
cd /Users/acccan/domain-map && make docs-check   # 主树跑,不因文档 WS 未合而失败
git diff --check
```
若测试因「现有测试需要 hasPassword 形状更新」而红,更新既有断言是允许的(小改),但不得削弱既有断言。
不要跑 `npm install` / `npm ci`(deny)。

## 提交
- Conventional Commits,频繁小步 commit(`feat(account): ...` / `test(account): ...`)。只 commit 你拥有的文件。
- 门禁全绿后,最后一个 commit 后写汇报。

## 汇报
写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-profile-security/reports/ws-backend.md`:
- 做了什么(每个 API 一段,含 file:line)
- 遇到的问题(重要:冲突/取舍/实现难点,一句话一个)
- 门禁结果(测试数、typecheck、docs-check、diff-check)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
