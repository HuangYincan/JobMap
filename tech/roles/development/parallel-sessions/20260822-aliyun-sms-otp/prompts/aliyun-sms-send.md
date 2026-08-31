# Workstream: aliyun-sms-send — 阿里云短信认证服务接入(phone OTP 真发)

## 背景

项目 OTP 登录体系已有(email 经 Resend 真发),phone 仍是 **demo 桩**:`POST /api/auth/otp/send` 返回固定码 `{ ok, provider, expiresAt, demo: true, hint: '000000' }`,从不发短信。本 WS 把 phone 换成**阿里云短信认证服务**(`SendSmsVerifyCode`,dypnsapi `2017-05-25`)真实发送,**删除 demo/hint 字段**。前端零改动(auth-modal 只读 `res.ok`/`body.message`)。决策台账 D-04 由此落地。

参考实现(照抄模式):`server/src/lib/resend-client.ts`(fetchImpl 注入 + typed error + 重试)+ `server/tests/resend-client.test.mjs`(withEnv + fake fetch + `retryDelayMs: 0`)。API 文档:https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode

## 你的工作环境(已预建,勿动 git 管理)

- worktree:`/Users/acccan/dm-wt-aliyun-sms-send`(分支 `feature/aliyun-sms-send`,自 dev 切出)
- 所有开发在此 worktree 内完成;`server/node_modules` 已 symlink,可直接 `cd server && npm test`
- **不要** merge、push、建分支、npm install、跑任何 import:/geocode:/db-* 命令
- 汇报写到:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-aliyun-sms-otp/reports/aliyun-sms-send.md`(跨主树,已授权)
- 代码注释用中文,与所在文件风格一致;先读 `server/AGENTS.md`(Next.js 16 有破坏性变更,写代码前查 `node_modules/next/dist/docs/` 相关指南)

## 任务(按序)

### 1. 新库 — `server/src/lib/aliyun-sms-client.ts`(零依赖,手写阿里云 RPC 签名)

**配置读取**(仿 `resend-client.ts:19` 的 `resendApiKey()`):
```ts
export function aliyunSmsConfig(): { accessKeyId: string; accessKeySecret: string; signName: string; templateCode: string } | undefined
```
- 读 `process.env.ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE`,各 `.trim()`,任一缺失 → `undefined`

**Typed errors**(仿 resend-client 的 `EmailConfigError` 写法):
- `SmsConfigError`(缺配置)、`SmsRateLimitedError`(阿里云 `FREQUENCY_FAIL`)、`SmsDayLimitedError`(阿里云 `BUSINESS_LIMIT_CONTROL`)、`SmsAuthError`(AccessKey 无效/签名不匹配/Forbidden)、`SmsSendFailedError`(其余业务错误/网络/HTTP 异常)

**主函数**:
```ts
export async function sendSmsVerifyCode(
  input: { phoneNumber: string; code: string },
  options?: { fetchImpl?: typeof fetch; now?: () => Date; signatureNonce?: string; retryDelayMs?: number },
): Promise<{ requestId: string }>
```
- 配置缺失 → 直接抛 `SmsConfigError`(不调 fetch)
- 签名(阿里云标准 RPC 签名,零依赖 `node:crypto`):
  1. 参数表:`AccessKeyId`、`Action=SendSmsVerifyCode`、`Format=JSON`、`SignatureMethod=HMAC-SHA1`、`SignatureVersion=1.0`、`SignatureNonce`(默认 `randomUUID()`,可注入)、`Timestamp`(默认 `now().toISOString().replace(/\.\d{3}Z$/, 'Z')` —— 形如 `2026-08-22T08:00:00Z`,可注入)、`Version=2017-05-25`、`PhoneNumber`、`SignName`、`TemplateCode`、`TemplateParam`(=`JSON.stringify({ code })`,直接传值模式;**不传** ValidTime/Interval/CodeLength/CodeType —— 本地 TTL 与守卫已管控,见批次 README 决策)
  2. `percentEncode(s) = encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())`(RFC3986 严格编码)
  3. 全部参数 key 按字典序升序,拼 `percentEncode(key)=percentEncode(value)` 以 `&` 连接 → `canonicalizedQuery`
  4. `StringToSign = 'GET&%2F&' + percentEncode(canonicalizedQuery)`
  5. `Signature = createHmac('sha1', secret + '&').update(StringToSign).digest('base64')`
  6. 最终 URL:`https://dypnsapi.aliyuncs.com/?` + `canonicalizedQuery` + `&Signature=` + `percentEncode(Signature)`
