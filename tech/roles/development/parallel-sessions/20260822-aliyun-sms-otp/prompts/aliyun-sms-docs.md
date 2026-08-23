# Workstream: aliyun-sms-docs — 阿里云短信接入文档同步

## 背景

本批次把 phone OTP 从 demo 桩切换为**阿里云短信认证服务**真发(`SendSmsVerifyCode`,dypnsapi `2017-05-25`,服务端生成 6 位码直接传值,本地 `consumeOtp` 校验,零依赖手写 HMAC-SHA1 签名)。并行 WS `aliyun-sms-send` 负责代码实现;**本 WS 只写文档**,以本 prompt 中写死的契约为准(**不读、不依赖 ws-1 的代码**),两 WS 文件零交集。

**契约(以本 prompt 为准):**
- `POST /api/auth/otp/send` phone 分支成功响应:`{ ok: true, provider, expiresAt, requestId }`(requestId 取自阿里云返回;**demo/hint 已删除**)
- 环境变量:`ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME`(系统赠送签名,不支持自定义)/ `ALIYUN_SMS_TEMPLATE_CODE`(赠送模板);未配置 → 503 `SMS_NOT_CONFIGURED` 优雅降级
- 错误映射:503 `SMS_NOT_CONFIGURED`(缺配置)/ 429 `SMS_RATE_LIMITED`(阿里云 `FREQUENCY_FAIL`)/ 429 `SMS_DAY_LIMITED`(`BUSINESS_LIMIT_CONTROL`)/ 503 `SMS_PROVIDER_ERROR`(key 失效/签名错)/ 500 `SMS_SEND_FAILED`(网络/其他);重试:仅网络错误重试 1 次(~500ms)
- 调用方式:GET `https://dypnsapi.aliyuncs.com/?<signed-query>`;RPC 签名(HMAC-SHA1,RFC3986 percent-encode,`Format=JSON`);`TemplateParam = {"code": "6位码"}` 直接传值,**不用** `##code##` + `CheckSmsVerifyCode`(本地已有 `auth_otp_challenges` 校验链)
- 前端零改动(phone tab 已存在,只读 `res.ok`/`body.message`)

## 你的工作环境(已预建,勿动 git 管理)

- worktree:`/Users/acccan/dm-wt-aliyun-sms-docs`(分支 `feature/aliyun-sms-docs`,自 dev 切出)
- 所有编辑在此 worktree 内完成;**不要** merge、push、建分支
- 汇报写到:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-aliyun-sms-otp/reports/aliyun-sms-docs.md`(跨主树,已授权)
- 代码注释/文档用中文,与所在文件风格一致

## 任务(按序)

### 1. 新建 `tech/26-aliyun-sms.md`(风格照 `tech/25-resend-email.md`:标题 / 文档版本 / 创建日期 / 状态)

- **状态**:已实现(批次 `20260822-aliyun-sms-otp` 合入 dev 后生效;实现与文档同批并行,如 README 所述)
- **背景与动机**:项目 OTP 体系已完整(email 经 Resend 真发),phone 此前 demo 桩(`hint: '000000'`,决策台账 D-04 遗留);本批接入阿里云短信认证服务真实发送并删除 demo hint
- **端点契约**:`POST /api/auth/otp/send` phone 分支 → `{ ok: true, provider, expiresAt, requestId }`;校验与既有限流不动;引用 `tech/25` 的 email 分支对照
- **调用方式**:零依赖手写 RPC 签名(简述签名步骤:公共参数 + RFC3986 percent-encode + 参数排序 + `GET&%2F&…` + HMAC-SHA1(secret+'&') + base64);GET `https://dypnsapi.aliyuncs.com/`;`TemplateParam={"code": "6位码"}` **直接传值模式** —— 说明取舍:阿里云 `##code##`+`CheckSmsVerifyCode` 路径不采用(本地 `auth_otp_challenges` 已有生成/存储/校验/限流全链,保持 phone/email 统一验证路径);阿里云「无法校验自定义码」不影响本方案
- **错误映射表**(上表)+ 重试策略(仅网络错误重试 1 次 ~500ms;业务错误不重试;阿里云业务错误码映射:频控/天级流控/鉴权类)
- **环境变量**:四条 `ALIYUN_*` 说明(签名=系统赠送,不支持自定义;模板=赠送模板,参数名 `code`;未配置 → 503)
- **开通步骤(用户侧)**:阿里云控制台开通「短信认证服务」→ 获取系统赠送签名+模板 → RAM 创建 AccessKey(授权 `dypns:SendSmsVerifyCode`);短信按条计费(运营商回执失败不计费),本方案未用付费核验
- **密钥纪律**:同 `tech/25` §7(绝不入库/打印/进响应;`process.env` 引用;鉴权失败 console.warn 提示检查/轮换,不带值)
- **provider 拆分表**(同 `tech/25` §8 结构):phone 阿里云真发 / email Resend 真发 / 备注 demo hint 已删除
- 提及 `db/migrations/005` 注释「Production send goes through Aliyun SMS (PNvs)」现已成为事实(迁移文件不可变)

