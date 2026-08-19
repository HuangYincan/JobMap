# ws-qa2 汇报(2026-08-19)

## 实际改动

分支 `fix/qa-otp-account`,2 commits(1eef5a1, bb4408c),工作树干净,未 merge 未 push。

### #4 OTP 限流 / 尝试上限 / 过期清理

- `server/src/lib/account-store.ts`
  - 新增 `OtpRateLimitedError` / `OtpTooManyAttemptsError`(均带 `retryAfterMs`,route 转 429)。
  - 新增进程内守卫 `otpGuards`(按 `provider:target` 归一 key)+ 可调参数 `otpRateConfig`:
    - `issueOtp`:同 target **60s 冷却**(`OtpRateLimitedError`)、**24h 上限 10 次**(
      `OtpRateLimitedError`)、锁定期内拒发新码(`OtpTooManyAttemptsError`,防止绕过尝试上限);
    - `consumeOtp`:15min 窗口**错误尝试 ≥5 → 锁 15min**(第 5 次即抛
      `OtpTooManyAttemptsError`;锁定期内正确码也拒绝),**正确码清零**计数。
  - `issueOtp` DB 插入前**顺手清理该 target 过期挑战行**(`expires_at <= now()`),
    控制 `auth_otp_challenges` 膨胀(与 consumeOtp 既有清扫同款 SQL)。
- `server/src/app/api/auth/otp/send/route.ts`:限流/尝试锁错误 → **429**(`RATE_LIMITED` /
  `TOO_MANY_ATTEMPTS` + `retryAfterMs`);demo `hint: '000000'` 原样保留。
- `server/src/app/api/auth/otp/verify/route.ts`:锁 → **429 `TOO_MANY_ATTEMPTS`**;错误码照旧 401。

**守卫选型理由**(prompt 允许自选):内存+DB 双写,而非给 `auth_otp_challenges` 加
`attempted_at/attempt_count` 列——迁移 apply 是 Env-only、本轮不可动 schema;且守卫必须在
无库测试与内存模式下同样生效。DB 行仍是权威的 code/过期;限流窗口状态在进程内(演示单实例
部署足够,多实例需 Redis 等共享状态,已注 deferred)。

### #5 withDb 写路径不静默降级

- `server/src/lib/account-store.ts`
  - `withDb` 拆为 `withDbRead`(保留内存降级)与 `withDbWrite`(**DB 故障抛
    `DbUnavailableError`**,route 转 503;`UsernameTakenError` 照旧原样抛出 409)。
  - 写路径全部切 `withDbWrite`:`upsertIdentity` / `registerWithPassword` / `createSession` /
    `destroySession` / `updateUser` / `issueOtp` / `consumeOtp` / `addHistory` / `clearHistory` /
    `savePlace` / `removeSaved` / `recordApplication` / `enqueueNotification`。
  - 读路径保留降级:`loginWithPassword` / `getSessionUser` / `listHistory` / `listSaved` /
    `listApplications` / `listNotifications`(读不到不至于崩,合理)。
  - 新增测试钩子 `__accountStoreTest.poolOverride`(注入 fake 池模拟 DB 故障 / null 强制内存,
    绕过 `getPool` 进程级缓存——否则无库测试进程内 pool 被缓存为 null,故障不可注入)。

## 测试(新增 `server/tests/otp-guard.test.mjs`,7 条)

- 60s 冷却:同 target 第二发 → `OtpRateLimitedError`(retryAfterMs ∈ (0, 60s])
- 24h 上限:缩小窗口连发 3 次(上限 3)→ 第 4 发拒
- 5 错锁:4 次错 → false;第 5 次错 → `OtpTooManyAttemptsError`;锁定期正确码、send 均被拒
- 正确码清零计数(清零后 4 次错不触发锁)
- DB 路径 issueOtp 插入前先发过期清扫 SQL(契约断言)
- 写路径 DB 故障 → `DbUnavailableError`(issueOtp/consumeOtp/upsertIdentity/savePlace/
  recordApplication/enqueueNotification/createSession/addHistory/updateUser 全覆盖)
- 读路径 DB 故障 → 降级内存不抛(listSaved/listHistory/getSessionUser)
- send/verify 路由源码断言:429/503 映射 + demo hint 保留(仓库既有 readFileSync 契约模式;
  路由文件不直接 import——`next/server` 在纯 node 测试进程不可行,沿用现有约定)

## 门禁结果

- npm test:**431 测试,429 通过 / 0 失败**(2 skipped,含既有 skip;此前 424 → 新增 7)
- typecheck:通过
- docs-check:通过
- git diff --check:通过

## 遇到的问题

- **单测注入 DB 故障**:`getPool()` 进程级缓存把「无 DATABASE_URL → null」永久缓存,普通
  env 手段无法在测试内模拟「已配置但故障」。→ 加 `__accountStoreTest.poolOverride` 测试钩子
  (绕过缓存,注入 fake 池),生产调用方不碰;已注释说明。
- **routes 不可在 node --test 直接 import**(`next/server` 依赖 Next 运行时)→ 路由行为按仓库
  既有模式用源码断言覆盖,行为语义由 store 层单测保证。
- **一个文件两个修复**(guard + withDb 拆分都落在 account-store.ts)→ 无法用非交互式 git
  干净拆成两个 commit,故 store 层一个 commit、路由+测试一个 commit,commit message 分节说明。
- DB 写失败时守卫的 lastSentAt 已先记录 → 失败后的 60s 内重试会 429(反滥用,有意为之)。

## 证据

- 测试输出:431 tests / 429 pass / 0 fail(两次独立运行一致,提交前后各一次)
- `git log`:1eef5a1(store 层)+ bb4408c(路由+测试),分支 tip,工作树干净
- 复现序列:`cd server && npm test && npm run typecheck`;`cd .. && make docs-check && git diff --check`

门禁: PASSED
结论: OK
