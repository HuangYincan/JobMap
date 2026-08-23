# WS: ws-frontend — Profile 密码/手机/邮箱管理 UI + 登录卡片邮箱+密码

你是 headless 开发 worker。工作目录是**你的 worktree**:`/Users/acccan/dm-wt-ps-frontend`(已预建,分支 `feature/account-security-frontend`,从 dev 切出)。代码在 `server/src/`。**worktree 已预建,boss 统一合并;你绝不 merge / push / 建分支。** 完成后写汇报到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-profile-security/reports/ws-frontend.md`(末两行 token)。

## 背景

平台认证现状:OTP 验证码登录(邮箱/手机)、OAuth、username+password。Profile 面板(account-panel.tsx)里
「密码与安全」「手机与邮箱」两行是占位(`showDemo()`)。登录弹窗(auth-modal.tsx)password tab 只认 username。
后端(ws-backend,并行开发)将提供:`POST /api/auth/me/password`、`me/phone`、`me/email`、password/login 支持邮箱、
user JSON 增 `hasPassword`。**本 WS 做前端 UI,i18n key 由你独占新增(ws-backend / ws-docs 不碰 i18n.ts)。**

## 关键现状(已探明)

- `server/src/components/account-panel.tsx` — `ProfilePanel` 单层扁平 aside。占位行:
  - 「密码与安全」`:587-591` `onClick={showDemo}`;「手机与邮箱」`:593-597` 同上;`showDemo` `:351`(toast 提示 demo)。
  - 可复用交互先例:「编辑资料」行内展开 `editing` state `:228`、`toggleEdit` `:346-349`、展开面板 `:559-585`。
  - user 来自 props(`user`),`GET /api/auth/me` 的数据由 map-shell 拉取后传入;登录后 map-shell `refreshAccount()`。
  - i18n 已有 key:`passwordSecurity`(i18n.ts:910)、`phoneEmail`(:914)、`accountImmutable`(:898)。
- `server/src/components/auth-modal.tsx` — 4 tab(phone/email/password/other,:17);password tab 登录表单
  `:357-399`(username 输入 `:357-365`、密码 `:366-375`、登录按钮 `:387-399`)、注册模式 `:376-386`(确认密码)、
  登录/注册切换 `:400-414`;`POST /api/auth/password/login` `:251-254`(`{ username, password }`)。
- 样式:account-panel.module.css(`.row` 46px + `.rowIcon` 蓝 + `.rowChevron`;`.group`/`.card`/`.groupLabel`;
  `--soft-strong` 面板底、`#007aff` 主色、12px 小字 `--blue-ink #0062CC`);auth-modal.module.css(liquid glass 卡片)。

## 设计系统约束(严格遵守)

- 面板 chrome 保持 `--soft-strong` frost;玻璃(blur+saturate+inset)只用于卡片/浮层;**不要**给面板本体再降透明度。
- 主按钮/交互一律 `#007AFF`(12px 小字用 `--blue-ink`)。绿仅薪资/工时/登录按钮/保存资料等既有语义处;
  **本任务新增按钮用蓝,不用绿**(登录卡片主按钮「登录」保持现有绿,不动)。
- 新增 UI 须符合 Apple 风格:46px 行高、12px uppercase groupLabel、cubic-bezier(0.32,0.72,0,1) 动效、
  暗色模式(prefers-color-scheme)完整、WCAG AA 对比、焦点可见。
- 不动 4-tab 结构与其余 tab 样式。

## 布局图(已获 boss 批准,照此实现)

### A. Profile「密码与安全」子面板(点击原占位行进入,行内视图切换,不新建面板)

```
┌─────────────────────────────┐
│ ‹ 返回        密码与安全      │  ← 子面板头:返回钮(chevronLeft)+标题,复用 row 样式
├─────────────────────────────┤
│ 登录密码                      │  ← groupLabel
│ 状态行:                      │
│   ● 未设置 → 提示「使用绑定的  │
│     手机或邮箱验证码设置密码」  │
│   ● 已设置 → 显示「已设置」    │
│ 身份验证(按 hasPassword):    │
│  [已有密码] 旧密码  ┌──────┐ │
│  [无密码]   验证码  ┌──────┐ │  ← 发送验证码按钮(发到已绑定 email/phone)
│ 新密码        ┌──────────┐ │
│              │ ≥8 位     │ │
│ 确认新密码    ┌──────────┐ │
│ [ 保存密码 ](蓝,主按钮)    │  ← 成功→toast「已保存」+ 返回;失败→行内错误红字
└─────────────────────────────┘
```

