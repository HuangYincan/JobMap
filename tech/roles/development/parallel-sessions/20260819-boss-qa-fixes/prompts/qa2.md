# ws-qa2 — #4 OTP 限流/尝试上限/过期清理 + #5 withDb 写路径不静默降级

## 背景

质量扫描(quality-scans/20260819-all/scan-report.md):

**#4 (Medium, backend)**:OTP 流程无速率限制、无尝试次数上限,响应直接回显 `hint: '000000'`(demo 固定码)。无限 send 无限写 `auth_otp_challenges`(仅 consume 时清过期)。
- `server/src/app/api/auth/otp/send/route.ts:21-36` → `issueOtp` → `account-store.ts:340-377`
- `server/src/app/api/auth/otp/verify/route.ts:5-29` → `consumeOtp` 无次数上限

**#5 (Medium, backend)**:`server/src/lib/account-store.ts:100-111` `withDb` 对所有非 UsernameTakenError 的 DB 错误 `console.warn` 后静默降级内存实现:DB 故障时收藏/投递/会话在内存与 DB 间分裂,保存看似成功实则丢失,用户无感知。

## 修复方向

### #4 OTP 加固(boss 拍板:限流本身直接做,真实发送是产品决策记 deferred)

- **send**:按 target+provider 限流——同 target 60s 内最多 1 次(返回 429 + 可重试时间)、24h 上限(如 10 次)。过期挑战行在 issueOtp 前顺手清理(`expires_at <= now()`),控制表膨胀。
- **verify**:尝试次数上限——同 target+provider 15 分钟窗口内错误尝试 ≥5 次 → 锁 15 分钟(返回 429/TOO_MANY_ATTEMPTS);`consumeOtp` 增加 attempt 计数(可在 auth_otp_challenges 上记 attempted_at/attempt_count,或按 target 用内存+DB 双写;worker 自选,说明理由)。
- **demo hint `000000` 保留**(本轮不做真实发送,deferred);但 send 响应里 `hint` 字段可保留原样(注明 demo)。

### #5 withDb 写路径不静默降级

- **写操作**(savePlace / recordApplication / enqueueNotification / addHistory / updateUser / createSession / consumeOtp 等)**不再静默回落内存**:DB 错误时抛(route 层转 5xx,如 503 DB_UNAVAILABLE)。注意区分:
  - `UsernameTakenError` 照旧抛出(409,已做)。
  - **读操作**(listSaved / listNotifications / getUser / 等)保留 fallback 降级(合理)。
- worker 需逐函数判断读写;内存实现保留给读路径。改后单测覆盖:写路径 DB 错误 → 抛;读路径 DB 错误 → 降级。

## 测试(必做)

- 现有 account 相关测试全绿;新增:限流(同 target 60s 内第二发 → 429)、尝试上限(5 错后锁)、写路径降级不再发生(DB 故障模拟 → 抛而非静默 200)。
- 注:account-store 是 DB+内存双实现,单测可用内存实现路径 + 注入失败池模拟。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-qa2)

- 只动:`server/src/app/api/auth/otp/send/route.ts`、`server/src/app/api/auth/otp/verify/route.ts`、`server/src/lib/account-store.ts`、`server/tests/*`(相关测试)
- **不碰**:`server/src/lib/spatial-query.ts`(ws-qa1)、`server/src/app/api/search|suggest|me/*`(ws-qa3)、`server/src/lib/modes.ts`/`api.ts`(ws-qa4)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-qa2/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-qa2 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-qa-fixes/reports/ws-qa2.md`:
改动文件 + 实现 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
