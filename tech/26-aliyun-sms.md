# 26 — 阿里云短信认证服务(phone OTP 真发)

**文档版本:** 1.0
**创建日期:** 2026-08-22
**状态:** 已实现(批次 `20260822-aliyun-sms-otp` 合入 dev 后生效;实现与文档同批并行,如 README 所述)
**相关:** `tech/14-api-contract.md`(Account 段 OTP 行)、`tech/25-resend-email.md`(email 分支对照)、`tech/roles/development/deferred-ledger.md` D-04(2026-08-22 关闭)、批次目录 `tech/roles/development/parallel-sessions/20260822-aliyun-sms-otp/`

---

## 1. 背景与动机

项目 OTP 体系已完整:存储/校验/限流/尝试锁全链(`auth_otp_challenges` + 内存 `otpGuards`)加上 email 经 Resend 真发(见 tech/25);唯一遗留是 phone 分支此前为 demo 桩(`demo: true, hint: '000000'`,决策台账 D-04 遗留)。本批接入**阿里云短信认证服务**(`SendSmsVerifyCode`,dypnsapi `2017-05-25`)真实发送 6 位验证码,并**删除 demo hint**,phone/email 统一走真实验证路径。

现状(可验证事实):

- `POST /api/auth/otp/send`:email 经 Resend 真发;phone 经阿里云短信认证服务真发;`demo` / `hint` 字段已删除
- 存储/校验/限流不变:`auth_otp_challenges`(code_hash sha256、10 分钟 TTL)+ 内存 `otpGuards`(60s 冷却、24h 10 次上限、5 次错锁 15 分钟),phone/email 共用同一条链
- 服务端生成 6 位码直接传值(`TemplateParam = {"code": "6位码"}`),本地 `consumeOtp` 校验
- 客户端零改动:`auth-modal.tsx` phone tab 已存在且为默认 tab,只读 `res.ok` / `body.message`

## 2. 端点契约

### `POST /api/auth/otp/send`

请求(不变):`{ provider: 'phone' | 'email', target }`;校验不变(400 BAD_REQUEST / invalid email / invalid phone),既有 OTP 限流/尝试锁不动。

成功(provider 分支):

| provider | 200 响应 | 说明 |
|---|---|---|
| email | `{ ok: true, provider, expiresAt, messageId }` | 见 tech/25 §2 |
| phone | `{ ok: true, provider, expiresAt, requestId }` | `requestId` 取自阿里云响应;`demo` / `hint` 已删除 |

### 错误映射(信封 `{ code, message }`,message 即用户可见文案,风格同 tech/25 §2)

| 错误 | HTTP | code | message |
|---|---|---|---|
| 缺任一 `ALIYUN_*` 配置 | 503 | `SMS_NOT_CONFIGURED` | 验证码服务暂不可用,请稍后再试 |
| 阿里云业务错误 `FREQUENCY_FAIL`(频控) | 429 | `SMS_RATE_LIMITED` | 发送太频繁,请稍后再试 |
| 阿里云业务错误 `BUSINESS_LIMIT_CONTROL`(天级流控) | 429 | `SMS_DAY_LIMITED` | 今日发送次数已达上限,请明天再试 |
| key 失效 / 签名错误(阿里云鉴权类错误) | 503 | `SMS_PROVIDER_ERROR` | 验证码服务暂不可用,请稍后再试 |
| 网络 / 其他(重试后仍失败) | 500 | `SMS_SEND_FAILED` | 验证码发送失败,请稍后再试 |

既有映射不动:`OtpRateLimitedError`/`OtpTooManyAttemptsError` → 429 `RATE_LIMITED`/`TOO_MANY_ATTEMPTS`(含 `retryAfterMs`)、`DbUnavailableError` → 503 `DB_UNAVAILABLE`(同 tech/25 §2)。未知错误 re-throw,绝不返回验证码 / key / 错误栈 / 阿里云原始错误。

## 3. 调用方式(零依赖手写 RPC 签名)

GET `https://dypnsapi.aliyuncs.com/?<signed-query>`(`Format=JSON`),RPC 签名(HMAC-SHA1),**不引入任何 SDK/npm 依赖**(项目惯例,同 `resend-client.ts` 零 SDK)。签名步骤:

