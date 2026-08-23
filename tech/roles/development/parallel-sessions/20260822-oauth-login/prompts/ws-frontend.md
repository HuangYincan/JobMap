# WS ws-frontend — OAuth 前端按钮接入

## 你的身份

headless 开发 worker。**worktree 已预建,由 boss 统一合并:绝不 merge / push / 切分支**。完成后把汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-frontend.md`。

- worktree:`/Users/acccan/dm-wt-oauth-frontend`(分支 `feature/oauth-frontend`,从 dev 切出)
- 汇报:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-frontend.md`

## 背景

后端(并行 ws-backend)正在实现真实 OAuth 三件套。你要把 auth-modal 的社交按钮从「demo POST」升级为「**已配置 → 真实跳转;未配置 → 回退 demo POST**」。**行为改造 + 极小复用性 UI,不重新设计 modal 视觉**。

**已确认的现状**:
- `server/src/components/auth-modal.tsx`:`SOCIAL` 列表(github/google/wechat,:19-23),`social()` :161-179 POST `/api/auth/oauth`(demo),按钮在「other」tab `socialGrid` :367-381,错误显示 `styles.error` :432,i18n key `authGithub/authGoogle/authWechat` 已存在(:490-505)。
- `server/src/components/map-shell.tsx`:用户态 `user` :302,启动时 `GET /api/auth/me` :386;`authOpen` 状态 :303;`AuthModal` 渲染 :2380-2385。**没有 toast 系统**(代码注释「失败=不打扰,不新增 UI」)。
- i18n:`server/src/lib/i18n.ts`,双语(zh/en),结构 `{ key: { zh, en } }`。

## 后端契约(与 ws-backend / ws-docs prompt 完全一致,禁止漂移)

### 1. `GET /api/auth/oauth/providers`
200 → `{ providers: [{ id: 'github'|'google'|'wechat', configured: boolean }] }`,固定顺序 github/google/wechat。

### 2. `GET /api/auth/oauth/start?provider=<id>&next=<path>`
302 到三方 authorize;`oauth_state` cookie 由服务端写。provider 非法 → 400;未配置 → 503 `OAUTH_NOT_CONFIGURED`。

### 3. `GET /api/auth/oauth/callback/<provider>?code=&state=`
成功 → 302 回 `next`(session cookie 已写,**不带参数**);失败 → 302 回 `next` 带 `?auth_error=oauth_state_invalid|oauth_provider_error`。

## 任务

### 1. `social()` 改造(auth-modal.tsx)

- 新增组件状态 `providers: { id: string; configured: boolean }[] | null`。modal 打开(`open` 变 true)时 fetch `/api/auth/oauth/providers`(一次即可,失败静默置 null,不影响 UI)。
- `social(provider)` 逻辑:
  1. 若 providers 已加载且该 provider `configured === false` → **保持现有 demo POST `/api/auth/oauth`**(原逻辑,零改动路径)。
  2. 若 `configured === true`(或 providers 尚未加载成功——**宁可真实流程也不 demo**,避免误登 demo 账号)→ `window.location.href = "/api/auth/oauth/start?provider=<id>&next=" + encodeURIComponent(location.pathname + location.search)`(全页跳转,天然带 cookie;回调返回后全页刷新,map-shell 启动时自动拉 `/api/auth/me`,用户态自动恢复)。
- 不要给按钮加禁用/加载态视觉(跳转即走,加了也看不见);`busy` 状态沿用即可。

### 2. `?auth_error=` 处理(map-shell.tsx + auth-modal.tsx)

- map-shell 挂载后(或 user fetch 后)读 `location.search` 的 `auth_error` 参数:有值 → 存 state,并把该参数从地址栏清掉(`history.replaceState` 去掉 query 中 `auth_error`,保留其余参数)。
- `AuthModal` 新增可选 prop `initialError?: string | null`:打开时若传入 → 显示在**现有** `styles.error` 行(复用现有元素,不做新视觉)。
- 映射表(zh/en 各加一个 i18n key,`authOauthError` 通用 + 可选细分):`oauth_state_invalid` → 登录已过期,请重试;`oauth_provider_error` → 第三方登录失败,请重试。
- 打开 modal 的入口(如 profile 点击)如果已带 initialError,直接打开 modal 显示错误。不要引入 toast / banner 等任何新 UI 元素。

### 3. 不需要做的

- 不改 modal 布局/视觉/动画;不改按钮 DOM 结构(SOCIAL 列表、图标、文案不变)。
- 不动 CSS,除非 typecheck/lint 要求(新增 prop 不需要样式)。
- 不动后端路由、lib/oauth、tech/*、.env.example。

## 文件边界

- 修改:`server/src/components/auth-modal.tsx`、`server/src/components/map-shell.tsx`、`server/src/lib/i18n.ts`(新增 key)
- **不碰**:`auth-modal.module.css`(除非必须,如不存在则跳过)、其他组件、后端一切、`tech/*`

## 测试要求

- 跑全量 `npm test`(auth-modal 是客户端组件,主要靠既有契约测试 + typecheck 守护;若 `component-contracts.test.mjs` 断言 modal 行为,保持兼容)。
- 若测试套件里有对 `social()` 或 modal props 的契约断言,相应更新并保持契约一致。

## 门禁(全部通过才算 DONE)

```bash
cd /Users/acccan/dm-wt-oauth-frontend/server && npm test
cd /Users/acccan/dm-wt-oauth-frontend/server && npm run typecheck
cd /Users/acccan/domain-map && make docs-check
git diff --check   # worktree 内
```

## 提交

小步 Conventional Commits(`feat(auth): providers probe in auth modal` / `feat(auth): redirect to oauth start when configured` / `fix(auth): auth_error surface in modal`)。

## 回报(末两行必须精确)

写到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-oauth-login/reports/ws-frontend.md`,含:改动摘要、行为矩阵(configured/未配置/错误三路径)、i18n 新增 key 清单、遇到的问题、门禁输出摘要。末两行:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话>
```
