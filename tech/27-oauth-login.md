# 27 — 第三方登录(GitHub / Google / 微信 OAuth 2.0 authorization code flow)

**文档版本:** 1.0
**创建日期:** 2026-08-22
**状态:** 已实现(批次 `20260822-oauth-login` 合入 dev 后生效)
**相关:** `tech/14-api-contract.md`(Account 段 OAuth 行)、`server/.env.example`(第三方登录段)、`server/docs/environment-variables.md`、批次目录 `tech/roles/development/parallel-sessions/20260822-oauth-login/`

---

## 1. 背景与动机

项目原有 demo 第三方登录桩(`POST /api/auth/oauth` 与 `POST /api/auth/github`),身份硬编码,注释「Later: real OAuth code exchange per provider」。本批次实现**真实 OAuth 2.0 authorization code flow**(GitHub / Google / 微信),**零依赖自研**:不引入 NextAuth / Clerk(ADR 未立前自研是既定策略,tech/14 Account 段与 tech/06)。未配置真实凭据时,前端按钮自动回退 demo 登录,功能不坏。

设计要点:

- 三件套端点:`providers` 探测 / `start` 跳转 / `callback` 收尾(契约见第 4 节)
- `oauth_state` **签名 cookie 防 CSRF**:复用既有 `SESSION_SECRET` 做 HMAC,600s 过期,httpOnly + sameSite lax(secure 仅生产),校验通过立即清 cookie
- 身份经既有 `upsertIdentity` 落库,复用 session 体系,**零新增存储**
- 微信无邮箱 → email 传 undefined,不报错;accountLabel 回退 provider 名
- 邮箱冲突(23505):Google 邮箱撞已有 OTP 邮箱用户 → 身份挂接已有用户,不新建、不覆盖

## 2. 流程总览

```
前端登录按钮
  → GET /api/auth/oauth/start?provider=<id>&next=<path>
  → 302 到三方 authorize(写入 oauth_state 签名 cookie)
  → 用户在三方授权,重定向回 /api/auth/oauth/callback/<provider>?code=&state=
  → 校验 state(HMAC 有效 + 未过期 + 与 query 一致,通过即清 cookie)
  → code 换 token → 拉 userinfo
  → upsertIdentity(邮箱冲突 23505 → 身份挂接已有用户)
  → createSession + 写 session cookie
  → 302 回 next(清洗后的同源相对路径,默认 /)
```

失败路径:state 校验失败 → 302 `?auth_error=oauth_state_invalid`(**不发任何三方请求**);code 交换 / userinfo 失败 → 302 `?auth_error=oauth_provider_error`。

## 3. ⚠️ 手动配置清单(需要人工完成,无代码)

> 未配置任何凭据时功能不坏:前端按钮自动回退 demo 登录。以下为启用真实登录的手动步骤。

### 3.1 GitHub OAuth App

1. github.com → Settings → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. **Homepage URL** 填站点地址(开发可用 `http://localhost:3000`)
3. **Authorization callback URL** 填 `<origin>/api/auth/oauth/callback/github`
4. 创建后拿到 **Client ID + Client Secret**
5. 写入 `server/.env.local` 的 `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`

### 3.2 Google Cloud OAuth Client(Web application)

1. console.cloud.google.com → **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. **Application type: Web application**
3. **Authorized redirect URIs** 加 `<origin>/api/auth/oauth/callback/google`
4. 拿到 **Client ID + Client Secret** → 写 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
5. 前置:需先配置 **OAuth consent screen**(User type 可选 External)

### 3.3 微信开放平台网站应用

1. open.weixin.qq.com → 创建「**网站应用**」——要求**已 ICP 备案的域名**(回调域必须备案域名,**localhost 不可用**)
2. 「**授权回调域**」配置为站点域名
3. 创建后经**审核通过**得 **AppID + AppSecret**
4. 写 `WECHAT_OAUTH_APP_ID` / `WECHAT_OAUTH_SECRET`

### 3.4 回调 URL 一致性(三个 provider 通用)

三方后台注册的授权回调 URL 必须与 `redirect_uri`(`<origin>/api/auth/oauth/callback/<provider>`)**完全一致**;部署域名变化需同步改三方后台,否则回调时报 redirect_uri 不匹配。

### 3.5 SESSION_SECRET(可选但生产建议)

`SESSION_SECRET` 是既有变量(见 `server/docs/environment-variables.md`),现在兼任 `oauth_state` 的 HMAC 签名密钥。**多实例部署时显式设置**,保证 oauth_state 跨实例可验;未设置时 boot 随机(会话仍可用,但重启后已签发 state 失效,用户需重新走一次登录)。

## 4. 端点契约

### `GET /api/auth/oauth/providers`

→ 200 `{ providers: [{ id: 'github'|'google'|'wechat', configured: boolean }] }`(固定顺序;configured = 该 provider 两 env 均非空;公开、无敏感信息)

### `GET /api/auth/oauth/start?provider=<id>&next=<path>`

→ 302 三方 authorize(400 BAD_REQUEST / 503 OAUTH_NOT_CONFIGURED);`redirect_uri` = `<origin>/api/auth/oauth/callback/<provider>`;`oauth_state` cookie(httpOnly/lax/600s);`next` 仅同源相对路径,默认 `/`

### `GET /api/auth/oauth/callback/<provider>?code=&state=`

→ 校验 state → code 换 token → 拉 userinfo → upsertIdentity → session cookie → 302 回 `next`;失败 → 302 `?auth_error=oauth_state_invalid|oauth_provider_error`

## 5. Provider 细节