- 请求:GET 该 URL(fetchImpl 注入,默认全局 fetch;无需特殊 header)
- **重试**:fetch 抛异常(网络错误)→ 等 `retryDelayMs`(默认 500)→ 重试 1 次;其余(HTTP 非 200、业务错误)**不重试**
- 响应解析(JSON):
  - `body.Code === 'OK'` → 成功:`console.log` 记 requestId(取自 `body.RequestId ?? body.Model?.RequestId ?? ''`;绝不打印验证码/key),返回 `{ requestId }`
  - `body.Code` 非 OK → 按映射抛错:已知业务错误码(见下)之外一律 `SmsSendFailedError`,并 `console.log` 错误码(不带敏感信息)
  - HTTP 非 200 → 尝试 `res.json()`:有 `Code` 字段 → 同上业务映射;否则 → `SmsSendFailedError`
- **错误码映射**(body.Code):
  | 阿里云 Code | 抛出 |
  |---|---|
  | `FREQUENCY_FAIL`(发送频控) | `SmsRateLimitedError` |
  | `BUSINESS_LIMIT_CONTROL`(号码天级流控) | `SmsDayLimitedError` |
  | 以 `InvalidAccessKeyId` / `SignatureDoesNotMatch` / `AuthFailure` / `Forbidden` 开头或包含的鉴权类 | `SmsAuthError`(并 `console.warn`「aliyun sms auth failed, check/rotate ALIYUN_ACCESS_KEY_ID/SECRET」,不带值) |
  | `MOBILE_NUMBER_ILLEGAL` / `INVALID_PARAMETERS` / `FUNCTION_NOT_OPENED` / 未知 | `SmsSendFailedError` |
- **密钥纪律**:`ALIYUN_ACCESS_KEY_SECRET` 只参与 HMAC 计算,绝不打印、绝不进日志、绝不进 URL 以外的任何可读位置(query 中仅 AccessKeyId;签名本身不含 secret 明文)

### 2. `server/src/lib/session-store.ts` — phone 也随机码

- `issueOtp`(约 :231-236):`code: provider === 'email' ? randomOtpCode() : DEMO_OTP` → 统一 `randomOtpCode()`
- 删除 `DEMO_OTP` 常量(约 :16);头注释「验证码固定 000000」→ 更新为全部随机
- `DEMO_OTP_CODE` 导出若不再被任何代码引用 → 一并删除(同步改测试引用,见任务 5)

### 3. 路由接线 — `server/src/app/api/auth/otp/send/route.ts`

- 校验与既有 429/503 映射(`OtpRateLimitedError`/`OtpTooManyAttemptsError`/`DbUnavailableError`)完全不动
- phone 成功分支(约 :50-58,现返回 demo/hint):
  ```ts
  const { expiresAt, code } = await issueOtp('phone', target);   // 守卫先行保配额(与 email 同序)
  await sendSmsVerifyCode({ phoneNumber: target, code });
  return Response.json({ ok: true, provider, expiresAt, requestId });
  ```
  即返回 `{ ok: true, provider, expiresAt, requestId }`,**删除 `demo` / `hint` 字段**
- 新错误映射(信封 `{ code, message }`,message 即用户可见文案,硬编码中文,风格同文件内既有映射):

  | Error | HTTP | code | message |
  |---|---|---|---|
  | `SmsConfigError`(缺配置) | 503 | `SMS_NOT_CONFIGURED` | `验证码服务暂不可用,请稍后再试` |
  | `SmsRateLimitedError`(频控) | 429 | `SMS_RATE_LIMITED` | `发送太频繁,请稍后再试` |
  | `SmsDayLimitedError`(天级流控) | 429 | `SMS_DAY_LIMITED` | `今日发送次数已达上限,请稍后再试` |
  | `SmsAuthError`(key 失效/签名错) | 503 | `SMS_PROVIDER_ERROR` | `验证码服务暂不可用,请稍后再试` |
  | `SmsSendFailedError`(网络/其他) | 500 | `SMS_SEND_FAILED` | `验证码发送失败,请稍后再试` |

