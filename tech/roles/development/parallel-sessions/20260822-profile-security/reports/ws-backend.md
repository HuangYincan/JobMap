# ws-backend 汇报(2026-08-22)

账号安全后端 API(foundation):邮箱密码登录 + hasPassword 字段 + 改密/换绑手机/邮箱三路由。分支 `feature/account-security-api`,5 个 commit(edf8843 → 6128a56),base `db97861`(dev)。

## 实际改动

### 1. `loginWithPassword` 支持邮箱
- `server/src/lib/account-store.ts:378` → 查询条件改 `WHERE (lower(u.username) = $1 OR lower(u.email) = $1) AND u.password_hash IS NOT NULL`;失败仍统一返回 null(路由 401 INVALID_CREDENTIALS,不泄露账号是否存在)。
- `server/src/lib/session-store.ts:156`(mem 分支)→ password identity 查不到时按 username/email 扫描用户,大小写不敏感。

### 2. user JSON 增加 `hasPassword`
- `server/src/lib/account.ts:51` → `AccountUser` 加 `hasPassword: boolean`。
- `server/src/lib/account-store.ts:76` `asUser` → `hasPassword: !!row.password_hash`;所有 users SELECT/RETURNING 补 `password_hash` 列(upsertIdentity、registerWithPassword、getSessionUser、updateUser、updateAvatar、loginWithPassword 及新增三写路径),GET /api/auth/me 与登录响应均带该字段;password_hash 仍由 asUser/publicUser 剥离,绝不返回前端。
- `server/src/lib/session-store.ts:114` `publicUser` → `hasPassword: !!user.passwordHash`;`StoredUser` 字面量补 hasPassword(upsertIdentity=false / registerWithPassword=true)。

### 3. `POST /api/auth/me/password`(新,`server/src/app/api/auth/me/password/route.ts`)
- 未登录 401 `UNAUTHORIZED`;newPassword ≥8 位(复用 `isValidPassword`)→ 400 `PASSWORD_TOO_SHORT`。
- 身份验证:传 `otp` → provider 必须 email|phone(400 BAD_REQUEST)、target 必须命中已绑定 email/phone(401 `NOT_BOUND`)、`consumeOtp` 失败 401 `INVALID_CODE`;未传 otp 且已有密码 → `oldPassword` 必填,`verifyUserPassword` 失败 401 `WRONG_PASSWORD`;未传 otp 且无密码 → 400 BAD_REQUEST。
- 成功 `setPassword`(account-store.ts:427,hashPassword 落库)→ 200 `{ ok:true, user }`(hasPassword:true)。
- catch 照 otp/verify:429 `TOO_MANY_ATTEMPTS` / 503 `DB_UNAVAILABLE` / 其余上抛,不泄漏内部错误与密钥。

### 4. `POST /api/auth/me/phone`(新,`server/src/app/api/auth/me/phone/route.ts`)
- 未登录 401;phone 格式校验(与 otp/send 同款 `^\+?\d{6,15}$`,忽略空格/连字符)→ 400 `BAD_REQUEST`;`consumeOtp('phone', phone, code)` 失败 → 401 `INVALID_CODE`。
- `bindPhone`(account-store.ts:442):users.phone 更新 + auth_identities 新 phone 行 upsert(ON CONFLICT DO NOTHING)+ 旧 phone 行删除;23505 → `PhoneTakenError` → 409 `PHONE_TAKEN`。200 `{ ok:true, user }`。

### 5. `POST /api/auth/me/email`(新,`server/src/app/api/auth/me/email/route.ts`)
- 与 phone 对称:`bindEmail`(account-store.ts:470),lower(email) 唯一 23505 → `EmailTakenError` → 409 `EMAIL_TAKEN`。

### 6. 仓储层(account-store.ts + session-store.ts)
- `verifyUserPassword`(:414 / mem :172)、`setPassword`(:427 / :179)、`bindPhone`(:442 / :204)、`bindEmail`(:470 / :220);`PhoneTakenError`/`EmailTakenError` 与 `UsernameTakenError` 同风格,`withDbWrite` 原样透传(409,不包 DbUnavailableError)。

### 7. 测试
- `server/tests/account-security.test.mjs`(新,12 项):邮箱登录(成功/大小写/错密/未知账号)、username 登录回归、hasPassword false→true 翻转 + 无 hash 泄漏、setPassword OTP 门、bindPhone/bindEmail 换绑+身份增删+占用冲突(mem 扫描 + DB 23505 双路径)、三路由薄壳契约(401/400/409/429/503 + 无 password_hash)、SQL 契约。
- `server/tests/account.test.mjs`(小改):`updateUser/updateAvatar RETURNING 必须带回 username` 断言列序适配 `username, password_hash, preferences`(2→5 处写路径),守卫意图不变。

## 门禁结果

- `npm test`:1281 测试,1279 通过 / 0 失败(2 skip,与既有 skip 数一致;新增 12 项全过)。
- `npm run typecheck`:通过(先修了 5 个类型错:StoredUser 字面量 hasPassword、写路径行类型 UserRowWithProvider)。
- `make docs-check`:**无法直接执行**(沙箱对 `cd /Users/acccan/domain-map` 与 `make -C` 均拦截,headless 无批准通道)。做等效验证:本分支 8 个改动文件 **0 个 .md**;改动文件不含 docs-check 禁用的任何模式(docs/roles/、docs/zh-cn/、预计发布时间.*2026-02-10、BOSS.*MVP.*爬、小红书.*MVP.*爬);主树未被动过 → docs-check 结果与批次开工前一致。请 boss 视需要主树复跑。
- `git diff --check`:通过(exit 0)。

## 遇到的问题

- **边界说明**:`server/src/lib/session-store.ts` 不在 prompt「拥有」清单里,但任务 1/2 明确要求「含 mem 分支 memLoginWithPassword」「mem 分支同样处理」,account-store 的 mem 回落即该文件 → 视为任务必要范围(改 8 处:loginWithPassword 邮箱、publicUser hasPassword、新增 4 个 mem 函数与 2 个错误类)。请 boss 确认。
- `make docs-check` 主树执行被沙箱 cd/make 批准门拦截 → 以「0 md 改动 + 禁用模式零命中 + 主树未动」等效验证,需 boss 确认可接受。
- 既有断言 `RETURNING 必须带回 username`(account.test.mjs)因 RETURNING 列序变化 2→5 处命中而红 → 按 prompt 授权小改(更新列序与计数,不削弱)。
- `storeUpsert` 测试最初漏传 email 字段导致 `noHash.email` undefined 抛 TypeError → 修正测试入参(实现无误)。
- 23505 占用冲突若在 `withDbWrite` 内抛会被包成 DbUnavailableError(503)→ 将 PhoneTakenError/EmailTakenError 加入 withDbWrite 透传,与 UsernameTakenError 同处理(409 语义正确)。
- 路由无法被 node:test 直接 import(next/server + `@/` 别名,仓库既有契约)→ 照 oauth.test.mjs 先例:行为逻辑 store 层直测 + 路由薄壳正则契约。

## 证据

- 测试输出摘要:Node test runner,`tests 1281 / pass 1279 / fail 0`(两次全量跑一致)。
- typecheck:`tsc --noEmit` 零错误。
- 提交:edf8843(feat hasPassword+邮箱登录)、7b4673d(feat 仓储)、b176bcd(feat 三路由)、3ced1c6(fix typecheck)、6128a56(test 12 项)。
- 复现:`cd server && npm test && npm run typecheck`。

门禁: PASSED
结论: OK
