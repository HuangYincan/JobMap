# WS fix — callback 路由 500(Next 16 要求绝对重定向 URL)

## 你的身份

headless 开发 worker。**worktree 已预建,由 boss 统一合并:绝不 merge / push / 切分支**。完成后把汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-callback-500/reports/ws-fix.md`。

- worktree:`/Users/acccan/dm-wt-oauth-fix-redirect`(分支 `fix/oauth-callback-500`,基于最新 dev)
- 汇报:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-callback-500/reports/ws-fix.md`

## 根因(已确诊,boss 亲手复现)

Next 16 的 `NextResponse.redirect(url)` 内部调用 `validateURL(url)` → `new URL(String(url))`——**相对路径无 base 直接抛错**("URL is malformed... Please use only absolute URLs")。callback 路由 4 处重定向全部传了相对路径(`result.next` 或 `errorRedirectPath(...)` 输出,如 `/` / `/?auth_error=...`),因此:

- `GET /api/auth/oauth/start` 正常(跳 github.com 绝对 URL)
- `GET /api/auth/oauth/callback/<provider>` **任何路径都 500**(成功路径 `result.next` 相对;失败路径 `errorRedirectPath` 相对)——curl 复现:无 cookie 请求 callback → 500

lib 层单测全绿是因为流程测试在 flow 层(假 jar),未覆盖 Next 16 路由层行为。

## 修复方案(最小改动)

### 1. `server/src/lib/oauth/oauth-flow.ts` — 新增纯函数

```ts
/**
 * 相对路径 → 同源绝对 URL(Next 16 的 NextResponse.redirect 只接受绝对 URL,
 * 相对路径会在 validateURL 抛错 → 路由 500)。
 * path 必须已 sanitize(单 `/` 开头、非 `//`);origin 来自 request.url。
 * 防御:解析结果跨源(理论上不可能,next 已清洗)→ 回落 origin + '/'。
 */
export function absoluteRedirect(path: string, origin: string): string
```

实现:`new URL(path, origin).toString()`;若结果 origin ≠ 入参 origin → 返回 `origin + '/'`。path 形如 `/map?x=1` / `/?auth_error=...`(均以单 `/` 开头,由 sanitizeNext / errorRedirectPath 保证)。

### 2. `server/src/app/api/auth/oauth/callback/[provider]/route.ts` — 4 处重定向改绝对

route 顶部 `const base = url.origin`(已有 `new URL(request.url)`),每处:
- L36 成功:`NextResponse.redirect(absoluteRedirect(result.next, base), 302)`
- L42 state 无效:`NextResponse.redirect(absoluteRedirect(errorRedirectPath(err.next, 'oauth_state_invalid'), base), 302)`
- L45 provider 错误:`NextResponse.redirect(absoluteRedirect(errorRedirectPath(err.next, 'oauth_provider_error'), base), 302)`
- L48 兜底:`NextResponse.redirect(absoluteRedirect('/?auth_error=oauth_provider_error', base), 302)`

start 路由不动(已是绝对 URL)。

### 3. `server/tests/oauth.test.mjs` — 回归测试

- `absoluteRedirect('/map?x=1', 'http://localhost:3000')` → `'http://localhost:3000/map?x=1'`
- `absoluteRedirect('/', 'http://localhost:3000')` → `'http://localhost:3000/'`
- 与 `errorRedirectPath` 组合:`absoluteRedirect(errorRedirectPath('/', 'oauth_state_invalid'), 'http://localhost:3000')` → `'http://localhost:3000/?auth_error=oauth_state_invalid'`
- 跨源防御(如 `'//evil.com/x'` 直接传入)→ 回落 origin + '/'(防御分支)
- readFileSync 契约测试(既有模式)补一条:callback route 源码含 `absoluteRedirect(` 且不含裸 `NextResponse.redirect(result.next` / `errorRedirectPath(err.next` 直传——防止回归。

## 文件边界

- 修改:`server/src/lib/oauth/oauth-flow.ts`、`server/src/app/api/auth/oauth/callback/[provider]/route.ts`、`server/tests/oauth.test.mjs`
- **不碰**:其他一切(含 start/providers 路由、docs、数据)

## 门禁

```bash
cd /Users/acccan/dm-wt-oauth-fix-redirect/server && node --test tests/oauth.test.mjs   # 先快速回归
cd /Users/acccan/dm-wt-oauth-fix-redirect/server && npm test                            # 全量
cd /Users/acccan/dm-wt-oauth-fix-redirect/server && npm run typecheck
cd /Users/acccan/domain-map && make docs-check                                           # 若沙箱拦 cwd,用既有等效 grep 并说明
git diff --check                                                                         # worktree 内
```

提交 1-2 个 Conventional Commits(`fix(auth): absolute redirect URLs in oauth callback (Next 16)` + `test(auth): ...`)。

## 回报(末两行必须精确)

汇报写到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-callback-500/reports/ws-fix.md`:根因一句话、改动文件、新增测试数、门禁输出摘要。末两行:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话>
```
