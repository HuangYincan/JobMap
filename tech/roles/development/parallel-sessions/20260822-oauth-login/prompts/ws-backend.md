# WS ws-backend — 真实 OAuth 后端(foundation)

## 你的身份

headless 开发 worker。**worktree 已预建,由 boss 统一合并:绝不 merge / push / 切分支**。完成后把汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-backend.md`。

- worktree:`/Users/acccan/dm-wt-oauth-backend`(分支 `feature/oauth-backend`,从 dev 切出)
- 汇报:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-backend.md`

## 背景

项目现有 demo 第三方登录:`POST /api/auth/oauth`(`server/src/app/api/auth/oauth/route.ts`)与 `POST /api/auth/github`(`server/src/app/api/auth/github/route.ts`)都是硬编码 demo 身份(注释「Later: real OAuth code exchange per provider」)。你的任务:实现真实 OAuth 2.0 authorization code flow(GitHub / Google / WeChat),保持 demo stub 作未配置回退。

**已确认的现状**(Explore 结论,可信):
- `upsertIdentity({provider, subject, email?, phone?, displayName?, avatarUrl?})`:`server/src/lib/account-store.ts:227-273`,DB + 内存双实现,`users.subject` 唯一,`ON CONFLICT (subject) DO UPDATE`。
- `createSession(userId)` → `{token, expiresAt}`;`writeSessionCookie(token, expiresAt)`(`server/src/lib/http-session.ts:14-23`,httpOnly / sameSite lax / secure 仅生产)。
- 会话 token 自带 HMAC;`SESSION_SECRET` 是既有 env(session-store.ts:61,默认 `'domain-map-demo-session'`)。**oauth_state 签名复用 SESSION_SECRET**;未设置时 boot 随机(`randomBytes(32)`),不引入新 env。
- `users` 有 `users_email_uidx`(lower(email) 唯一):Google 邮箱撞已有 OTP 邮箱用户 → INSERT 23505 → 需要处理(见任务 4)。
- 测试:`node --test tests/*.test.mjs`,Node 22 直接 import `.ts`;mock fetch 先例 `tests/resend-client.test.mjs`(注入 `fetchImpl`);强制内存模式先例 `__accountStoreTest.poolOverride`(account-store.ts:193)。
- 零依赖手写客户端是项目惯例(resend-client / aliyun-sms-client 先例)。

## 契约(与 ws-frontend / ws-docs prompt 完全一致,禁止漂移)

### 1. `GET /api/auth/oauth/providers`(新文件 `server/src/app/api/auth/oauth/providers/route.ts`)

- 200 → `{ providers: [{ id, configured }] }`,`id` ∈ `'github'|'google'|'wechat'`(固定顺序 github/google/wechat),`configured` = 该 provider 的 client id + secret 均已在 env。公开接口,零敏感信息。无需登录。

### 2. `GET /api/auth/oauth/start?provider=<id>&next=<path>`(新文件 `server/src/app/api/auth/oauth/start/route.ts`)

- provider 缺失/非法 → 400 `{ code: 'BAD_REQUEST' }`
- 未配置 → 503 `{ code: 'OAUTH_NOT_CONFIGURED' }`(前端正常流程不会触发,防御性)
- 成功 → **302** 到 provider authorize URL + 写入 `oauth_state` cookie:
  - `redirect_uri` = `new URL(request.url).origin + '/api/auth/oauth/callback/<provider>'`(必须与三方注册的回调一致)
  - `state` = 随机 32-byte hex nonce
  - `oauth_state` cookie = HMAC 签名载荷 `state|next|exp`,格式自定义(如 `v1.<ts>.<state>.<hmac>`),httpOnly、sameSite=lax、secure=production、`path=/`、maxAge 600s
  - `next` 清洗:仅接受同源相对路径——以单个 `/` 开头、非 `//`、非 `/\`、≤2048 字符;不合法 → 默认 `/`
- authorize URL 各 provider:
  - **github**: `https://github.com/login/oauth/authorize?client_id&redirect_uri&state&scope=read:user user:email`
  - **google**: `https://accounts.google.com/o/oauth2/v2/auth?client_id&redirect_uri&state&response_type=code&scope=openid email profile`
  - **wechat**: `https://open.weixin.qq.com/connect/qrconnect?appid&redirect_uri&state&response_type=code&scope=snsapi_login&lang=zh_CN#wechat_redirect`(保留 fragment)

### 3. `GET /api/auth/oauth/callback/<provider>?code=&state=`(新文件 `server/src/app/api/auth/oauth/callback/[provider]/route.ts`)

- **state 校验**:cookie `oauth_state` 存在、HMAC 有效、未过期(600s)、`state` 与 query 一致 → 通过后**立即清 cookie**;任一失败 → 302 到清洗后 `next`(默认 `/`)带 `?auth_error=oauth_state_invalid`。不要向三方发任何请求。
- **code 换 token → userinfo**(server-side fetch,失败 → 302 `?auth_error=oauth_provider_error`,清 cookie):
  - **github**: token `POST https://github.com/login/oauth/access_token`(form-encoded,header `Accept: application/json`)→ `{ access_token }`;userinfo `GET https://api.github.com/user`(Bearer)→ `{ id, login, name, email, avatar_url }`
  - **google**: token `POST https://oauth2.googleapis.com/token`(form-encoded)→ `{ access_token }`;userinfo `GET https://openidconnect.googleapis.com/v1/userinfo`(Bearer)→ `{ sub, email, name, picture }`
  - **wechat**: token **GET** `https://api.weixin.qq.com/sns/oauth2/access_token?appid&secret&code&grant_type=authorization_code` → `{ openid, access_token }`;userinfo `GET https://api.weixin.qq.com/sns/userinfo?access_token&openid&lang=zh_CN` → `{ openid, nickname, headimgurl }`
  - 失败判定:HTTP 非 2xx、JSON 含 `error`/`errcode` 非 0、字段缺失。
