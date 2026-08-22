# ws-a 汇报(2026-08-23)— feature/scan-auth-hardening(认证安全加固)

分支:`feature/scan-auth-hardening`(worktree `/Users/acccan/dm-wt-scan-a`,基于 dev `f8a2fd7`)。5 个小步 commit(Conventional Commits,scope `scan-auth`),未 merge、未 push。

## 实际改动(按发现号)

### #1 [High] OTP 验证码单次性缺陷 — 必修 ✅
- 修法:`server/src/lib/account-store.ts` `consumeOtp`:成功路径**无条件消费内存挑战**(DB 行 consumed 后同步 `memConsumeOtp`),杜绝「DB 行已 consumed → 内存分支仍命中 → 同码重放」。内存模式该调用幂等(挑战已被 fallback 删除)。
- 验收(契约测试,`server/tests/auth-hardening.test.mjs`):DB 模式(fake 池模拟 `auth_otp_challenges`)issue → consume(code) true → **同 code 二次 consume 必 false**;内存模式同验;独立 target 原契约保持(错码 false → 正确码 true)。

### #2 [Medium] OTP 发送全局限流(per-IP + per-账号)✅
- 修法:| 维度 | key | 默认值 |
  |---|---|---|
  | per-IP | `ip:<clientIp>` | **20 次 / 24h** |
  | per-账号 | `user:<userId>`(target 已绑定账户;未绑定 → `account:<provider>:<target>`) | **10 次 / 24h** |
- `checkOtpSendLimits(ip, provider, target)` 新导出(account-store,与 otpGuards 同构:计数先于发送,超出 → `OtpRateLimitedError` → route 429 RATE_LIMITED);send route 在 `issueOtp` 之前调用。
- 账号解析:DB 模式 `SELECT user_id::text FROM auth_identities WHERE provider=$1 AND subject=$2`(DB 不可用回退 target 键——随后 issueOtp 写路径仍抛 DbUnavailableError,无绕过可能);内存模式新增 `session-store.resolveAccountBySubject`。**同一用户手机/邮箱共享账号桶**,防双标识轮流翻倍。
- **不做**:全局每日发送预算(数值需用户拍板,记「问题」);OTP 发送渠道未改。
- IP 取法:与 agent/chat 同款(XFF 首段 → x-real-ip → unknown),信任假设一致(单实例演示进程内守卫;生产需代理清洗转发头)。

### #3 + #17 [Medium/Low] 密码登录防爆破 + 时间侧信道 ✅
- (a) `api/auth/password/login/route.ts` 重写:滑动窗口守卫(与 OTP 同构),双维度:
  - per-账号:`LOGIN_MAX_FAILURES = 5` 错 / 15min → 锁 15min(与 OTP 5 错锁一致);
  - per-IP:`LOGIN_IP_MAX_FAILURES = 20` 错 / 15min → 锁 15min(NAT 共享出口放宽);
  - `checkLoginRateLimit` **先于** `loginWithPassword`(锁定期不跑 scrypt);失败计数成功后清零;触发锁 → 429 TOO_MANY_ATTEMPTS + retryAfterMs(与 OTP consumeOtp 同语义);统一 401 INVALID_CREDENTIALS 保持。
- (b) dummy verify:DB(account-store `loginWithPassword` 查无行/无 hash)与内存(session-store `loginWithPassword` 查无账号/无 passwordHash)均执行一次真实 scrypt 校验(lazy 生成的 dummy hash `scrypt$16384$8$1$…`,非秘密,仅首次 50ms),抹平「账号不存在」时间差。

### #4 [Medium] SESSION_SECRET 公开常量回退 + 文档标「可选」✅
- (a) 生产(NODE_ENV=production)缺 `SESSION_SECRET` → `sessionSigningSecret()`(新导出,**会话 token 与 oauth_state 共用入口**)抛错拒绝签名:createSession 与 oauth_state 签发均不可用。
- (b) 非生产未设置 → boot 随机(64-hex,进程内缓存一致);`oauth-state.ts` 删除自有 bootSecret 逻辑,统一复用 `sessionSigningSecret`(两模块不再各自回退/互斥)。
- (c) 文档:`tech/15-deploy.md`(新增「SESSION_SECRET(生产必配)」节)、`tech/27-oauth-login.md` §3.5 改「生产必配」+ env 表行、`server/docs/environment-variables.md`(注释改生产必配 + 生产检查单 AUTH_SECRET(陈旧名)→ SESSION_SECRET 标注必配)。
- **不做**:实际为生产设置该变量(Env-only,入 deferred)。

### 测试文件
- 新建 `server/tests/auth-hardening.test.mjs`(13 个测试:#1 ×2、#2 ×4、#3 ×3、#4 ×4;store 层行为直测 + route readFileSync 正则契约,照仓库既有模式)。

## 门禁结果
- npm test:**1483 tests / 1481 pass / 0 fail / 2 skipped**(全绿;本批新增 13 个测试)
- `npm run typecheck`:通过(tsc --noEmit)
- `make docs-check`:通过
- `git diff --check`:通过

## 遇到的问题
- **全局每日发送预算未做**(#2):数值属成本控制策略,需用户拍板;本轮仅落地 per-IP / per-账号桶(数值如上)。若用户裁定全局预算,可在 `checkOtpSendLimits` 同处加第三个桶。
- **XFF 信任假设**:OTP 发送与密码登录的 IP 桶按 XFF 首段取 IP,客户端可伪造自选桶(与 agent/chat 同一既有假设);多实例/生产需代理层清洗转发头(deferred)。
- **遗留 2 个 untracked 备份文件**:`.bak-account-store.ts` / `.bak-session-store.ts`(worktree 根,内容与已提交版本逐字节一致——分步重建提交时留下的校验副本)。沙箱拦截 `rm`/`mv`/`git clean`,无法删除;请 boss 在 merge 时顺手移除。
- **测试计数漂移确认**:门禁权威值 1483/1481/2;根 README/CLAUDE.md/agent.md 等处 568/566/2 早过期(scan #6,属 ws-c 批次,本批未改)。
- OTP 重放一次(code 已被消费)会记 1 次 wrong attempt(与错误码/过期码同路径);5 次重放才触发锁,不改变单次消费契约。

## 证据
- 提交序列:`6c24940`(#1)→ `e401b97`(#2)→ `d6ce4ba`(#3/#17)→ `c38996c`(#4 代码)→ `8de7fc4`(#4 文档)
- diffstat(9 文件,+584/-28):account-store.ts +100、session-store.ts +43、oauth-state.ts +15、otp/send/route.ts +21、password/login/route.ts +110、auth-hardening.test.mjs 新增 302、文档 3 文件 +21/-8
- 测试输出摘要:full `npm test` → `ℹ tests 1483 / pass 1481 / fail 0 / skipped 2`;`tsc --noEmit` 无输出;`make docs-check` → "Documentation policy check passed.";`git diff --check` 无输出。

门禁: PASSED
结论: OK
