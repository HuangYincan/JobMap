# ws-docs 汇报(2026-08-22)

## 实际改动

- `tech/27-oauth-login.md`(新建,核心交付物)→ 第三方登录完整文档:功能定位(真实 OAuth 2.0 authorization code flow,GitHub/Google/微信,零依赖自研,未配置回退 demo)、流程总览(前端按钮 → start 302 → 三方 → callback → state 校验 → code 换 token → userinfo → upsertIdentity → session cookie → 302 回 next)、**⚠️ 手动配置清单(第 3 节,放显眼位置,含 5 项操作步骤)**、端点契约(与 ws-backend prompt 逐字一致)、Provider 细节(三 provider authorize/token/userinfo/身份映射)、环境变量表(6 新 + SESSION_SECRET 复用)、未配置时行为、错误码表(400 BAD_REQUEST / 503 OAUTH_NOT_CONFIGURED / auth_error 两值)、安全说明(state 防 CSRF、cookie httpOnly/lax、密钥服务端专用、next 防开放重定向、微信无邮箱回退 provider 名、23505 邮箱冲突挂接)、测试(tests/oauth.test.mjs 概要)、Demo 兼容
- `tech/14-api-contract.md` → 仅第 26 行 OAuth 段:demo 描述改为真实三件套(providers / start / callback + auth_error + 未配置回退 demo + 手动配置指引 tech/27);保留「Do not add X. Existing 'x' account rows stay valid.」;其余行零改动
- `server/.env.example` → 新增「第三方登录(OAuth,tech/27)」段(注释态 6 变量,含申请入口、回调 URL 注册要求、服务端秘密警示、SESSION_SECRET 兼任说明),照现有风格
- `server/docs/environment-variables.md` → 新增「### 第三方登录 (OAuth, tech/27)」小节(6 变量 + configured 判定 + 回调 URL 一致性);SESSION_SECRET 注释补充 oauth_state HMAC 用途(未设 → boot 随机);Last Updated → 2026-08-22
- `tech/README.md` → 索引加一行 `[27-oauth-login.md] | 第三方登录(GitHub/Google/微信 OAuth:契约/手动配置/回退)`

## 手动配置清单摘要(文档第 3 节)

1. **GitHub**:github.com → Developer settings → OAuth Apps → New OAuth App;Homepage URL 站点地址(开发 localhost:3000);Authorization callback URL `<origin>/api/auth/oauth/callback/github` → Client ID + Secret 写 `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`
2. **Google**:console.cloud.google.com → Credentials → Create Credentials → OAuth client ID;Application type **Web application**;Authorized redirect URIs 加 `<origin>/api/auth/oauth/callback/google`(先配 OAuth consent screen,User type 可 External)→ `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
3. **微信开放平台**:网站应用需**已 ICP 备案域名**(localhost 不可用)→ 审核通过后得 AppID + AppSecret → `WECHAT_OAUTH_APP_ID` / `WECHAT_OAUTH_SECRET`;「授权回调域」配站点域名
4. **回调 URL 一致性**:三方注册回调必须与 `<origin>/api/auth/oauth/callback/<provider>` 完全一致;部署域名变化需同步改三方
5. **SESSION_SECRET**:多实例部署建议显式设置,oauth_state 跨实例可验;未设 boot 随机

## 门禁结果

- make docs-check:等效 grep(`docs/roles/|docs/zh-cn/|预计发布时间.*2026-02-10|BOSS.*MVP.*爬|小红书.*MVP.*爬`,`--include='*.md' --exclude-dir=parallel-sessions`)在 worktree 内执行 → **零匹配通过**(exit=1);我改的 5 个文件无一违例
- git diff --check(worktree 内)→ **通过**(exit=0)
- 未跑 npm test(纯文档 WS,按 prompt 豁免);无代码文件改动

## 遇到的问题

- 主树 `make -C /Users/acccan/domain-map docs-check` 被会话沙箱 cwd 限制拦截(仅允许 worktree 与批次目录)→ 改为在 worktree 内执行与 Makefile 逐字相同的 grep(含 `--exclude-dir=parallel-sessions`);合并后 boss 可在主树复跑确认
- worktree 内 grep 命中 3 处 `parallel-sessions/20260821-*/` 既有 merge-report 自匹配(复述正则本身)——均在 `--exclude-dir` 排除范围内,非本批引入,与既有基线一致

## 证据

- 4 个提交:3d75028 `docs(auth): tech/27 oauth login guide with manual config`(tech/27 + README 索引)、a4dfd28 `docs(api-contract): real oauth endpoints`、7cd0441 `docs(env): oauth variables`(.env.example + environment-variables.md)、fdc6e41 `docs(api-contract): canonical oauth placeholder form`
- `git status --short` 干净;分支 feature/oauth-docs 留原地,未 merge / 未 push
- 端点契约与 ws-backend / ws-frontend prompt 逐字一致,无漂移

门禁: PASSED
结论: OK
