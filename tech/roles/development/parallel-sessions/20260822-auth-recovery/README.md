# 批次 20260822-auth-recovery — 无凭证用户可恢复性:注册引导绑定 + 忘记密码入口

## 目标(用户已确认根治方案)

1. **注册引导绑定**:username+password 注册成功后,弹窗内引导绑定手机或邮箱(一次 OTP 验证,
   可跳过)。绑定复用已合并的 `POST /api/auth/me/phone` / `me/email`(登录态即可,无新后端 API)。
2. **登录卡片「忘记密码」入口**:password tab 登录模式加「忘记密码?」链接 → 切到验证码登录 tab
   + 提示「验证码登录后可在 个人资料 → 密码与安全 重设密码」。

背景:批次 20260822-profile-security 已合并(dev HEAD 含 me/password|phone|email + hasPassword +
password/login 支持邮箱)。本批补上「未绑定凭证用户忘密码死锁」的恢复通道:
- 死锁根因:OTP 验证码登录按 identity subject 匹配,未绑定手机/邮箱验证会**新建账号**;绑定需登录态。
- 解:注册时引导绑定(让新账号必有备用凭证);登录卡片入口(让已绑定用户知道验证码登录 = 恢复通道)。

## Workstream 表

| WS | 分支 | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|
| ws-frontend | `feature/auth-recovery` | auth-modal 注册后绑定引导 step + password tab「忘记密码」入口 + i18n + tech/28 补「恢复通道」节 | `server/src/components/auth-modal.tsx`、`auth-modal.module.css`、`server/src/lib/i18n.ts`、`tech/28-account-security.md`(仅新增「忘记密码恢复」一节) | 后端路由、account-panel.tsx、map-shell.tsx、其它 tech |

## 合并顺序
1. ws-frontend(单 WS,merger 直合)

## 共享契约(与 tech/28 一致)
- 绑定复用 `POST /api/auth/me/phone` `{ phone, code }` / `POST /api/auth/me/email` `{ email, code }`
  (409 PHONE_TAKEN / EMAIL_TAKEN;401 INVALID_CODE);OTP 发送复用 `POST /api/auth/otp/send`
  (provider=phone|email,target,响应 expiresAt / retryAfterMs,60s 冷却)。
- 登录仍 `POST /api/auth/password/login` `{ username, password }`(username 接受邮箱)。

## 设计决策(boss 已裁定)
- 注册引导为**可跳过**步骤(不强制;提示文案说明忘记密码可用验证码找回)。
- 「忘记密码」点击 → 切到 **email tab** + notice 提示(文案见布局图)。
- 绑定引导 UI 复用 auth-modal 既有样式体系(tabs/field/login 按钮),不引入新设计语言。

## 门禁
`cd server && npm test`(全量)、`npm run typecheck`、`make docs-check`(主树)、`git diff --check`。

## Boss 裁决
- 技术问题自裁;改现有 UI 设计 / Env-only → deferred-notes.md。