1. 组装请求参数:公共参数(`AccessKeyId`、`Action=SendSmsVerifyCode`、`Version=2017-05-25`、`Format=JSON`、`SignatureMethod=HMAC-SHA1`、`SignatureVersion=1.0`、`SignatureNonce` 每次唯一、`Timestamp` UTC ISO8601)+ 业务参数(`PhoneNumber`、`SignName`、`TemplateCode`、`TemplateParam`)
2. 参数按 key 字典序排序,value 经 **RFC3986 percent-encode**;拼成待签串 `GET&%2F&<percent-encoded-query>`
3. 用 `HMAC-SHA1(secret + '&', stringToSign)` 签名 → base64 → 再 RFC3986 编码,作为 `Signature` 参数拼入 query
4. `TemplateParam = {"code": "6位码"}` **直接传值模式**:服务端生成 6 位码直接放入 JSON 传给阿里云,由短信网关下发,本地 `consumeOtp` 校验

**取舍说明**:阿里云官方 `##code##` 占位符 + `CheckSmsVerifyCode`(服务端核验)路径**不采用** —— 本地 `auth_otp_challenges` 已有生成/存储/校验/限流全链,直接传值保持 phone/email 统一验证路径与既有守卫;阿里云「无法校验自定义码」对本方案无影响(校验本就在本地完成),本方案也未使用阿里云侧付费核验能力。

## 4. 重试策略

`aliyun-sms-client` 最多 **2 次请求**:

- fetch 抛异常(网络错误)→ 等 **~500ms** → 重试 1 次;重试后仍失败 → `SmsSendFailedError`(500 `SMS_SEND_FAILED`)
- 业务错误(阿里云返回业务错误码)**不重试**:`FREQUENCY_FAIL` → 429 `SMS_RATE_LIMITED`;`BUSINESS_LIMIT_CONTROL` → 429 `SMS_DAY_LIMITED`;鉴权类(key 失效/签名错)→ 503 `SMS_PROVIDER_ERROR`
- 其余 HTTP 状态 / 其他错误 → 500 `SMS_SEND_FAILED`

## 5. 环境变量

```bash
# server/.env.local(唯一生效配置文件),服务端秘密
ALIYUN_ACCESS_KEY_ID=xxx
ALIYUN_ACCESS_KEY_SECRET=xxx
ALIYUN_SMS_SIGN_NAME=xxx      # 系统赠送签名,不支持自定义
ALIYUN_SMS_TEMPLATE_CODE=xxx  # 赠送模板,参数名 code
```

- 四条缺任一 → 发送接口 503 `SMS_NOT_CONFIGURED`(优雅降级,不 crash,不影响 email/其他功能)
- 签名 = **系统赠送签名,不支持自定义**;模板 = **赠送模板,参数名 `code`**(若用户后续换成自定义模板且参数名不同,`TemplateParam` 键名需对应用户模板,由用户告知)
- 获取途径见 §6;冒烟流程见批次 `20260822-aliyun-sms-otp/deferred-notes.md`

## 6. 开通步骤(用户侧)

1. 阿里云控制台开通「短信认证服务」(dypnsapi)
2. 获取**系统赠送签名** + **赠送模板 CODE**(短信认证服务免费赠送,不支持自定义签名)
3. RAM 创建 AccessKey,授权 `dypns:SendSmsVerifyCode`
4. 写入 `server/.env.local`(§5),用测试手机号走「发码 → 收短信 → 输入验证码 → 登录」全流程冒烟

计费:短信**按条计费**(运营商回执失败不计费);本方案未使用付费的阿里云侧核验能力(`CheckSmsVerifyCode` 不调用,校验走本地 `auth_otp_challenges`)。

## 7. 密钥纪律

同 tech/25 §7:

- `ALIYUN_*` 只在代码中 `process.env` 引用(模式同 `site-geocode.ts` 的 `amapWebKey()`)
- 绝不打印、绝不入库、绝不进请求 body/响应;成功只 console.log requestId
- 鉴权失败(key 失效/签名错)→ `console.warn` 提示检查/轮换 AccessKey(不带 key 值)

## 8. Provider 拆分

| provider | 现状 | 后续 |
|---|---|---|
| phone | 阿里云短信认证服务真发,返回 `requestId`(2026-08-22) | 完成(demo hint 已删除) |
| email | Resend 真发,返回 `messageId` | 完成 |

## 9. 备注

- `db/migrations/005` 注释「Production send goes through Aliyun SMS (PNvs)」在本批实现后**成为事实**(迁移文件不可变,未改)
- 本批仅剩 Env-only 遗留:用户配置真实 `ALIYUN_*` 值 + 真实短信冒烟(见批次 deferred-notes;deferred-ledger D-04 关闭 / D-29 登记)