- **github**: authorize `https://github.com/login/oauth/authorize`(scope `read:user user:email`);token `POST https://github.com/login/oauth/access_token`(Accept: application/json);userinfo `GET https://api.github.com/user`(Bearer)→ subject=`id`, email=`email`(可空), displayName=`name ?? login`, avatarUrl=`avatar_url`
- **google**: authorize `https://accounts.google.com/o/oauth2/v2/auth`(scope `openid email profile`);token `POST https://oauth2.googleapis.com/token`;userinfo `GET https://openidconnect.googleapis.com/v1/userinfo`(Bearer)→ subject=`sub`, email=`email`, displayName=`name`, avatarUrl=`picture`
- **wechat**: authorize `https://open.weixin.qq.com/connect/qrconnect`(scope `snsapi_login`,`#wechat_redirect`);token **GET** `https://api.weixin.qq.com/sns/oauth2/access_token?appid&secret&code&grant_type=authorization_code` → openid;userinfo `GET https://api.weixin.qq.com/sns/userinfo?access_token&openid&lang=zh_CN` → subject=`openid`, **email=无(微信不给邮箱)**, displayName=`nickname`, avatarUrl=`headimgurl`

失败判定:HTTP 非 2xx、JSON 含 `error` / `errcode` 非 0、字段缺失。

## 6. 环境变量(新增 6 个 + 复用 1 个)

| 变量 | 含义 |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud OAuth Client(Web application) |
| `WECHAT_OAUTH_APP_ID` / `WECHAT_OAUTH_SECRET` | 微信开放平台网站应用 |
| `SESSION_SECRET`(已有)| oauth_state HMAC 签名密钥;未设 → boot 随机 |

configured 判定 = 对应两变量**均非空**(trim 后)。**服务端秘密:永不打印、永不进日志、永不进响应**。写入 `server/.env.local`(唯一生效配置文件),模板见 `server/.env.example` 的「第三方登录(OAuth)」段。

## 7. 未配置时行为

- `GET /api/auth/oauth/providers` → 各 provider `configured: false`(前端据此探测,自动回退)
- 前端按钮自动回退 **demo 登录**(`POST /api/auth/oauth` demo 桩,行为不变)
- `GET /api/auth/oauth/start` 防御性返回 503 `OAUTH_NOT_CONFIGURED`(正常流程不会触发)

## 8. 错误码

| 场景 | HTTP | code / auth_error |
|---|---|---|
| start:provider 缺失/非法 | 400 | `BAD_REQUEST` |
| start:该 provider 未配置 | 503 | `OAUTH_NOT_CONFIGURED` |
| callback:state 缺失/不匹配/过期(HMAC 校验失败) | 302 | `?auth_error=oauth_state_invalid` |
| callback:code 交换失败 / userinfo 失败 / 其他错误 | 302 | `?auth_error=oauth_provider_error` |
| callback:provider 非法 | 400 | `BAD_REQUEST` |

信封 `{ code, message }`;未知错误 re-throw,绝不返回 token / secret / 错误栈。

## 9. 安全说明

- **state 防 CSRF**:nonce 32-byte hex;`oauth_state` cookie 载荷为 HMAC 签名 `state|next|exp`(格式自定义,如 `v1.<ts>.<state>.<hmac>`);httpOnly + sameSite lax + secure(仅生产)+ 600s 过期;校验通过**立即清 cookie**;state 校验失败不发任何三方请求
- **密钥只在服务端**:`client_secret` / `WECHAT_OAUTH_SECRET` 仅在服务端 fetch 中引用(`process.env`),绝不打印、绝不进日志 / 请求 / 响应
- **next 防开放重定向**:仅接受同源相对路径——单个 `/` 开头、非 `//`、非 `/\`、≤2048 字符;不合法默认 `/`;callback 成功 302 回 next **不带参数**
- **微信无邮箱**:email 传 undefined(不报错),accountLabel 回退 provider 名
- **邮箱冲突挂接**:Google 邮箱撞已有 OTP 邮箱用户(INSERT 23505)→ 按 lower(email) 查到已有用户 → 插 `auth_identities (provider, subject)` → 返回该用户;只在 23505 走此分支,其余错误照旧抛

## 10. 测试(`server/tests/oauth.test.mjs`)

node --test,内存模式,**零网络**(mock fetch 注入 `fetchImpl`;env 注入 `withEnv`;store 用 `__accountStoreTest.poolOverride` 先例):

- **providers**:env 注入 → configured 判定正确、固定顺序、无敏感字段
- **start**:合法 provider → 302 + Location 含 authorize host / client_id / state / redirect_uri;`oauth_state` cookie 已设(httpOnly 标记);`next` 绝对 URL / `//evil` → 清洗为 `/`;非法 provider → 400;未配置 → 503
- **callback**(按 provider 注入 token / userinfo 响应):全链路成功 → 新用户落库(内存 store)→ session cookie 已写 → 302 到 next 无 auth_error;同一 provider 二次登录 → 复用同一用户(id 不变);state 缺失/不匹配/过期 → `?auth_error=oauth_state_invalid` 且**未**调用三方;code 交换失败 / userinfo 失败 → `?auth_error=oauth_provider_error`;wechat:email undefined → accountLabel 回退 provider 名;next 绝对 URL → 跳回 `/`
- **upsertIdentity 邮箱冲突**:fake 池先 INSERT 抛 23505 再 SELECT/INSERT 成功 → 返回已有用户 + 身份挂接;非 23505 → 仍抛 DbUnavailableError

## 11. Demo 兼容

`POST /api/auth/oauth` 与 `POST /api/auth/github` **行为保持不变**(demo 桩,注释注明「Demo fallback,仅未配置真实 OAuth 时使用」);已存在的 demo `'x'` 账号行保持有效。真实 OAuth 凭据配置后,前端不再走 demo 路径。
