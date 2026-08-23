# WS ws-docs — OAuth 文档与配置指南

## 你的身份

headless 开发 worker(文档流)。**worktree 已预建,由 boss 统一合并:绝不 merge / push / 切分支**。完成后把汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-docs.md`。

- worktree:`/Users/acccan/dm-wt-oauth-docs`(分支 `feature/oauth-docs`,从 dev 切出)
- 汇报:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-docs.md`

## 背景

后端(ws-backend)与前端(ws-frontend)并行实现真实 OAuth 第三方登录(GitHub/Google/WeChat)。你的职责:**文档契约落地**,特别是用户点名要的「需要手动配置的内容」。**技术文档是当前事实契约**(tech/README.md 序言),代码改动必须同步文档。

⚠️ **tech/26 已被阿里云短信 docs 分支占用**(`feature/aliyun-sms-docs`,未合 dev)——你的新文档用 **tech/27**,不得碰 tech/26。

## 后端契约(与 ws-backend / ws-frontend prompt 完全一致,禁止漂移)

### 端点

1. `GET /api/auth/oauth/providers` → 200 `{ providers: [{ id: 'github'|'google'|'wechat', configured: boolean }] }`(固定顺序;configured = 该 provider 两 env 均非空;公开、无敏感信息)
2. `GET /api/auth/oauth/start?provider=<id>&next=<path>` → 302 三方 authorize(400 BAD_REQUEST / 503 OAUTH_NOT_CONFIGURED);`redirect_uri` = `<origin>/api/auth/oauth/callback/<provider>`;`oauth_state` cookie(httpOnly/lax/600s);`next` 仅同源相对路径,默认 `/`
3. `GET /api/auth/oauth/callback/<provider>?code=&state=` → 校验 state → code 换 token → 拉 userinfo → upsertIdentity → session cookie → 302 回 `next`;失败 → 302 `?auth_error=oauth_state_invalid|oauth_provider_error`

### Provider 细节

- **github**: authorize `https://github.com/login/oauth/authorize`(scope `read:user user:email`);token `POST https://github.com/login/oauth/access_token`(Accept: application/json);userinfo `GET https://api.github.com/user`(Bearer)→ subject=`id`, email=`email`(可空), displayName=`name ?? login`, avatarUrl=`avatar_url`
- **google**: authorize `https://accounts.google.com/o/oauth2/v2/auth`(scope `openid email profile`);token `POST https://oauth2.googleapis.com/token`;userinfo `GET https://openidconnect.googleapis.com/v1/userinfo`(Bearer)→ subject=`sub`, email=`email`, displayName=`name`, avatarUrl=`picture`
- **wechat**: authorize `https://open.weixin.qq.com/connect/qrconnect`(scope `snsapi_login`,`#wechat_redirect`);token **GET** `https://api.weixin.qq.com/sns/oauth2/access_token?appid&secret&code&grant_type=authorization_code` → openid;userinfo `GET https://api.weixin.qq.com/sns/userinfo?access_token&openid&lang=zh_CN` → subject=`openid`, **email=无(微信不给邮箱)**, displayName=`nickname`, avatarUrl=`headimgurl`

### Env 变量(新增 6 个 + 复用 1 个)

| 变量 | 含义 |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud OAuth Client(Web application) |
| `WECHAT_OAUTH_APP_ID` / `WECHAT_OAUTH_SECRET` | 微信开放平台网站应用 |
| `SESSION_SECRET`(已有)| oauth_state HMAC 签名密钥;未设 → boot 随机 |

### Demo 兼容

`POST /api/auth/oauth` 与 `POST /api/auth/github` 保留为 demo 桩:未配置真实凭据时前端回退 demo 登录(手机 OTP 同理的先例:demo:true)。

## 任务

### 1. 新建 `tech/27-oauth-login.md`(核心交付物)

结构参考 tech/25-resend-email.md(现状/契约/错误映射/配置)。必须包含:

