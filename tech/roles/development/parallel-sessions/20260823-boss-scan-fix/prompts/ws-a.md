# Workstream a — feature/scan-auth-hardening(认证安全加固)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-scan-a`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix/reports/ws-a.md`(末两行 token,见文末)。

## 背景

全库扫描(2026-08-23)报告:`tech/roles/development/quality-scans/20260823-all/scan-report.md`(请通读 #1 #2 #3 #4 #17 的「发现详情」段;以下为 boss 裁决摘要,细节以报告为准)。

## 任务(按扫描发现号)

### #1 [High] OTP 验证码单次性缺陷(DB 模式可重放)— 必修
- `server/src/lib/account-store.ts:695-730`:DB 模式 `consumeOtp` 成功时短路(`ok || memConsumeOtp(...)`)不删内存挑战 → 同一 code 在 10min TTL 内可第三次/第四次成功(DB 行 consumed 后走内存分支仍中)。
- **修法**:成功路径无条件消费内存挑战(或统一以 DB 为权威、内存仅无库模式生效——两者选一,以「同一 code 二次 consume 必 false(DB 模式)」为验收),补契约测试。
- 契约测试:DB 模式 issue 后 consume 成功一次 → 第二次同 code consume 必须 false;内存模式同验。

### #2 [Medium] OTP 发送仅按 target 限流(轮换 target 耗配额)
- `account-store.ts:148-153`(`provider:target` key)+ `api/auth/otp/send/route.ts:51-61`。
- **修法**:在现有 per-target 守卫之上,增加 **per-IP 桶** 与 **per-account(provider:normalized-account)桶**,沿用现有 otpGuard 风格(常量可参照 COOLDOWN/DAILY 定义在同处);发送前校验。默认数值你自裁并在汇报列出(如 per-IP 10/24h)。
- **不做**:全局每日发送预算(数值需用户拍板,记入汇报「问题」段);不改 OTP 发送渠道本身。

### #3 + #17 [Medium/Low] 密码登录无防爆破 + 账号存在性时间侧信道
- `api/auth/password/login/route.ts:9-37`:无任何节流(OTP 有 5 错锁 15min)。
- `account-store.ts:401-406`(DB 无行 → 跳过 scrypt)与 session-store.ts:156-169(内存路径类似)存在时间侧信道。
- **修法**:(a) 登录路由加 per-IP/每账号滑动窗口节流(复用 otpGuard 风格);(b) 查无此人时也执行一次 dummy verify 抹平耗时(DB 与内存两路径)。

### #4 [Medium] SESSION_SECRET 公开常量回退 + 文档标「可选」
- `session-store.ts:57-62`:`process.env.SESSION_SECRET || 'domain-map-demo-session'`;对照 `oauth-state.ts:20-27`(boot 随机)。
- **修法**:(a) 生产(NODE_ENV=production)缺 SESSION_SECRET → 拒绝签名/校验(signToken/verifyToken 抛错,或启动即失败——以不破坏现有测试为度);(b) demo 回退改 boot 随机并与 oauth-state 统一(两个模块共享同一随机 boot secret 机制);(c) 文档:tech/15(生产部署)、tech/27、`server/docs/environment-variables.md` 将 SESSION_SECRET 改为「生产必配」。
- **不做**:实际为生产环境设置该变量(Env-only,入 deferred)。

## 文件边界

- **可以改**:`server/src/lib/account-store.ts`、`server/src/app/api/auth/otp/send/route.ts`、`server/src/app/api/auth/password/login/route.ts`、`server/src/lib/session-store.ts`、`server/src/lib/oauth-state.ts`(仅对齐共用随机 secret 机制)、对应测试文件(`server/tests/` 下 auth/otp/account 主题文件,可新建)、`tech/15*.md`、`tech/27*.md`、`server/docs/environment-variables.md`(仅本批涉及段落)。
- **不碰**:`server/src/app/api/auth/me/route.ts`(ws-b)、`api/pois`、`agent/chat`、`public-cache.ts`、`server/data/**`、`map-shell.tsx`、`map-engine/**`、其他 tech 文档、`CHANGELOG.md`/`README.md`/`CLAUDE.md`/`agent.md`(ws-c)。

## 门禁

1. `cd /Users/acccan/dm-wt-scan-a/server && npm test`(全绿,新增测试含 #1 契约测试)
2. `npm run typecheck`
3. `cd /Users/acccan/dm-wt-scan-a && make docs-check`、`git diff --check`
4. 小步 commit(Conventional Commits;每完成一个发现号一次提交)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix/reports/ws-a.md`:每个发现号的修法/测试/默认数值;**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