- **身份映射 → `upsertIdentity`**:
  - github: subject=`String(id)`, email=`email ?? undefined`, displayName=`name ?? login`, avatarUrl=`avatar_url`
  - google: subject=`sub`, email=`email`, displayName=`name`, avatarUrl=`picture`
  - wechat: subject=`openid`, email=**undefined(微信无邮箱,不报错)**, displayName=`nickname`, avatarUrl=`headimgurl`
- 成功:`createSession` + `writeSessionCookie` → 302 到 `next`(**不带参数**)。
- provider 非法 → 400;route 层错误兜底 → 302 `?auth_error=oauth_provider_error`。
- **fetch 可注入**:`lib/oauth/oauth-exchange.ts` 导出测试钩子(照 `resend-client` / `__accountStoreTest` 先例),测试零网络。

### 4. `upsertIdentity` 邮箱冲突处理(`server/src/lib/account-store.ts:227-273`)

Google 邮箱撞已有 OTP 邮箱用户时 INSERT 抛 23505(users_email_uidx)→ 捕获后:按 lower(email) 查到已有用户 → 为其插入 `auth_identities (provider, subject) ON CONFLICT DO NOTHING` → 返回该用户(身份挂接,不新建)。**只在 23505 时走此分支**,其余错误照旧抛 DbUnavailableError。内存路径无需改动。

### 5. Env 变量(只读取;写入 .env.example 由 ws-docs 负责)

| 变量 | 含义 |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud OAuth Client |
| `WECHAT_OAUTH_APP_ID` / `WECHAT_OAUTH_SECRET` | 微信开放平台网站应用 |
| `SESSION_SECRET`(已有)| oauth_state HMAC 密钥;未设 → boot 随机 |

configured 判定 = 对应两变量**均非空**(trim 后)。密钥绝不打印、绝不进日志、绝不进响应。

### 6. Demo stub 兼容

`POST /api/auth/oauth` 与 `POST /api/auth/github` **行为保持不变**(未配置时前端回退 demo 登录)。可在 `oauth/route.ts` 头部注释注明「Demo fallback,仅未配置真实 OAuth 时使用」,不改逻辑。

## 文件边界

- 新建:`server/src/lib/oauth/oauth-config.ts`(provider registry:env 读取/configured/authorize URL/端点)、`oauth-state.ts`(nonce 签发 + HMAC 校验 + next 清洗)、`oauth-exchange.ts`(code→token→userinfo,含 fetch 注入钩子);`server/src/app/api/auth/oauth/providers/route.ts`、`.../start/route.ts`、`.../callback/[provider]/route.ts`;`server/tests/oauth.test.mjs`
- 修改:`server/src/lib/account-store.ts`(仅 23505 分支;其余函数不动)
- **不碰**:`session-store.ts`(别的批次在改)、OTP/密码路由、`auth-modal.tsx` / `map-shell.tsx` / `i18n.ts`、`tech/*`、`.env.example`

## 测试要求(`server/tests/oauth.test.mjs`,node --test,内存模式,零网络)

1. providers 端点:env 注入(照 withEnv 先例)→ configured 判定正确、固定顺序、无敏感字段
2. start:合法 provider → 302 + Location 含 authorize host/client_id/state/redirect_uri;cookie `oauth_state` 已设(httpOnly 标记);`next` 绝对 URL / `//evil` → 清洗为 `/`;非法 provider → 400;未配置 → 503
3. callback(mock fetch:按 provider 注入 token/userinfo 响应):
   - 全链路成功 → 新用户落库(内存 store)→ session cookie 已写 → 302 到 next 无 auth_error;同一 provider 二次登录 → 复用同一用户(id 不变)
   - state 缺失/不匹配/过期 → `?auth_error=oauth_state_invalid` 且**未**调用三方
   - code 交换失败 / userinfo 失败 → `?auth_error=oauth_provider_error`
   - wechat:email undefined → accountLabel 回退 provider 名(照 account.ts 语义)
   - next 绝对 URL → 跳回 `/`
4. upsertIdentity 邮箱冲突:`__accountStoreTest.poolOverride` 注入 fake 池(先 INSERT 抛 23505 再 SELECT/INSERT 成功)→ 返回已有用户 + 身份挂接;非 23505 → 仍抛 DbUnavailableError

## 门禁(全部通过才算 DONE)

```bash
cd /Users/acccan/dm-wt-oauth-backend/server && npm test          # 全量(现有 568 + 新增)
cd /Users/acccan/dm-wt-oauth-backend/server && npm run typecheck
cd /Users/acccan/domain-map && make docs-check                   # 文档规范(主树 makefile)
git diff --check                                                 # worktree 内
```

## 提交

小步 Conventional Commits(如 `feat(auth): oauth providers registry` / `feat(auth): start redirect with signed state` / `feat(auth): callback code exchange` / `feat(auth): upsertIdentity email collision attach` / `test(auth): oauth flow suites`)。每次提交前跑相关测试。

## 回报(末两行必须精确)

写到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-backend.md`,含:实现摘要、端点清单、测试数(新增/总)、遇到的问题与裁决、门禁输出摘要。末两行:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话>
```
