# Workstream: resend-otp-email — Resend 验证码邮件接入

## 背景

项目已有完整 OTP 登录体系,**只缺"发送"环节**:

- `POST /api/auth/otp/send`(`server/src/app/api/auth/otp/send/route.ts`)目前返回固定 demo 码 `{ ok, provider, expiresAt, demo: true, hint: '000000' }`,从不发邮件
- 存储/校验已存在且有测试:`auth_otp_challenges` 表(code_hash sha256、expires_at=10 分钟 TTL)+ 内存 `otpGuards`(60s 冷却、24h 10 次上限、5 次错锁 15 分钟)——`server/src/lib/account-store.ts` `issueOtp`(503-539)/`consumeOtp`(541-586),内存实现 `server/src/lib/session-store.ts`
- 客户端 `auth-modal.tsx` 只读 `res.ok`/`body.message`,不用 `demo`/`hint` —— **零前端改动**

## 你的工作环境(已预建,勿动 git 管理)

- worktree:`/Users/acccan/dm-wt-resend-otp`(分支 `feature/resend-otp-email`,自 dev 切出)
- 所有开发在此 worktree 内完成;`server/node_modules` 已 symlink,可直接 `cd server && npm test`
- **不要** merge、push、建分支、npm install、跑任何 import:/geocode:/db-* 命令
- 汇报写到:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-resend-otp/reports/resend-otp-email.md`(跨主树,已授权)
- 代码注释用中文,与所在文件风格一致;先读 `server/AGENTS.md`(Next.js 16 有破坏性变更,写代码前查 `node_modules/next/dist/docs/` 相关指南)

## 任务(按序)

### 1. 验证码生成 — `server/src/lib/session-store.ts`
- 第 9 行 `node:crypto` 导入补 `randomInt`(现有 createHmac/randomBytes/randomUUID)
- 新增导出:
  ```ts
  export function randomOtpCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }
  ```
- `issueOtp`(约 226-236):`code: provider === 'email' ? randomOtpCode() : DEMO_OTP`(phone 保留 demo 桩);返回类型放宽为 `{ expiresAt: number; code: string }`,返回 `{ expiresAt, code }`
- 头注释第 6 行"验证码固定 000000"→ 更新为"邮箱为真实随机码,手机仍固定 000000(demo)"
- `DEMO_OTP_CODE` 导出保留(测试仍用)

### 2. DB 门面 — `server/src/lib/account-store.ts`
- `issueOtp` 返回类型 → `Promise<{ expiresAt: number; code: string }>`(运行时本就返回 memory,仅放宽类型)
- 第 534 行 `hashOtp(DEMO_OTP_CODE)` → `hashOtp(memory.code)`
- 第 54 行导入中移除 `DEMO_OTP_CODE`(变死代码)

### 3. 新库 — `server/src/lib/verification-email.ts`
- 常量:`EMAIL_SUBJECT = '登录验证码'`、`EMAIL_FROM = 'contact@nvc.ac'`
- `buildVerificationEmailHtml(code: string, expiresAt: number): string` — 浅色卡片样式,**全部内联 CSS**(邮件客户端剥 `<style>`),验证码大字(等宽、字距、独立卡片突出显示),含 10 分钟有效期提示(用 `new Date(expiresAt).toLocaleString('zh-CN')` 显示到期时间),中文文案简洁(登录验证码、请勿泄露、非本人操作可忽略)。仅插值 code 与时间,无任何用户输入插值
- `buildVerificationEmailText(code: string, expiresAt: number): string` — 纯文本 fallback,含同样事实(验证码 + 10 分钟提示)

### 4. 新库 — `server/src/lib/resend-client.ts`
- `resendApiKey(): string | undefined` — `process.env.RESEND_API_KEY?.trim() || undefined`(模式参照 `lib/site-geocode.ts:206-221` 的 `amapWebKey()`)
- typed error classes(仓库 instanceof 映射惯例,参照 account-store 的 OtpRateLimitedError 写法):
  - `EmailConfigError`(缺 key)、`EmailRateLimitedError`(429)、`EmailAuthError`(401/403)、`EmailSendFailedError`(422/网络/其他)
- `sendVerificationEmail(input: { to: string; code: string; expiresAt: number }, options?: { fetchImpl?: typeof fetch; retryDelayMs?: number })`:
  - key 缺失 → 直接抛 `EmailConfigError`(不调 fetch)
  - POST `https://api.resend.com/emails`,headers:`Authorization: Bearer <key>`、`Content-Type: application/json`
  - body:`{ from: EMAIL_FROM, to, subject: EMAIL_SUBJECT, html: buildVerificationEmailHtml(code, expiresAt), text: buildVerificationEmailText(code, expiresAt) }`
  - **重试策略(用户拍板)**:fetch 抛异常(网络错误)**或 HTTP 429** → 等待 `retryDelayMs`(默认 500)→ 重试 1 次;其余状态码不重试
  - 成功(200):`console.log` 记录 messageId(取自 body.id),返回 `{ messageId: string }`;**绝不打印验证码、绝不打印 key**
  - 401/403:`console.warn` 告警(key 轮换提示,如 "resend key invalid/expired, rotate RESEND_API_KEY",不带 key 值)→ 抛 `EmailAuthError`
  - 429(重试后仍 429):记录日志(状态码)→ 抛 `EmailRateLimitedError`
  - 422:记录日志(参数错误)→ 抛 `EmailSendFailedError`
  - 网络/其他:记录日志(状态码或网络错误类型)→ 抛 `EmailSendFailedError`
  - `fetchImpl` 注入惯例参照 `lib/guest-search-history.ts:90-110`(可选参数注入,默认全局 fetch)

