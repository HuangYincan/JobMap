# 28 — 账号安全(密码管理 / 手机与邮箱绑定 / 邮箱+密码登录)

**文档版本:** 1.0
**创建日期:** 2026-08-22
**状态:** 契约定稿(批次 `20260822-profile-security` 实现中:后端 ws-backend、前端 ws-frontend 并行,合入 dev 后生效)
**相关:** `tech/14-api-contract.md`(Account 段)、`tech/27-oauth-login.md`(OAuth 登录)、`tech/25-resend-email.md` / `tech/26-aliyun-sms.md`(OTP 真发)、`server/tests/account-security.test.mjs`

---

## 1. 背景与动机

2026-08-22 引入**账号安全管理**能力:设置/修改密码、绑定/更换手机与邮箱、邮箱+密码登录。

此前账号体系的登录凭证来源有:email OTP 登录(2026-08-21 真发,tech/25)、phone OTP 登录(2026-08-22 真发,tech/26-aliyun-sms.md)、OAuth(tech/27)、username+password 注册(2026-08-19)。缺口有二:

- **OTP 注册用户没有密码**:email/phone OTP 验证即登录,一旦 OTP 通道不可用(短信欠费、邮箱不可达)将无法登录;且无法用密码登录。
- **密码用户没有手机/邮箱绑定**:无法通过已绑定凭证做身份验证与找回。

本批次补齐:**设置密码**(OTP 用户)→ 之后可用**邮箱+密码**登录;**修改密码**;所有用户均可**绑定/更换手机与邮箱**。设计上保持**不做完全解绑**——每个账号至少保留一个可用登录凭证,避免用户把自己锁在门外。

## 2. 流程总览

**设置/修改密码**

```
Profile「密码与安全」→ 输入新密码(已有密码用户还需旧密码或 OTP 验证码)
  → POST /api/auth/me/password { oldPassword?, otp?, newPassword }
  → 身份验证(§4.1)→ scrypt 哈希写入 users.password_hash
  → 200 { ok: true, user }(user.hasPassword 变为 true)
```

**绑定/更换手机或邮箱**

```
Profile「手机与邮箱」→ 输入新 phone/email → 先走 POST /api/auth/otp/send 收验证码(复用现有 OTP 发送)
  → POST /api/auth/me/phone { phone, code } 或 POST /api/auth/me/email { email, code }
  → consumeOtp 校验 → 更新 users.phone|email + auth_identities 新行 upsert + 旧行删除
  → 200 { ok: true, user }
```

**邮箱+密码登录**

```
AuthModal password tab「邮箱或用户名」+ 密码 → POST /api/auth/password/login { username, password }
  → 先按邮箱(lower)匹配 auth_identities,再按用户名匹配(不泄露账号是否存在)
  → 成功写 session cookie → { ok: true, user }
```

## 3. 端点契约

### `POST /api/auth/password/login`

body `{ username, password }`;`username` 接受**邮箱或用户名**(邮箱按 lower 匹配;OTP 邮箱注册用户设置密码后即可用此登录)。

- 成功 → 200 `{ ok: true, user }` + session cookie
- 失败 → 401 `INVALID_CREDENTIALS`,**同一错误码、同一 message**(不泄露账号是否存在)
- 通用 400 `BAD_REQUEST`(body 非法 / 字段缺失)

### `POST /api/auth/me/password`

body `{ oldPassword?, otp?: { provider: 'email'|'phone', target, code }, newPassword }`。**身份验证规则**:

- 已有密码 → `oldPassword` 必填(可被 otp 替代)
- 无密码(OTP 注册用户)→ `otp` 必须,且 `otp.target` 必须命中该用户已绑定的凭证(邮箱或手机)
- 成功 → 200 `{ ok: true, user }`(写入/更新 `users.password_hash`,`user.hasPassword` 反映新状态)

| 场景 | HTTP | code |
|---|---|---|
| `newPassword` 不满足强度(长度 < 8,`lib/password.ts` `isValidPassword`) | 400 | `PASSWORD_TOO_SHORT` |
| 已有密码且 `oldPassword` 错误 | 401 | `WRONG_PASSWORD` |
| OTP 校验失败(不匹配 / 过期 / 已被消费) | 401 | `INVALID_CODE` |
| 无密码用户:`otp` 缺失,或 `otp.target` 未命中已绑定凭证 | 401 | `NOT_BOUND` |
| 未登录 | 401 | `UNAUTHORIZED` |
| body 非法 / 缺字段 / provider 非法 | 400 | `BAD_REQUEST` |

### `POST /api/auth/me/phone`

body `{ phone, code }`(code 来自 `POST /api/auth/otp/send` 发往该 phone 的验证码)。

- 成功 → 200 `{ ok: true, user }`(更新 `users.phone` + auth_identities upsert/删除)
- 409 `PHONE_TAKEN`(该手机号已被他人绑定)/ 401 `INVALID_CODE`(验证码错误/过期)/ 401 `UNAUTHORIZED`(未登录)

