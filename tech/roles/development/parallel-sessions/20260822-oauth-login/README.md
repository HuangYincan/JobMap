# 批次 20260822-oauth-login — 第三方登录(真实 OAuth)

## 目标

把现有 demo OAuth(`POST /api/auth/oauth` 硬编码身份)升级为**真实 OAuth 2.0 authorization code flow**:

- GitHub / Google / WeChat 三个 provider(契约 tech/14:26 明确;不做 X;不引入 NextAuth/Clerk,自研零依赖,照 resend-client / aliyun-sms-client 先例)
- 全链路:前端按钮 → `/api/auth/oauth/start` 302 跳三方 → 三方回跳 `/api/auth/oauth/callback/<provider>` → code 换 token → 拉 userinfo → `upsertIdentity`(已有)→ `createSession`(已有)→ 写 cookie → 302 回 `next`
- **未配置凭据时自动回退现有 demo 登录**(本地零配置可用,行为不回归)
- 交付物含「需要手动配置的内容」清单(tech/27 + deferred-notes → 最终汇报)

## Workstream 表

| WS | 分支 | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|
| ws-backend | `feature/oauth-backend` | lib/oauth(config/state/exchange) + start/callback/providers 路由 + upsertIdentity 邮箱冲突 + tests/oauth.test.mjs | `server/src/lib/oauth/*`(新)、`server/src/app/api/auth/oauth/{start,providers}/route.ts`(新)、`server/src/app/api/auth/oauth/callback/[provider]/route.ts`(新)、`server/src/lib/account-store.ts`、`server/tests/oauth.test.mjs`(新) | session-store.ts、OTP 相关、auth-modal/map-shell、tech/27、.env.example |
| ws-frontend | `feature/oauth-frontend` | auth-modal 社交按钮:providers 探测 → 已配置跳转 start、未配置回退 demo POST;map-shell `?auth_error=` 处理(复用 modal 错误行) | `server/src/components/auth-modal.tsx`、`auth-modal.module.css`(仅必要时)、`server/src/components/map-shell.tsx`、`server/src/lib/i18n.ts` | lib/oauth、后端路由、tech/* |
| ws-docs | `feature/oauth-docs` | tech/27-oauth-login.md(全流程+手动配置指南)、tech/14:26 契约改写、.env.example OAuth 段、server/docs/environment-variables.md、tech/README.md 索引 | `tech/27-oauth-login.md`(新)、`tech/14-api-contract.md`(仅第 26 行附近)、`server/.env.example`、`server/docs/environment-variables.md`、`tech/README.md` | 任何代码;tech/26(阿里云占用) |

## 合并顺序

1. ws-backend(foundation)→ 2. ws-frontend → 3. ws-docs(依赖序;文件不相交,冲突风险低;merger 逐个 `--no-ff` 合并回 dev,红则停)

## 共享契约(三个 prompt 同一份,禁止漂移)

端点与响应形状、env 变量名、auth_error 码见各 prompt「契约」段。

## 手动配置清单(Env-only → deferred-notes,最终汇报给用户)

- GitHub OAuth App / Google Cloud OAuth Client / 微信开放平台网站应用 凭据
- 回调 URL 注册:`<origin>/api/auth/oauth/callback/{github|google|wechat}`
- 微信需 ICP 备案域名 + 应用审核
- 生产建议设置 `SESSION_SECRET`(oauth_state 签名密钥)

## 门禁

`cd server && npm test`、`npm run typecheck`、`make docs-check`、`git diff --check`(由各 WS prompt 指定)。

## Boss 裁决(2026-08-22 03:42,resume 合并指令)

**主树 npm test 红 = pre-existing,非本批引入,证据双验证**:
- 干净 worktree(无残留)跑 `tests/embodied-jobs-drops.test.mjs` → **4/4 pass**
- 主树(未提交 geocode 残留 47 文件,最新写入 03:26)同测试 → **1 fail**(`embj-远智科技.json` 的 `site.location.lng/lat` 违反已提交契约)
- oauth 批次的 merge 只动 auth 相关文件,零数据文件

**resume 合并时的门禁裁定**:
1. `npm test` 若红**仅限** embodied-jobs 语料契约测试、且根因为上述未提交残留 → **判定 pre-existing,豁免通过**,继续合并 + push origin/dev。
2. 出现**任何其他新红**(oauth 相关测试、typecheck、docs-check、diff-check、其他既有测试)→ 照常红则停,报告后 boss 再裁决。
3. **绝不 touch 未提交残留**(`server/data/recruitment/**` 与 `server/next-env.d.ts`):不 checkout、不 stash、不 commit、不 include。
4. ws-backend 分支 `feature/oauth-backend` 已合入 dev(本地 d22c3f8 且已在 origin/dev)→ `git merge --no-ff feature/oauth-backend` 会幂等跳过(已合并),无需处理;对应 worktree 可清。
5. 合并顺序:ws-frontend → ws-docs。ws-frontend 的 `map-shell.tsx`/`i18n.ts` 已被 agent-memory-ui merge(已 push)改动——按 git 正常三路合并解决,以 ws-frontend prompt 的「不碰」为据。