- 未知错误照旧 re-throw;绝不暴露内部细节(不返回 key/错误栈/阿里云原始错误)
- 头注释(约 :18 与 :55 的 demo 注释)更新:phone 经阿里云短信认证服务真发

### 4. 环境变量文档(server 侧)

- `server/.env.example`:新增注释段 `# ---------- 短信(阿里云短信认证服务 dypnsapi) ----------` + 四条占位注释(`# ALIYUN_ACCESS_KEY_ID=` / `# ALIYUN_ACCESS_KEY_SECRET=` / `# ALIYUN_SMS_SIGN_NAME=` / `# ALIYUN_SMS_TEMPLATE_CODE=`,仿既有 AMAP_WEB_KEY 注释风格;**不写任何真实值**);顺带更新 RESEND_API_KEY 段注释中「phone 仍为 demo 桩」的表述(约 :85-90)→ phone 走阿里云短信
- `server/docs/environment-variables.md`:OTP 注改写(phone 阿里云真发 / email Resend)+ Authentication 段补 `ALIYUN_*` 四条条目(仿 `RESEND_API_KEY` 条目风格;`:288-294` 命名规范列表 `*_KEY` 已覆盖,不用改)

### 5. 测试

**新文件 `server/tests/aliyun-sms-client.test.mjs`**(node --test 自动纳入;`withEnv` 模式照 `tests/resend-client.test.mjs:28-38`;fake fetchImpl 返回 `new Response(JSON.stringify({ Code, Message, RequestId, Model }), { status })`;签名确定性:`now`/`signatureNonce` 注入,`retryDelayMs: 0`):

1. 缺任一配置(逐项删 ALIYUN_* 之一)→ `SmsConfigError`,fetch 零调用
2. 成功:注入 now=固定时刻、nonce=固定值,body `{ Code: 'OK', RequestId: 'R1' }` → 返回 `{ requestId: 'R1' }`;断言请求 URL:
   - query 含全部参数(Action/Version=2017-05-25/Format=JSON/SignatureMethod=HMAC-SHA1/SignatureVersion=1.0/PhoneNumber/SignName/TemplateCode/TemplateParam/`Timestamp` 为注入时刻的 `YYYY-MM-DDTHH:mm:ssZ`)
   - `TemplateParam` 解码后等于 `{"code":"123456"}`(参数名 `code`,直接传值)
   - **签名可复算**:测试内用同一算法(percentEncode + HMAC-SHA1(secret+'&') + base64)对 URL query 其余参数重算 Signature 并与 URL 中 `Signature=` 一致(证明签名实现正确)
   - URL 与请求对象中**无 secret 明文**
3. body `{ Code: 'FREQUENCY_FAIL', Message: '...' }` → `SmsRateLimitedError`
4. body `{ Code: 'BUSINESS_LIMIT_CONTROL' }` → `SmsDayLimitedError`
5. body `{ Code: 'InvalidAccessKeyId.NotFound' }` → `SmsAuthError`
6. body `{ Code: 'INVALID_PARAMETERS' }` → `SmsSendFailedError`
7. 网络 throw 首试 → 重试 → 成功(断言 fetch 恰好 2 次调用)
8. 网络 throw 双失败 → `SmsSendFailedError`,恰好 2 次
9. HTTP 500 且 body 无 `Code`(如 `{ error: 'gateway' }`)→ `SmsSendFailedError`,恰好 1 次(不重试)
10. `Code: 'OK'` 但无 RequestId(`Model: { BizId: 'B1' }`)→ 成功且 `requestId` 为空串

