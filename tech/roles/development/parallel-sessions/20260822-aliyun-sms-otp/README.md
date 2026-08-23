# 批次 20260822-aliyun-sms-otp — 手机验证接入阿里云短信认证服务

**日期:** 2026-08-22 · **负责人:** boss (acccan)

**目标:** 把 `POST /api/auth/otp/send` 的 phone **demo 桩**(固定码 `000000`,`demo: true, hint: '000000'`)替换为**阿里云短信认证服务**(`SendSmsVerifyCode`,dypnsapi `2017-05-25`)真实发送,删除 demo/hint 字段。前端**零改动**(auth-modal phone tab 已存在且是默认 tab,只读 `res.ok` / `body.message`)。

**参考:**
- 阿里云 API 文档:https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode
- 先例:`tech/25-resend-email.md`(email 经 Resend 真发)+ 批次 `20260821-resend-otp`(同款 client/测试/文档模式)
- 决策台账:`tech/roles/development/deferred-ledger.md` **D-04**(phone demo hint 上线前必须删除,何时接入由用户拍板 —— 用户已拍板:阿里云短信认证)

## Workstream 表

| ws | 分支 | worktree | 主题 | 拥有(文件) | 不碰 |
|---|---|---|---|---|---|
| aliyun-sms-send | feature/aliyun-sms-send | /Users/acccan/dm-wt-aliyun-sms-send | 后端:阿里云短信 client + session-store 随机码 + route 接线 + 测试 + env 文档 | `server/src/lib/aliyun-sms-client.ts`(新)、`server/src/lib/session-store.ts`、`server/src/app/api/auth/otp/send/route.ts`、`server/tests/aliyun-sms-client.test.mjs`(新)、`server/tests/otp-guard.test.mjs`、`server/tests/account.test.mjs`、`server/.env.example`、`server/docs/environment-variables.md` | `db/migrations/*`、`auth-modal.tsx`、`i18n.ts`、`otp/verify/route.ts`、`tech/**` |
| aliyun-sms-docs | feature/aliyun-sms-docs | /Users/acccan/dm-wt-aliyun-sms-docs | 文档:`tech/26` 新建 + api-contract + README 索引 + deferred-ledger D-04 关闭 + tech/25 §8 更新 | `tech/26-aliyun-sms.md`(新)、`tech/14-api-contract.md`、`tech/README.md`、`tech/roles/development/deferred-ledger.md`、`tech/25-resend-email.md` | `server/**` 代码、`server/.env.example`、`server/docs/**`(归 ws-1)、`db/migrations/*` |

两 WS 文件完全不相交;docs WS 以本 README 与 `prompts/aliyun-sms-docs.md` 中写死的契约为准(不依赖 ws-1 的代码实现,并行无阻塞)。

## 合并顺序

1. **aliyun-sms-send**(foundation:实现)
2. **aliyun-sms-docs**(文档,依赖契约而非实现,冲突面为零)

红则停;全部绿 → merger 逐个 `--no-ff` 合并回 dev 并 push。

## 关键设计决策(boss 拍板,worker 不得更改)

- **验证码生成:服务端生成(直接传值模式)**。沿用现有 `issueOtp`(6 位随机码 → sha256 存 `auth_otp_challenges` → 本地 `consumeOtp` 校验),`TemplateParam = {"code": "<6位码>"}` 直接传值;**不使用** `##code##` 占位符 + `CheckSmsVerifyCode`(阿里云「无法校验自定义码」对本方案无影响——校验本就在本地完成;保持 phone/email 统一验证路径与既有守卫/限流/锁)。
- **零依赖**:手写阿里云 RPC 签名(HMAC-SHA1,RFC3986 percent-encode),不引入 SDK/npm 依赖(项目惯例,同 `resend-client.ts` 零 SDK)。
- **请求**:GET `https://dypnsapi.aliyuncs.com/?<signed-query>`;`Format=JSON`。
- **重试**:仅网络错误(fetch 抛异常)重试 1 次(~500ms);业务错误/HTTP 错误不重试。
- **响应**:成功 `{ ok: true, provider, expiresAt, requestId }`(requestId 取阿里云 body.RequestId ?? Model.RequestId);**删除 demo/hint**。
- **错误映射**(信封 `{ code, message }`):`SMS_NOT_CONFIGURED` 503 / `SMS_RATE_LIMITED` 429 / `SMS_DAY_LIMITED` 429 / `SMS_PROVIDER_ERROR` 503 / `SMS_SEND_FAILED` 500,明细见 ws-1 prompt。
- **Env(Env-only,deferred)**:`ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME`(系统赠送签名,不支持自定义)/ `ALIYUN_SMS_TEMPLATE_CODE`(赠送模板);未配置 → 503 优雅降级。

---

## 裁决补充(merger 必读 —— 合并后修正,2 处文档微调)

boss 已裁决(adjudication_log 详见 boss-state.md),**merge 完成后**在 dev 上直接修正并独立 commit(小步,Conventional Commits):

1. `tech/roles/development/deferred-ledger.md` 第 17 行 D-04 状态 token:`**CLOSED**` → `**DONE-记录**`(与账本图例/既有闭环行 D-22/23/25/26 词表一致)
2. `tech/26-aliyun-sms.md` 第 40 行错误映射表 SMS_DAY_LIMITED 文案:`请明天再试` → `请稍后再试`(与 ws-1 路由实现 `server/src/app/api/auth/otp/send/route.ts:117` 一致;改完跑 `make docs-check` + `git diff --check`)

---

## 合并 preflight 补充(boss 裁决 —— 主树遗留脏文件白名单)

主仓库存在多个并发 boss 流程(navi / tmap-polish 等)共享主工作树,它们会持续提交并留下台账文件修改。以下类别视为**已裁决白名单**,preflight 不要求干净,**绝不** `git checkout --` / stash / 还原(属并发流程在途产物):

- `server/data/recruitment/official-career/*.json`(数据文件,本会话开始前即已修改)
- `server/next-env.d.ts`(Next.js 自动生成)
- `tech/roles/development/parallel-sessions/<其他批次>/*` 下的 `M` 状态文件(其他批次的 README/merge-report/boss-state 等台账)

**Preflight 规则**:白名单外 `git status` 必须干净;合并期间出现**新的**未合并路径(不在白名单)→ 红则停,报告。dev HEAD 前移属正常(多流程并发),先 `git pull --ff-only origin dev` 再继续,不视为失败。其余按脚本生成的 merge-instructions 执行。