### `POST /api/auth/me/email`

body `{ email, code }`(code 来自 `POST /api/auth/otp/send` 发往该 email 的验证码)。

- 成功 → 200 `{ ok: true, user }`(更新 `users.email` + auth_identities upsert/删除)
- 409 `EMAIL_TAKEN`(该邮箱已被他人绑定)/ 401 `INVALID_CODE`(验证码错误/过期)/ 401 `UNAUTHORIZED`(未登录)

### user JSON 变更:`hasPassword`

- `hasPassword: boolean` = `users.password_hash` 非空;**`GET /api/auth/me` 与所有登录响应均含**。
- 密码哈希本身**永不返回前端**(沿用既有约定,`lib/password.ts` 只做单向哈希与校验)。

信封约定:错误统一 `{ ok: false, code, message }`;未知错误 re-throw,绝不返回密码 / 哈希 / 错误栈(沿用 tech/27 §8 风格)。

## 4. 语义与决策

- **绑定/更换 = 更新 + 换身份行**:更新 `users.phone|email` 字段,`auth_identities` 按新凭证 upsert 新行、删除旧行;原凭证即失效。
- **不做完全解绑**:`me/phone` / `me/email` 不提供解绑动作,保证每个账号**至少保留一个登录凭证**(邮箱 / 手机 / 用户名 / OAuth provider),防止用户唯一凭证被换走后无法登录。
- **邮箱注册仍走 OTP**:email tab 验证即登录(行为不变,tech/25);设置密码在 Profile「密码与安全」,设置后可用邮箱+密码登录。
- **password tab 注册保持 username**(行为不变,2026-08-19 契约);仅**登录字段**扩展为接受邮箱或用户名。
- **OTP 发送复用 `POST /api/auth/otp/send`**(email/phone 真发通道不变,tech/25 / tech/26-aliyun-sms.md);`me/*` 路由**只 `consumeOtp` 校验**,不重复发送逻辑。
- **密码哈希沿用 `lib/password.ts` scrypt**(格式 `scrypt$N$r$p$salt$hash`,N=16384 / r=8 / p=1,salt 16 字节 hex,hash 32 字节 hex;`isValidPassword` 最短 8 位),密码永不返回前端。

## 5. 前端入口

- Profile → 「密码与安全」子面板:设置密码(无密码用户)/ 修改密码(已有密码用户,需旧密码或 OTP 验证)。
- Profile → 「手机与邮箱」子面板:绑定/更换手机、绑定/更换邮箱(先 OTP 发送,再提交 code)。
- AuthModal password tab:登录字段 label 改为「邮箱或用户名」,placeholder 相应提示;仍保持 username 注册 tab 不变。

## 6. 测试(`server/tests/account-security.test.mjs`)

node --test,内存模式、零网络(复用 `__accountStoreTest.poolOverride` / `withEnv` 先例):

- `password/login`:邮箱与用户名均可登录;未知账号与密码错误统一 401 `INVALID_CREDENTIALS`(响应完全一致)
- `me/password`:无密码用户设置密码(otp 必须、target 命中已绑定凭证);已有密码用户改密码(oldPassword 校验、otp 可替代);`PASSWORD_TOO_SHORT` / `WRONG_PASSWORD` / `INVALID_CODE` / `NOT_BOUND` / `UNAUTHORIZED` 全覆盖
- `me/phone` / `me/email`:绑定成功 → `users.phone|email` 更新 + auth_identities 换行;重复绑定他人凭证 → 409 `PHONE_TAKEN` / `EMAIL_TAKEN`;错误码 → 401 `INVALID_CODE`
- user JSON:`hasPassword` 随设置/修改密码正确翻转;`GET /api/auth/me` 与登录响应均含且一致

## 7. 安全说明

- **不泄露账号存在性**:`password/login` 对未知用户与错误密码返回**完全相同的** 401 `INVALID_CREDENTIALS`(message 也一致)。
- **密码单向存储**:scrypt 加盐哈希,参数随值存储(`scrypt$N$r$p$salt$hash`),`timingSafeEqual` 恒定时间比较;哈希与密码永不进日志 / 请求 / 响应。
- **身份验证分层**:改密码必须证明「我是账号本人」——有密码用密码,无密码用**已绑定凭证**的 OTP,`NOT_BOUND` 防止拿任意未绑定 target 的验证码通过。
- **唯一凭证保护**:`PHONE_TAKEN` / `EMAIL_TAKEN` 基于唯一索引(409 冲突),且不做完全解绑,账号永不失联。
- **OTP 复用既有守卫**:`consumeOtp` 沿用 `otp-guard` 的过期 / 消费次数限制(tech/25 / tech/26-aliyun-sms.md),`me/*` 不再新增发送路径。