- 交互:子面板 = `view` state(`'main' | 'password' | 'contacts'`);返回 → `'main'`。
- 表单按 `user.hasPassword` 分支:true → 旧密码输入框;false → 验证码输入 + 发送按钮
  (调 `POST /api/auth/otp/send`,provider 取已绑定凭证:有 email 用 email,否则 phone;发送成功后 60s 倒计时复用 auth-modal 的模式,倒计时逻辑自实现)。
- 提交 `POST /api/auth/me/password` body:
  - 有密码:`{ oldPassword, newPassword }`;无密码:`{ otp: { provider, target: <绑定值>, code }, newPassword }`。
- 错误码映射:401 `WRONG_PASSWORD` → 「旧密码不正确」;401 `INVALID_CODE` → 「验证码错误或已过期」;
  401 `NOT_BOUND` → 「验证码发送目标与绑定凭证不一致」;400 `PASSWORD_TOO_SHORT` → 「密码至少 8 位」;409 等其余 → 通用错误行。
- 成功:toast(复用现有 toast 机制)+ 返回 main;user 刷新 → 调父组件传入的刷新回调(见下方「user 刷新」)。

### B. Profile「手机与邮箱」子面板

```
┌─────────────────────────────┐
│ ‹ 返回        手机与邮箱      │
├─────────────────────────────┤
│ 手机号        groupLabel     │
│ ┌─────────────────────────┐ │
│ │ 138****5678  或  未绑定   │ │  ← 脱敏展示(首 3 尾 4,长度<7 全显尾 2)
│ │ [ 更换手机 ]              │ │  ← 展开更换表单(默认收起)
│ └─────────────────────────┘ │
│ 更换表单(展开时,复用 A 的样式):│
│   新手机号 ┌────────────┐   │
│   验证码   ┌────────────┐ +发送│  ← 发到新手机(otp/send provider=phone)
│ [ 确认更换 ](蓝)         │   │  → POST /api/auth/me/phone { phone, code }
│ ──────────────────────────  │  ← 分隔线(row + .row::after 模式)
│ 邮箱          groupLabel     │
│ ┌─────────────────────────┐ │
│ │ user@example.com 未绑定  │ │
│ │ [ 更换邮箱 ]              │ │
│ └─────────────────────────┘ │
│ 更换表单(同上,otp/send provider=email)│
│   → POST /api/auth/me/email { email, code } │
└─────────────────────────────┘
```

- 两条(手机/邮箱)各自独立展开 state;冲突码:409 `PHONE_TAKEN`/`EMAIL_TAKEN` → 「该手机号/邮箱已被绑定」;
  401 `INVALID_CODE` → 「验证码错误或已过期」。
- 成功:toast + 折叠表单 + 更新展示值(父组件刷新 user)。

### C. AuthModal password tab — 邮箱或用户名登录(修改现有 UI,已授权,改动克制)

```
现状 password tab:                 目标:
│ 用户名 ┌──────────────┐          │ 邮箱或用户名 ┌──────────────┐
│ 密码   ┌──────────────┐          │ 密码   ┌──────────────┐
│ [ 登录 ](绿,不动)       │          │ [ 登录 ](绿,不动)       │
│ 没有账号? 注册          │          │ 没有账号? 注册(用户名)   │
│                          │          │ (登录模式仅)辅助提示行:  │
│                          │          │ 「邮箱注册的账号,可在    │
│                          │          │  个人资料设置密码后登录」 │
```

- 登录模式:输入框 label/placeholder 由「用户名」→「邮箱或用户名」(zh)/「Email or username」(en);
  提交 body 保持 `{ username, password }`(后端接受邮箱,ws-backend 已处理)。
- 注册模式:保持「用户名」语义(placeholder 仍为用户名,label「用户名」);切换文案不变。
- 辅助提示行:登录模式下显示一行 12px `--blue-ink` 提示(见上图),注册模式隐藏;位置在登录/注册切换行下方。
- 其余(发送验证码、tab 切换、错误行、OAuth 按钮)**一律不动**。

### D. user 刷新

- account-panel 的 user 是 props;换绑/设密成功后需要刷新。找 map-shell 传给 ProfilePanel 的刷新途径
  (如 `onUserUpdated` / `refreshAccount` 回调 props;若无,新增一个最小回调 prop `onUserChanged?: () => void`,
  map-shell 传 `refreshAccount` 的包装)。改动克制,不重构既有数据流。
- auth-modal 登录成功后现有流程已刷新 user,无需改。