- **功能定位**:真实 OAuth 2.0 authorization code flow(GitHub/Google/微信),零依赖自研(不引入 NextAuth/Clerk,ADR 未立前自研是既定策略 tech/14:30);未配置凭据时回退 demo 登录
- **流程**:前端按钮 → start 302 → 三方 → callback → exchange → upsertIdentity → session cookie → 302 回 next;`oauth_state` 签名 cookie(复用 `SESSION_SECRET`,600s,httpOnly/lax)与 next 同源清洗
- **端点契约**(上面三段逐字照抄)
- **⚠️ 手动配置清单(用户点名要的,放显眼位置,含操作步骤)**:
  1. **GitHub**:github.com → Settings → Developer settings → OAuth Apps → New OAuth App:Homepage URL 填站点地址,Authorization callback URL 填 `<origin>/api/auth/oauth/callback/github`(开发 localhost:3000 可用)→ 拿到 Client ID + Client Secret → 写入 `server/.env.local` 的 `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`
  2. **Google**:console.cloud.google.com → APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type: **Web application** → Authorized redirect URIs 加 `<origin>/api/auth/oauth/callback/google` → 拿 Client ID + Secret → 写 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`(OAuth consent screen 需先配:User type 可选 External)
  3. **微信开放平台**(open.weixin.qq.com):「网站应用」创建需要**已 ICP 备案的域名**(回调域必须备案域名,localhost 不可用)→ 创建网站应用 → 审核通过后得 AppID + AppSecret → 填 `WECHAT_OAUTH_APP_ID` / `WECHAT_OAUTH_SECRET`;「授权回调域」配置为站点域名
  4. **回调 URL 一致性**:三个 provider 的授权回调 URL 必须与 `redirect_uri`(`<origin>/api/auth/oauth/callback/<provider>`)完全一致;部署域名变化需同步改三方后台
  5. **SESSION_SECRET**(可选但生产建议):多实例部署时显式设置,保证 oauth_state 跨实例可验
- **未配置时行为**:前端按钮自动回退 demo 登录(`POST /api/auth/oauth` demo 桩);`GET /api/auth/oauth/providers` 供前端探测
- **错误码**:400 `BAD_REQUEST` / 503 `OAUTH_NOT_CONFIGURED`;auth_error: `oauth_state_invalid` / `oauth_provider_error`
- **安全说明**:state 防 CSRF、cookie httpOnly、密钥只在服务端、next 防开放重定向、微信无邮箱 → accountLabel 回退 provider 名
- **测试**:tests/oauth.test.mjs 概要

### 2. 改写 `tech/14-api-contract.md` 第 26 行附近(仅 OAuth 相关段)

把 demo 描述改为真实三件套(端点 + auth_error + 未配置回退 demo + 手动配置见 tech/27 指引)。**其余内容一行不动**。

### 3. `server/.env.example` 新增「第三方登录(OAuth)」段

照现有风格(注释含申请入口与「服务端秘密:永不打印、永不提交」),列出 6 个新变量(注释态)+ 说明回调 URL 注册要求 + 指向 tech/27。

### 4. `server/docs/environment-variables.md`

补充 6 个新变量 + `SESSION_SECRET`(如该文件已含则完善说明)。先读该文件了解结构,按现有格式追加。

### 5. `tech/README.md` 索引

加一行 `[27-oauth-login.md](27-oauth-login.md) | 第三方登录(GitHub/Google/微信 OAuth:契约/手动配置/回退)`。

## 文件边界

- 修改:`tech/14-api-contract.md`(仅 OAuth 段)、`server/.env.example`、`server/docs/environment-variables.md`、`tech/README.md`
- 新建:`tech/27-oauth-login.md`
- **不碰**:任何代码文件、`tech/26*`(阿里云占用)、其他 tech 文档

## 事实核验(硬性)

- 写文档前先读:tech/14 的 Account 段(现状口径)、tech/25(文档风格参考)、server/.env.example(现有格式)、server/docs/environment-variables.md(结构)。不要臆造端点/变量名——以上面「后端契约」段为准。
- 文档措辞「已实现 / 将实现」:**本批次合入 dev 后即为已实现**。用「当前实现」口径书写。

## 门禁(全部通过才算 DONE)

```bash
cd /Users/acccan/domain-map && make docs-check   # 文档规范(含 tech/27、tech/14 修改)
git diff --check                                  # worktree 内
```

(纯文档 WS,不要求 npm test;但请确保没有破坏任何 markdown 链接/表格。)

## 提交

Conventional Commits(`docs(auth): tech/27 oauth login guide with manual config` / `docs(api-contract): real oauth endpoints` / `docs(env): oauth variables`)。

## 回报(末两行必须精确)

写到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-docs.md`,含:文档清单、手动配置清单摘要(3 provider + 回调 + SESSION_SECRET)、遇到的问题、门禁输出摘要。末两行:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话>
```