### 2. `tech/14-api-contract.md` 第 25 行改写

现为「Phone stays a demo stub (`demo: true, hint: '000000'`)…」→ 改为:phone 经阿里云短信认证服务真发(`POST /api/auth/otp/send` → `{ ok, provider, expiresAt, requestId }`;需 `ALIYUN_ACCESS_KEY_ID`/`ALIYUN_ACCESS_KEY_SECRET`/`ALIYUN_SMS_SIGN_NAME`/`ALIYUN_SMS_TEMPLATE_CODE`;错误映射与重试见 `tech/26-aliyun-sms.md`)。email 行保持指向 tech/25 不动

### 3. `tech/README.md` 索引

加 `26-aliyun-sms.md` 一行(仿既有行格式,如补缺顺序一致则顺位)

### 4. `tech/roles/development/deferred-ledger.md` — D-04 关闭

- D-04 行(约 :17):状态 **PARTIAL → CLOSED**(2026-08-22 aliyun-sms 批:phone 经阿里云短信认证服务真发,demo hint 已删除);「上线前必须…」备注改为:遗留 Env-only(用户配置真实 `ALIYUN_*` 值 + 真实冒烟,见批次 `20260822-aliyun-sms-otp/deferred-notes.md`)
- 若该行或其它行提及 phone demo 桩的表述,同步更新;`deferred-ledger.md` 有独立的 Env-only 段/行则加一行(用户配阿里云 key + 冒烟)

### 5. `tech/25-resend-email.md` 同步(§1 / §5 / §8 中的 phone demo 表述)

- §1 现状 bullet「phone 返回 demo 桩」→ phone 经阿里云真发(引用 tech/26)
- §5 环境变量注释「phone 仍为 demo 桩」→ 更新;可加一句「phone 走阿里云短信,见 tech/26」
- §8 provider 拆分表:phone 行 → 阿里云真发(2026-08-22),email 行不变;「接入真实短信服务商后删除 demo hint」余项 → 已删除

### 6. 提交

Conventional Commits:`docs(auth): ...` 小步多次(每文件或每组文件一次 commit 亦可)

## 硬约束

- **绝不**改 `server/**` 代码、`server/.env.example`、`server/docs/**`(env 文档归 ws-1 负责)、`db/migrations/*`
- 不新增/删除 `tech/` 其他文件;不写任何真实密钥值
- 契约以本 prompt 为准,不臆造代码行为;拿不准的事实写进报告「遇到的问题」而非猜

## 门禁(全绿才算完成)

```bash
cd /Users/acccan/dm-wt-aliyun-sms-docs && make docs-check
cd /Users/acccan/dm-wt-aliyun-sms-docs && git diff --check
```
(均在 worktree 内跑;worktree 有 Makefile;docs-check 为仓库根 grep 政策检查,若有既存漂移命中,报告里说明命中来源是否为本 WS 新增)

## 回报

完成后写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-aliyun-sms-otp/reports/aliyun-sms-docs.md`,包含:改动文件清单、文档更新清单、「遇到的问题」段(若有)。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