### 5. 路由接线 — `server/src/app/api/auth/otp/send/route.ts`
- 校验逻辑与既有 429/503 映射完全不动
- 成功路径按 provider 分支:
  - `phone`:原样 `{ ok: true, provider, expiresAt, demo: true, hint: '000000' }`
  - `email`:`const { expiresAt, code } = await issueOtp('email', target)`(**先 issueOtp,守卫先行保配额**)→ `await sendVerificationEmail({ to: target, code, expiresAt })` → `{ ok: true, provider, expiresAt, messageId }`
- 新错误映射(保持 `{ code, message }` 信封,message 即用户可见文案):

| Error | HTTP | code | message |
|---|---|---|---|
| `EmailConfigError`(缺 key) | 503 | `EMAIL_NOT_CONFIGURED` | `验证码服务暂不可用,请稍后再试` |
| `EmailRateLimitedError` | 429 | `EMAIL_RATE_LIMITED` | `发送太频繁,请稍后再试` |
| `EmailAuthError` | 503 | `EMAIL_PROVIDER_ERROR` | `验证码服务暂不可用,请稍后再试` |
| `EmailSendFailedError` | 500 | `EMAIL_SEND_FAILED` | `验证码发送失败,请稍后再试` |

- 未知错误照旧 re-throw(不吞);绝不暴露内部细节(不返回 key/错误栈/Resend 原始错误)
- 头注释(9-13 行)更新:email 经 Resend 真发,phone 仍为 demo 桩

### 6. 测试
新文件 `server/tests/resend-client.test.mjs`(node --test 自动纳入;`withEnv` 模式参照 `tests/agent-config.test.mjs:17-30`;假 fetchImpl 返回 `new Response(JSON.stringify({ id }), { status })`;重试测试传 `retryDelayMs: 0`):
1. 缺 key → `EmailConfigError`,fetch 零调用
2. 200 → 返回 `{ messageId }`;断言请求:URL、`Authorization: Bearer <key>` 头、body 含 from/to/subject/html/text、**body 无 key 泄漏**
3. 429 首试 → 重试 1 次 → 成功(断言 fetch 恰好 2 次调用)
4. 429 双失败 → `EmailRateLimitedError`,恰好 2 次
5. 网络 throw 首试 → 重试 → 成功(2 次)
6. 网络 throw 双失败 → `EmailSendFailedError`
7. 401 与 403 → `EmailAuthError`,恰好 1 次(不重试)
8. 422 → `EmailSendFailedError`,1 次
9. 模板:html 含验证码与 10 分钟提示、text fallback 含码与提示、subject 常量 `登录验证码`
10. `randomOtpCode()`:`/^\d{6}$/` 匹配、前导零案例(padStart)、小样本互异

