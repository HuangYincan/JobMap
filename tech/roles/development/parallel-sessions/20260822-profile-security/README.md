# 批次 20260822-profile-security — 账号安全:密码/手机/邮箱管理 + 邮箱密码登录

## 目标

1. **Profile 密码、手机、邮箱管理**(现为占位 `showDemo()`):
   - 「密码与安全」:设置密码(无密码账号,OTP 验证身份)/ 修改密码(已有密码,旧密码验证;或 OTP)
   - 「手机与邮箱」:绑定/更换手机(新手机 OTP 验证)、绑定/更换邮箱(新邮箱 OTP 验证),409 防占用
2. **邮箱+密码登录**:`POST /api/auth/password/login` 的 `username` 字段同时接受**邮箱**;
   登录卡片(AuthModal password tab)登录字段改为「邮箱或用户名」。邮箱注册仍走 OTP(email tab),
   注册后到 Profile「密码与安全」设置密码,即可用邮箱+密码登录。

## 现状(已探明,2026-08-22)

- 后端零实现:全库无 changePassword/bindPhone/bindEmail 任何 handler;`loginWithPassword`
  (`server/src/lib/account-store.ts:362`)只按 `lower(u.username)` 匹配。
- users 表已有 `phone`/`email`/`username`/`password_hash`(迁移 005/014,phone 与 lower(email)
  部分唯一索引),**无需新迁移**。`auth_identities` provider 含 phone/email/password/github/google/x/wechat。
- OTP 体系可复用:`issueOtp`(account-store.ts:542)/ `consumeOtp`(:583)、`POST /api/auth/otp/send`
  (email→Resend / phone→阿里云,已配好,无新 env)。
- 前端占位:account-panel.tsx:587-595「密码与安全」「手机与邮箱」两行均 `showDemo()`。
- AuthModal(auth-modal.tsx)4 tab:phone/email/password/other;password tab 登录/注册字段是
  **username**(:357-399);用户 JSON 无 `hasPassword` 字段(需加,前端据此区分设置/修改)。

## Workstream 表

| WS | 分支 | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|
| ws-backend | `feature/account-security-api` | `loginWithPassword` 支持 email;新增 `POST /api/auth/me/password` / `me/phone` / `me/email`;user JSON 加 `hasPassword`;tests | `server/src/lib/account-store.ts`、`server/src/lib/account.ts`(hasPassword)、`server/src/lib/password.ts`(仅如需)、`server/src/app/api/auth/me/{password,phone,email}/route.ts`(新)、`server/tests/account-security.test.mjs`(新) | auth-modal、account-panel、i18n.ts、tech/* |
| ws-frontend | `feature/account-security-frontend` | Profile「密码与安全」「手机与邮箱」真实化(子面板+表单+OTP 流程+脱敏展示);AuthModal password tab 登录接受邮箱或用户名;hasPassword 区分设置/修改;i18n 新 key | `server/src/components/account-panel.tsx`、`account-panel.module.css`、`server/src/components/auth-modal.tsx`、`auth-modal.module.css`、`server/src/lib/i18n.ts` | 后端路由/account-store、tech/*、otp/send 路由 |
| ws-docs | `feature/account-security-docs` | tech/28-account-security.md(新,契约+流程+决策);tech/14:26-30 附近契约更新;tech/README.md 索引 | `tech/28-account-security.md`(新)、`tech/14-api-contract.md`(仅 Account 节)、`tech/README.md` | 任何代码 |

## 合并顺序

1. ws-backend(foundation)→ 2. ws-frontend → 3. ws-docs(依赖序;文件不相交,前端 i18n.ts 单 worker 独占;merger 逐个 `--no-ff`,红则停)

## 共享契约(三份 prompt 同一份,禁止漂移)

- `POST /api/auth/password/login` body `{ username, password }` — username 接受邮箱或用户名;失败统一 401 `INVALID_CREDENTIALS`。
- `POST /api/auth/me/password` body `{ oldPassword?, otp?: { provider:'email'|'phone', target, code }, newPassword }` — 已有密码:oldPassword 必填(401 `WRONG_PASSWORD`),亦可用 otp 替代;无密码:必填 otp(provider/target 必须命中已绑定凭证,401 `NOT_BOUND`/`INVALID_CODE`);newPassword ≥8 位(400 `PASSWORD_TOO_SHORT`);成功 200 `{ ok:true, user }`。
- `POST /api/auth/me/phone` body `{ phone, code }` — OTP 验证新手机;409 `PHONE_TAKEN`;成功 200 `{ ok:true, user }`(user.phone 已更新)。更换语义:users.phone 更新 + auth_identities 新 phone 行 upsert + 旧 phone 行删除;不提供解绑。
- `POST /api/auth/me/email` body `{ email, code }` — 同上,409 `EMAIL_TAKEN`。
- user JSON 增加 `hasPassword: boolean`(`password_hash` 非空),其余字段不动。
- OTP 发送一律复用现有 `POST /api/auth/otp/send`(provider=phone|email,target=新凭证或已绑定凭证),me/* 路由只 `consumeOtp` 校验。

## 设计决策(已由 boss 裁定,worker 照此实现)

- **不做完全解绑**手机/邮箱(保证至少一个登录凭证可找回;更换即可覆盖)。
- **password tab 注册模式保持 username**(邮箱注册走 email tab OTP,注册后 Profile 设密码)。
- 登录卡片只改 password tab 文案/校验语义,不动 4-tab 结构与其余样式。
- 密码设置表单身份验证:已有密码→旧密码;无密码→已绑定凭证 OTP。
- 手机/邮箱展示脱敏(如 `138****5678`),未绑定显示「未绑定」。

## 手动配置清单(Env-only → deferred-notes,最终汇报给用户)

- 无新增 env;Resend / 阿里云 SMS 已配置,复用。

## 门禁(每 WS 都要跑)

`cd server && npm test`(全量,新增测试须通过)、`npm run typecheck`、`make docs-check`、`git diff --check`。

## Boss 裁决
- 待各 WS 汇报后按「遇到的问题」段逐项判定;技术问题自裁 re-dispatch;改现有 UI 设计/Env-only → deferred-notes.md。