## 任务清单(全部在 worktree 内)

1. account-panel.tsx:占位行接入真实子面板(view state + 两个子面板 + 表单 + OTP 发送/倒计时 + 错误映射 + toast + 成功刷新)。
2. account-panel.module.css:子面板所需新样式(返回头、表单行、字段、发送钮、错误行;遵循既有 token)。
3. auth-modal.tsx + auth-modal.module.css:password tab 登录模式 label/placeholder + 辅助提示行(克制改动)。
4. i18n.ts:新增全部 key(zh + en 成对):如
   `securityBack`(返回)/`setPassword`/`changePassword`/`passwordSaved`/`oldPassword`/`newPassword`/`confirmPassword`/
   `verifyCode`/`sendCode`/`resendIn`(n 秒后重发)/`notSetYet`/`set`(已设置)/`changePhone`/`changeEmail`/
   `phoneEmailSaved`/`unbound`(未绑定)/`loginIdOrEmail`(邮箱或用户名)/`pwdLoginHint`(辅助提示)/`wrongPassword`/
   `codeInvalid`/`codeTargetMismatch`/`passwordTooShort`/`takenPhone`/`takenEmail` 等——按你实际 UI 文案定,风格对齐 i18n.ts 既有 key(中文 zh 在 zh 对象,英文 en)。
5. 检查手机/邮箱脱敏:写一个小组件或 util(长度 ≥7 → 前 3 后 4 脱敏;否则尾 2)放组件内即可,不新建 lib 文件。

## 文件边界
拥有:`server/src/components/account-panel.tsx`、`account-panel.module.css`、`server/src/components/auth-modal.tsx`、
`auth-modal.module.css`、`server/src/lib/i18n.ts`。
**不碰**:后端路由与 account-store、otp/send 与 oauth 路由、map-shell.tsx 中除「给 ProfilePanel 传刷新回调」之外的部分、
任何 `tech/*` 文档、.env*、测试文件(如现有组件测试需要为新增文案补断言,可小改既有测试)。

## 门禁(必须在 worktree 内跑,全部通过才算 OK)
```bash
cd /Users/acccan/dm-wt-ps-frontend/server && npm test
cd /Users/acccan/dm-wt-ps-frontend/server && npm run typecheck
cd /Users/acccan/domain-map && make docs-check   # 主树跑
git diff --check
```
后端 API 可能尚未合并进你的分支——**前端实现按契约文档写死**(见下),不要因后端未到位而 BLOCKED;
若 `npm test` 中有依赖后端行为的端到端测试因后端缺失而红,在「遇到的问题」里说明并区分(前端本地单测应通过)。
不要跑 `npm install` / `npm ci`(deny)。

## 共享契约(与 ws-backend 对齐,禁止漂移)
- `POST /api/auth/password/login` body `{ username, password }` — username 接受邮箱或用户名;失败 401 `INVALID_CREDENTIALS`。
- `POST /api/auth/me/password` body `{ oldPassword?, otp?: { provider:'email'|'phone', target, code }, newPassword }`;
  有密码 → oldPassword;无密码 → otp(provider/target 必须是已绑定凭证);新密码 ≥8 位。
  错误码:401 `WRONG_PASSWORD` / `INVALID_CODE` / `NOT_BOUND` / `UNAUTHORIZED`;400 `PASSWORD_TOO_SHORT`。成功 200 `{ ok:true, user }`。
- `POST /api/auth/me/phone` body `{ phone, code }`;`POST /api/auth/me/email` body `{ email, code }`;
  409 `PHONE_TAKEN` / `EMAIL_TAKEN`;401 `INVALID_CODE` / `UNAUTHORIZED`;成功 200 `{ ok:true, user }`。
- user JSON 有 `hasPassword: boolean`(前端据此分支设置/修改)。
- OTP 发送复用 `POST /api/auth/otp/send`(provider=phone|email,target);响应含 `expiresAt`、`retryAfterMs`(60s 冷却对齐)。

## 提交
- Conventional Commits,频繁小步(`feat(profile): ...` / `feat(auth): ...` / `i18n(...)`)。只 commit 你拥有的文件。
- 门禁全绿后写汇报。

## 汇报
写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-profile-security/reports/ws-frontend.md`:
- 做了什么(子面板 A/B/C 各一段,含 file:line)、新增 i18n key 清单
- 遇到的问题(重要:冲突/取舍/实现难点,一句话一个)
- 门禁结果(测试数、typecheck、docs-check、diff-check)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
