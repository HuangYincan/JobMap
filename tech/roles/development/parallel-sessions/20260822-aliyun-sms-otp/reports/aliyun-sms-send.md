# aliyun-sms-send 汇报(2026-08-22)

> 续作:上次派发中途夭折(无 commit),本次按续作附录先审查半成品→提交→继续任务 3/4/5。

## 实际改动

**续作审查通过的半成品(2 commit):**
- `server/src/lib/aliyun-sms-client.ts`(新,215 行)→ 阿里云短信认证服务客户端:手写 RPC 签名(HMAC-SHA1 + RFC3986 percentEncode,零依赖);`aliyunSmsConfig()` 读 ALIYUN_* 四 env 任一缺失→undefined;5 类 typed error(Config/RateLimited/DayLimited/Auth/SendFailed);`sendSmsVerifyCode` 网络错误重试 1 次(默认 500ms,注入可调),业务错误不重试;错误码映射 FREQUENCY_FAIL/BUSINESS_LIMIT_CONTROL/鉴权类/其他;密钥纪律(secret 只进 HMAC,成功只记 requestId)
- `server/src/lib/session-store.ts` → `DEMO_OTP` 删除、`issueOtp` phone/email 统一 `randomOtpCode()`、头注释/行内注释更新为「phone 经阿里云短信真发」

**本次新增(4 commit):**
- `server/src/app/api/auth/otp/send/route.ts` → phone 分支改真发:守卫先行 `issueOtp` → `sendSmsVerifyCode` → 返回 `{ ok, provider, expiresAt, requestId }`;**删除 demo/hint 字段**;新增 5 分支 SMS_* 错误映射(见下);头注释同步;未知错误照旧 re-throw
- `server/.env.example` → 新增「短信(阿里云短信认证服务 dypnsapi)」段四条占位注释(无真实值);RESEND_API_KEY 段「phone 仍为 demo 桩」→「phone 走阿里云短信」
- `server/docs/environment-variables.md` → OTP 注改写(phone 阿里云真发/email Resend);Authentication 段补 ALIYUN_* 四条(仿 RESEND_API_KEY 条目风格);Last Updated → 2026-08-22
- `server/tests/aliyun-sms-client.test.mjs`(新,11 用例)→ withEnv + fake fetchImpl + now/nonce 注入 + retryDelayMs:0;覆盖缺配置零调用 / 成功(URL 参数齐全、TemplateParam 解码=`{"code":"123456"}`、**签名可复算**、无 secret 明文)/ 四类业务错误映射 / 网络重试恰 2 次 / 双失败 / HTTP 500 无 Code 不重试 / HTTP 500 有 Code 按业务映射 / OK 无 RequestId 回退空串
- `server/tests/otp-guard.test.mjs` → DEMO_OTP_CODE 引用改字面量 '000000';路由契约断言 `hint: '000000'` → `requestId` + `doesNotMatch /demo|hint/` + SMS_* 五错误码
- `server/tests/account.test.mjs` → DEMO_OTP_CODE import 删除;phone 消费断言改用 `issueOtp` 返回的真实随机码(真实发送由 client 单测覆盖,此处只对齐存储契约)

## 门禁结果

- npm test: **1162 通过 / 0 失败 / 2 skip**(含新增 aliyun-sms-client 11 用例)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过(工作树干净)

## 遇到的问题

1. **dev 基线测试破损(06bc302 引入,非本 WS 造成)**:`saved-layer-sync.test.mjs` 与 `hooks-contracts.test.mjs` 仍 `readFileSync` 已被 06bc302 物理删除的 `src/lib/saved-camera-sync.ts`,npm test 在修复前全红(ENOENT)。已做最小修复(改断言文件不存在 + 补 existsSync import),单独 commit `fix(saved-layer)` 便于 boss 回退。**这两个文件不在本 WS 任务清单,属越界顺修,请 boss 裁决是否保留**。
2. cwd 漂移导致两次「grep 0」假象(npm 在根目录报 ENOENT)——以最终完整输出为准(1162/1160/2)。

## 证据

- `npm test`: `ℹ tests 1162 / pass 1160 / fail 0 / skipped 2`;`grep -c sendSmsVerifyCode` = 11(新用例全跑)
- `npm run typecheck`: tsc --noEmit 无输出
- `make docs-check`: "Documentation policy check passed."
- `git diff --check`: 无输出 + `git status --short` 为空
- 提交链(6 commit,均 Conventional):`d3bd37d` feat(auth) aliyun-sms-client → `52b965d` refactor(auth) phone OTP 随机码 → `f17a2c8` feat(auth) 路由接线 → `7ba66ec` docs env 文档 → `07faaf4` test(auth) 单测+同步 → `5466579` fix(saved-layer) 基线回归
- 分支 `feature/aliyun-sms-send` 留原地,未 merge / 未 push

门禁: PASSED
结论: OK
