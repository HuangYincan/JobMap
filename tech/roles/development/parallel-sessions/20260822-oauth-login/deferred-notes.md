# Deferred Notes — 20260822-oauth-login

> 需用户决策 / Env-only / 手动配置项。任务完成后统一在最终汇报告知,不打断。

## 2026-08-22 | Env-only | 第三方登录凭据(核心手动配置项,用户点名要)

实现需要用户手动配置以下内容(详细操作步骤见合并后 `tech/27-oauth-login.md`):

1. **GitHub OAuth App**:github.com → Settings → Developer settings → OAuth Apps → New OAuth App;Authorization callback URL = `<origin>/api/auth/oauth/callback/github` → 拿 Client ID + Client Secret → 写入 `server/.env.local` 的 `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`。
2. **Google Cloud OAuth Client**:console.cloud.google.com → Credentials → OAuth client ID → Web application → Authorized redirect URIs = `<origin>/api/auth/oauth/callback/google` → `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`(需先配置 OAuth consent screen)。
3. **微信开放平台网站应用**:需**已 ICP 备案域名**(localhost 不可用)→ 创建网站应用 → 审核通过 → `WECHAT_OAUTH_APP_ID` / `WECHAT_OAUTH_SECRET`;「授权回调域」配站点域名。
4. **回调 URL 一致性**:三方后台注册的回调必须与 `<origin>/api/auth/oauth/callback/{provider}` 完全一致;改部署域名需同步三方。
5. **SESSION_SECRET**(生产建议,已有变量):多实例部署显式设置,oauth_state 跨实例可验;未设时 boot 随机。

未配置时功能不坏:前端按钮自动回退 demo 登录(现状行为)。

## 2026-08-22 | 其他 | 测试与运行提示

- OAuth 流程单测零网络(mock fetch);真实三方登录需上述凭据配置后才能手工冒烟(Env-only,不自动跑)。
- 微信端到端验证需备案域名 + 微信审核通过,周期最长,建议最后验收。
