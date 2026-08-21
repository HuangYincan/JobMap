# 25 — Resend 验证码邮件(email OTP 真发)

**文档版本:** 1.0
**创建日期:** 2026-08-21
**状态:** 已实现(批次 `20260821-resend-otp` 已合入 dev 候选,feature/resend-otp-email;发送反馈 UI + 邮件模板润色批次 `20260821-resend-otp-feedback`)
**相关:** `tech/14-api-contract.md`(Account 段 OTP 行)、`tech/roles/development/deferred-ledger.md` D-04(部分落地)、批次目录 `tech/roles/development/parallel-sessions/20260821-resend-otp/` 与 `20260821-resend-otp-feedback/`

---

## 1. 背景与动机

项目已有完整 OTP 登录体系(存储 + 校验 + 限流 + 尝试锁),只缺「发送」环节。本批次把 **email 验证码经 Resend 真实发送**;phone 保留 demo 桩(000000),等待真实短信服务商接入。

现状(可验证事实):

- `POST /api/auth/otp/send`:email 经 Resend 真发,phone 返回 `{ ok, provider, expiresAt, demo: true, hint: '000000' }`
- 存储/校验不变:`auth_otp_challenges`(code_hash sha256、10 分钟 TTL)+ 内存 `otpGuards`(60s 冷却、24h 10 次上限、5 次错锁 15 分钟),测试已有
- 客户端 `auth-modal.tsx` 只读 `res.ok`/`body.message`,不依赖 `demo`/`hint`;后续批次补发送反馈 UI(顶部气泡 + 60s 重发倒计时,见第 9 节)

## 2. 端点契约

### `POST /api/auth/otp/send`

请求(不变):`{ provider: 'phone' | 'email', target }`;校验不变(400 BAD_REQUEST / invalid email / invalid phone)。

成功(provider 分支):

| provider | 200 响应 | 说明 |
|---|---|---|
| email | `{ ok: true, provider, expiresAt, messageId }` | 先 `issueOtp`(守卫先行保配额)再 `sendVerificationEmail`;`messageId` 取自 Resend 响应 body.id |
| phone | `{ ok: true, provider, expiresAt, demo: true, hint: '000000' }` | demo 桩,不发短信 |

### 错误映射(信封 `{ code, message }`,message 即用户可见文案)

| 错误 | HTTP | code | message |
|---|---|---|---|
| `EmailConfigError`(缺 `RESEND_API_KEY`) | 503 | `EMAIL_NOT_CONFIGURED` | 验证码服务暂不可用,请稍后再试 |
| `EmailRateLimitedError`(Resend 429,重试后仍限流) | 429 | `EMAIL_RATE_LIMITED` | 发送太频繁,请稍后再试 |
| `EmailAuthError`(Resend 401/403,key 失效/过期) | 503 | `EMAIL_PROVIDER_ERROR` | 验证码服务暂不可用,请稍后再试 |
| `EmailSendFailedError`(422/网络/其他) | 500 | `EMAIL_SEND_FAILED` | 验证码发送失败,请稍后再试 |

既有映射不动:`OtpRateLimitedError`/`OtpTooManyAttemptsError` → 429 `RATE_LIMITED`/`TOO_MANY_ATTEMPTS`(含 `retryAfterMs`)、`DbUnavailableError` → 503 `DB_UNAVAILABLE`。未知错误 re-throw,绝不返回验证码 / key / 错误栈 / Resend 原始错误。

## 3. 重试策略(用户拍板)

`sendVerificationEmail`(`server/src/lib/resend-client.ts`)最多 **2 次请求**:

- fetch 抛异常(网络错误)**或** HTTP 429 → 等 `retryDelayMs`(默认 **500ms**)→ 重试 1 次
- 其余状态码(401/403/422/其他)**不重试**
- 重试后仍失败按最终状态码映射(见上表;网络错误双失败 → `EmailSendFailedError`)

## 4. 发送内容

- 发件人:`contact@nvc.ac`;主题:`JobMap登录验证码`
- `buildVerificationEmailHtml`(`server/src/lib/verification-email.ts`):浅色卡片(蓝顶条 + JobMap 字标),全部内联 CSS + table 布局(邮件客户端剥 `<style>`),验证码大字(等宽 + 字距)独立高亮块突出显示,含 10 分钟有效期(`new Date(expiresAt).toLocaleString('zh-CN')` 显示到期时间,加粗),中文文案(请勿泄露 / 非本人操作可忽略 / 自动发送说明)
- `buildVerificationEmailText`:纯文本 fallback,同一事实
- 模板**只插值 code 与 expiresAt**,无任何用户输入插值(target 等用户数据不进模板,防邮件注入)

## 5. 环境变量

```bash
# server/.env.local(唯一生效配置文件),服务端秘密
RESEND_API_KEY=re_xxx
```

- 未配置 → 发送接口 503 `EMAIL_NOT_CONFIGURED`(优雅降级,不 crash)
- 申请:https://resend.com → API Keys
- Resend 免费额度约 **3000 封/月**(Free plan,2026-08 时点),超限返回 429 → 走 `EMAIL_RATE_LIMITED`

## 6. 垃圾箱预案

发件域 `nvc.ac` 需配好 **SPF + DKIM**(Resend 控制台 DNS 记录)。若邮件仍进垃圾箱,处理顺序:

1. 确认发件域 DNS 记录与 Resend 后台一致(SPF include `_spf.google.com` 之外的 Resend 专用记录)
2. 收件人侧把发件人加白名单(测试用 `contact@nvc.ac` 发给自己常用邮箱验证)
3. 备选:改用 Resend 默认域(`onboarding@resend.dev`,开发期)或换发件域,并在 Resend 后台看送达/垃圾箱报告

## 7. 密钥纪律

- `RESEND_API_KEY` 只在代码中 `process.env` 引用(`resendApiKey()`,模式同 `site-geocode.ts` 的 `amapWebKey()`)
- 绝不打印、绝不入库、绝不进请求 body/响应;成功只 `console.log` messageId
- key 失效(401/403)→ `console.warn` 提示「rotate RESEND_API_KEY」(不带 key 值)

## 8. Provider 拆分

| provider | 现状 | 后续 |
|---|---|---|
| phone | demo 桩:`demo: true, hint: '000000'`,不发送 | 接入真实短信服务商后删除 demo hint(D-04 余项) |
| email | Resend 真发,返回 `messageId` | 完成 |

## 9. 前端发送反馈(批次 `20260821-resend-otp-feedback`)

- 发送成功 → 页面顶部 fixed 气泡(`role="status"`,2.6s 自动消失),文案按 provider:email「验证码已发送,请查收邮件」/ phone「验证码已发送」
- 发送按钮 60s 倒计时(`RESEND_COOLDOWN_SECONDS = 60`,与后端 `otpRateConfig.cooldownMs = 60s` **对齐**,客户端禁用防连点),归零后显示「重新发送」
- 邮件主题改为 `JobMap登录验证码`;HTML 模板润色:蓝顶条 + JobMap 字标 + 高亮验证码块(`rgba(0,122,255,0.08)` 底 + 36px 700 `#007aff`),全内联样式 table 布局不变
