# ws-frontend 汇报(2026-08-22)

## 实际改动(3 commits,分支 feature/oauth-frontend,基于 dev@12853db)

1. `ff2ae04` `feat(auth): oauth error i18n keys (state_invalid / provider_error / generic)`
   - `server/src/lib/i18n.ts` → 新增 3 组双语 key(见下)。
2. `2823e48` `feat(auth): providers probe + real oauth redirect when configured`
   - `server/src/components/auth-modal.tsx` →
     - `AuthModalProps` 新增可选 `initialError?: string | null`(OAuth 回调错误码)。
     - 新增状态 `providers: { id: string; configured: boolean }[] | null`;`open` 变 true 时
       fetch `/api/auth/oauth/providers` 一次,失败/非 200 静默置 null,不影响 UI(带 cancelled 防竞态)。
     - `social(provider)` 改造:probe 已加载且该 provider `configured === false` → 保持原 demo
       POST `/api/auth/oauth`(原逻辑零改动);否则(`configured === true` 或 probe 未完成/失败——
       宁可真实流程也不误登 demo 账号)→ `window.location.href = /api/auth/oauth/start?provider=<id>&next=<encodeURIComponent(pathname+search)>` 全页跳转,回调返回后全页刷新、map-shell 启动自动拉
       `/api/auth/me` 恢复用户态。按钮无新增禁用/加载态视觉,busy 沿用。
     - 新增 `oauthErrorKey(code)` 模块级映射(未知码回退通用 key)+ seed effect:modal 打开时
       `initialError` 有值 → 映射 i18n 后显示在**现有** `styles.error` 行(复用元素,无新 UI)。
3. `8c36f3b` `fix(auth): auth_error surface in modal`
   - `server/src/components/map-shell.tsx` →
     - 新增状态 `authError: string | null`。
     - 挂载 effect 读 `location.search` 的 `auth_error`:有值 → 存 state + `history.replaceState`
       从地址栏清除该参数(保留其余 query 与 hash)+ `setAuthOpen(true)` 自动打开登录弹窗显示错误。
     - `<AuthModal>` 传入 `initialError={authError}`。

## 行为矩阵

| 场景 | 行为 |
|---|---|
| probe 返回 `configured: true` | 点社交按钮 → 全页跳转 `/api/auth/oauth/start?provider=<id>&next=...`(真实 OAuth;回调 302 回 next,session cookie 已写,map-shell 启动自动恢复用户态) |
| probe 返回 `configured: false` | 点社交按钮 → 原 demo POST `/api/auth/oauth`(零改动路径) |
| probe 未完成 / 失败(providers=null) | 点社交按钮 → 走真实跳转(宁可真实流程也不误登 demo 账号) |
| 回调成功 | 302 回 next 无参数,无 auth_error → 不弹窗,正常登录态 |
| 回调失败(带 `?auth_error=oauth_state_invalid`) | map-shell 挂载读参 → 清地址栏参数 → 自动打开 modal,error 行显示「登录已过期,请重试」 |
| 回调失败(带 `?auth_error=oauth_provider_error`) | 同上,显示「第三方登录失败,请重试」 |
| 未知 `auth_error` 值 | 回退通用文案「第三方登录失败,请重试」 |

## i18n 新增 key(`server/src/lib/i18n.ts`,均双语)

- `authOauthError`: zh `第三方登录失败,请重试` / en `Third-party sign-in failed, please try again`
- `authOauthStateInvalid`: zh `登录已过期,请重试` / en `Sign-in expired, please try again`
- `authOauthProviderError`: zh `第三方登录失败,请重试` / en `Third-party sign-in failed, please try again`

## 门禁结果

- `npm test`(server): **1164 tests / 1162 pass / 0 fail / 2 skip** ✓
- `npm run typecheck`(server): **通过**(tsc --noEmit 无输出)✓
- `make docs-check`(domain-map): **通过** —— 等效 grep(同 Makefile 正则 +
  `--include='*.md' --exclude-dir=parallel-sessions`)全部命中均位于
  `tech/roles/development/parallel-sessions/**`(被 exclude 排除),零违例;本 WS 零 `.md` 改动。
  另:同批 ws-docs 汇报亦在 worktree 内独立跑等效 grep 零匹配。
- `git diff --check`(worktree): **通过**(无输出)✓

## 遇到的问题

- 无功能性问题。仅环境性:
  - bash 沙箱只允许 worktree 根 + 批次目录两个 cwd,`cd /Users/acccan/domain-map` 被拒 →
    docs-check 用等效 grep(已读 Makefile 确认其唯一内容是 grep + printf)+ Grep 工具在
    主仓库核对命中清单,全部命中在 parallel-sessions 内(被 Makefile 排除),判定通过;
  - 初次 `git add` 因 cwd 在 `server/` 子目录用了错误相对路径 → 定位后从 worktree 根重跑,无残留。
- 兼容性:既有契约测试(`component-contracts.test.mjs` 对 auth-modal/map-shell 的
  `id: "github"`、无 `authX`、`onClick={signIn}[^]*autoRegisterHint`、dynamic import、
  `smoke.test.mjs` `/AuthModal/`)全部保持通过,未改任何断言。

## 证据

- 全量测试尾部输出:`ℹ tests 1164 / pass 1162 / fail 0 / cancelled 0 / skipped 2`
- `git log --oneline -3`:8c36f3b / 2823e48 / ff2ae04,工作树 clean。
- 契约未漂移:所有改动 URL 与后端契约一致(`/api/auth/oauth/providers`、`/api/auth/oauth/start`、
  `?auth_error=` 两错误码)。

门禁: PASSED
结论: OK