既有测试更新:
- `tests/otp-guard.test.mjs:102`(email 正确码重置计数):改用 issueOtp 返回的 `code`(`const { code } = await storeIssueOtp('email', target)` 后传 code)
- `:87`/`:138` 保持 `DEMO_OTP_CODE`(仅断言拒绝/DB 故障,码值无关)
- 路由契约测试(约 179-193,`readFileSync` 正则):补 `messageId` 断言与 `EMAIL_RATE_LIMITED`/`EMAIL_SEND_FAILED`/`EMAIL_NOT_CONFIGURED` 断言
- `tests/account.test.mjs:106`(phone demo)不变
- 不要动 `api-hardening.test.mjs`(无 OTP 断言)、`component-contracts.test.mjs:222`(hint 无关)

### 7. 文档(同步,`make docs-check` 须过)
- `tech/14-api-contract.md` 第 25 行改写:email OTP 经 Resend 真发(`{ ok, provider, expiresAt, messageId }`,错误见 tech/25);phone 保留 demo(`demo: true, hint: '000000'`)
- 新建 `tech/25-resend-email.md`(风格参照 `tech/24-agent-feature.md`:标题/文档版本/创建日期/状态):端点契约、重试策略(网络+429 各重试 1 次 ~500ms)、错误映射表、Resend 免费额度 ~3000 封/月、垃圾箱预案(发件域 + SPF/DKIM 已配仍入垃圾箱时的处理)、provider 拆分(phone demo / email 真发)、`RESEND_API_KEY` env 说明、密钥纪律(绝不入库/打日志)
- `tech/README.md` 索引:加 `25-resend-email.md` 行,**顺带补缺的 `23-map-engines.md` 行**(既有漂移)
- `server/.env.example`:新增注释段 `# ---------- 邮件(Resend) ----------` + `# RESEND_API_KEY=`(仅占位注释,仿既有 AMAP_WEB_KEY 注释风格;**不写任何真实值**)
- `server/docs/environment-variables.md`:55-56 行 OTP 注改写(email 真发/phone demo)+ Authentication 段补 `RESEND_API_KEY` 条目(288-294 是命名规范列表,`*_KEY` 条目已覆盖,不用改)
- `tech/roles/development/deferred-ledger.md`:更新行 D-04(本任务使其部分落地:email 真发,demo hint 仅剩 phone)+ 新增 Env-only 行(用户配 RESEND_API_KEY + 核实发件域)

## 硬约束

- **绝不**打印/提交/读取 `.env.local` 真实密钥;`RESEND_API_KEY` 只在代码中 `process.env` 引用
- **绝不**改 `auth-modal.tsx`、`i18n.ts`、`verify/route.ts`、`db/migrations/*`
- 不新增 npm 依赖;不跑 `npm install`;不跑 import:/geocode:/db-* 命令
- 提交用 Conventional Commits(小步多次:`feat(auth): ...` / `test(auth): ...` / `docs: ...`)

## 门禁(全绿才算完成)

```bash
cd /Users/acccan/dm-wt-resend-otp/server && npm test
cd /Users/acccan/dm-wt-resend-otp/server && npm run typecheck
cd /Users/acccan/dm-wt-resend-otp && make docs-check
cd /Users/acccan/dm-wt-resend-otp && git diff --check
```
(均在 worktree 内跑;make 在 worktree 根目录;如 worktree 无 Makefile,回主仓库根目录跑 `make docs-check` 并说明)

## 回报

完成后写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-resend-otp/reports/resend-otp-email.md`,包含:改动文件清单、测试数(门禁输出)、文档更新清单、「遇到的问题」段(若有)。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