**更新既有测试**:
- `tests/otp-guard.test.mjs`:`DEMO_OTP_CODE` 引用处(约 :87/:138,断言「错误码被拒」/「DB 故障」,码值无关)改为固定错误码字面量(如 `'000000'`)或 `issueOtp` 返回的真实 code;路由契约字符串断言(约 :179-198,`readFileSync` 正则)更新:`demo`/`hint` 断言 → 改断言 `requestId` 与新增 `SMS_*` 错误码分支(`SMS_NOT_CONFIGURED`/`SMS_RATE_LIMITED`/`SMS_DAY_LIMITED`/`SMS_PROVIDER_ERROR`/`SMS_SEND_FAILED`)
- `tests/account.test.mjs`:phone demo 相关断言(约 :106 附近)更新为 send 路由对 phone 的契约期望(真实发送由 client 单测覆盖,此处只对齐响应形状)
- 不要动 `tests/api-hardening.test.mjs`(无 OTP 断言);`tests/component-contracts.test.mjs:222` 若引用 hint 字段,确认并同步(前端契约若已不读 hint,改为断言前端不读 demo/hint 亦可,视文件实际内容)

### 6. 提交

小步多次 Conventional Commits:`feat(auth): ...` / `test(auth): ...` / `docs: ...` / `refactor(auth): ...`

## 硬约束

- **绝不**打印/提交/读取 `.env.local` 真实密钥;`ALIYUN_*` 只在代码中 `process.env` 引用;`console.log/warn` 不得包含 secret
- **绝不**改:`db/migrations/*`、`auth-modal.tsx`、`i18n.ts`、`otp/verify/route.ts`、`tech/**`
- 不新增 npm 依赖;不跑 `npm install`;不跑 import:/geocode:/db-* 命令

## 门禁(全绿才算完成)

```bash
cd /Users/acccan/dm-wt-aliyun-sms-send/server && npm test
cd /Users/acccan/dm-wt-aliyun-sms-send/server && npm run typecheck
cd /Users/acccan/dm-wt-aliyun-sms-send && make docs-check
cd /Users/acccan/dm-wt-aliyun-sms-send && git diff --check
```
(均在 worktree 内跑;worktree 有 Makefile)

## 回报

完成后写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-aliyun-sms-otp/reports/aliyun-sms-send.md`,包含:改动文件清单、测试数(门禁输出,含新增 client 测试数)、文档更新清单、「遇到的问题」段(若有)。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

---

## 续作附录(2026-08-22 重派 —— 上次派发中途夭折,续作)

上次 claude 进程在工作进行中意外退出(API 故障,exit 0 但无输出/无汇报),**无任何 commit**。工作树保留未提交半成品,你的任务是**续作而非重做**:

1. **先审查现状**(不要重做):`git status` + 读两个文件——
   - `server/src/lib/aliyun-sms-client.ts`(约 215 行,结构完整:config getter / 5 个 error class / percentEncode / mapBizError / requestIdFromBody / buildSignedUrl / sendSmsVerifyCode)
   - `server/src/lib/session-store.ts`(已改完:`DEMO_OTP` 删除、`issueOtp` 统一 `randomOtpCode()`、注释更新)
2. **审查要点**(与原任务 1/2 规格对照,不一致则修正):
   - `buildSignedUrl`:参数齐全(Action/Version/Format/SignatureMethod/SignatureVersion/SignatureNonce/Timestamp/PhoneNumber/SignName/TemplateCode/TemplateParam)、RFC3986 percentEncode、字典序排序、`StringToSign = 'GET&%2F&'+percentEncode(qs)`、`HMAC-SHA1(secret+'&')`
   - `mapBizError`:FREQUENCY_FAIL→SmsRateLimited / BUSINESS_LIMIT_CONTROL→SmsDayLimited / 鉴权类→SmsAuthError / 其余→SmsSendFailed
   - `sendSmsVerifyCode`:配置缺失→SmsConfigError 不调 fetch;网络错误重试 1 次(默认 500ms);`Code==='OK'`→`{ requestId }`;HTTP 非 200 有 Code→业务映射;密钥纪律(绝不打印)
   - 若审查发现缺失/错误 → 补齐修正
3. **提交半成品**:审查通过后先 commit 已完成的 client + session-store(可拆两 commit:`feat(auth): aliyun-sms-client 短信认证客户端` / `refactor(auth): phone OTP 随机码统一`)
4. **继续原任务 3/4/5**:路由接线(错误映射表照原任务)、env 文档(.env.example + environment-variables.md)、测试(aliyun-sms-client.test.mjs 全量用例 + 既有测试更新)—— 原 prompt 全部要求照旧
5. 跑门禁(全绿)、写汇报(照原格式,末两行 token)

其余(硬约束/门禁/汇报路径)与上文完全相同,照旧执行。
