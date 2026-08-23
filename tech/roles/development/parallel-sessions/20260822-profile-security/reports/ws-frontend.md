# ws-frontend 汇报(2026-08-22)

分支 `feature/account-security-frontend`(worktree `/Users/acccan/dm-wt-ps-frontend`),4 commits。

## 实际改动

### A. Profile「密码与安全」子面板(account-panel.tsx)
- `:271` 新增 `view` state(`'main' | 'password' | 'contacts'`);「密码与安全」占位行 `:1006` 由 `showDemo()` 改为 `setView("password")`。
- 子面板 = 行内视图切换(不新建面板):`renderSubHeader` `:696`(返回钮 chevronLeft + 标题 + 保留原关闭钮,embedded 抽屉随时可退)、`renderPasswordSecurity` `:723`。
- 状态行:蓝色 ● 圆点 + 「已设置/未设置」(`passwordSet`/`passwordNotSet`);无密码时提示「使用绑定的手机或邮箱验证码设置密码」(`setPasswordHint`);email/phone 皆未绑定 → 提示先绑定(`noBoundContact`)。
- 身份验证按 `hasPassword` 分支(`:298`,按契约读 `user.hasPassword`,类型未合并前用 `AccountUser & { hasPassword?: boolean }` 可选读,缺省视为无密码):
  - 有密码 → 旧密码输入;无密码 → 验证码输入 + 发送按钮(OTP 发到已绑定凭证:有 email 用 email,否则 phone)。
- 表单:新密码(≥8 位提示 `passwordTooShort`)+ 确认新密码 + 「保存密码」蓝主按钮(复用 `.saveBtn`)。
- 提交 `POST /api/auth/me/password`(`savePassword` `:457`):有密码 body `{ oldPassword, newPassword }`;无密码 `{ otp: { provider, target, code }, newPassword }`(按共享契约写死,不依赖后端先合并)。
- 错误映射 `passwordErrorKey`(组件内):401 `WRONG_PASSWORD`→「旧密码不正确」/ `INVALID_CODE`→「验证码错误或已过期」/ `NOT_BOUND`→「验证码发送目标与绑定凭证不一致」/ 400 `PASSWORD_TOO_SHORT`→「密码至少 8 位」/ 其余→通用「操作失败,请重试」。
- 成功:toast「密码已保存」+ 返回 main + `onUserChanged?.()` 刷新 user。

### B. Profile「手机与邮箱」子面板(account-panel.tsx)
- 占位行 `:1012` 改为 `setView("contacts")`;`renderPhoneEmail` `:878` + 共享块渲染器 `renderContactBlock` `:803`(手机/邮箱各一块,独立展开 state)。
- 脱敏展示 `maskContact` `:91`:手机整串前 3 后 4(`138****5678`);邮箱只遮 @ 前本地部分(保留域名便于辨认);长度 <7 只显尾 2;未绑定 → 「未绑定」(`unbound`)。
- 更换表单:新手机号/新邮箱 + 验证码(发到新凭证,`sendOtp` 复用 `POST /api/auth/otp/send`)→ `POST /api/auth/me/phone` / `me/email`(`submitPhone` `:494` / `submitEmail` `:519`),body 按契约 `{ phone, code }` / `{ email, code }`。
- 冲突映射 `contactErrorKey`:409 `PHONE_TAKEN`/`EMAIL_TAKEN` → 「该手机号/邮箱已被绑定」;401 `INVALID_CODE` → 「验证码错误或已过期」;其余通用错误。
- 成功:toast「已保存」+ 折叠表单 + 清空输入 + `onUserChanged?.()` 刷新 user。两区块间 `.secDivider`(与 `.row + .row::after` 同视觉)。

### C. AuthModal password tab(auth-modal.tsx)
- 登录模式 label/placeholder「用户名」→「邮箱或用户名」(`loginIdOrEmail`,`:358`/`:364`);注册模式保持「用户名」语义(`usernameLabel`/`usernamePlaceholder`)。提交 body 仍 `{ username, password }`(后端接受邮箱)。
- 登录/注册切换行下方新增辅助提示行 `.pwdLoginHint`(`:415`,仅登录模式,12px `--blue-ink`):「邮箱注册的账号,可在个人资料设置密码后登录」。
- 4-tab 结构、其余 tab、错误行、OAuth 按钮零改动;测试契约(password 分支 800 字符内不得出现 autoRegisterHint)仍满足。

### D. user 刷新
- `ProfilePanelProps` 新增最小回调 `onUserChanged?: () => void`(account-panel.tsx `:40`);map-shell.tsx 桌面(`:2463`)+ 移动 embedded(`:2754`)各传 `onUserChanged={() => void refreshAccount()}`,不改既有数据流。auth-modal 登录后现有流程已刷新,未动。

### i18n(server/src/lib/i18n.ts,zh+en 成对,单 worker 独占)
`securityBack`、`loginPassword`、`passwordSet`、`passwordNotSet`、`setPasswordHint`、`noBoundContact`、`setPassword`、`changePassword`、`passwordSaved`、`oldPassword`、`newPassword`、`confirmNewPassword`、`verifyCode`、`savePassword`、`wrongPassword`、`codeInvalid`、`codeTargetMismatch`、`securityFailed`、`changePhone`、`changeEmail`、`newPhone`、`newEmail`、`confirmChange`、`phoneEmailSaved`、`unbound`、`takenPhone`、`takenEmail`、`loginIdOrEmail`、`pwdLoginHint`(复用既有 `sendCode`/`resendCode`/`resendInSeconds`/`passwordTooShort`/`passwordMismatch`/`sendCodeSuccess`/`phoneNumber`/`emailAddress`)。

### 样式(account-panel.module.css)
`.subHeader`/`.backBtn`/`.subTitle`、`.secPanel`(与 `.editPanel` 同语义)、`.secStatusRow`/`.secStatusDot`/`.secStatusText`、`.secHint`、`.secField`(含 input:focus 蓝边)、`.secInputShell`/`.secSend`、`.secFieldHint`、`.secError`、`.secBlock`/`.contactRow`/`.contactAction`、`.secDivider`;暗色模式 media query 覆盖新 input/按钮面;面板 chrome 保持 `--soft-strong` 不动。auth-modal.module.css 新增 `.pwdLoginHint`。

## 门禁结果
- npm test:**1269 tests / 1267 pass / 0 fail / 2 skip**(worktree 内,`server/`)
- typecheck:`tsc --noEmit` 通过(worktree 内)
- docs-check:主树 sandbox 禁止 cd 到 `/Users/acccan/domain-map`,改为在 worktree 同一 dev 提交内容上跑 Makefile 等价 grep(`docs/roles/|docs/zh-cn/|预计发布时间.*2026-02-10|BOSS.*MVP.*爬|小红书.*MVP.*爬`,排除 parallel-sessions)→ 零命中 = 通过;本 WS 未改任何 `.md`,主树结果一致
- git diff --check:通过(无空白错误)

## 遇到的问题
- `AccountUser` 类型无 `hasPassword`(ws-backend 拥有 account.ts,按边界不碰)→ 组件内 `AccountUser & { hasPassword?: boolean }` 局部交叉读,缺省 false;后端合并后自动生效。
- 主树 `make docs-check` 被 sandbox 拦(cd 权限)→ 已在 worktree 等价复现检查并注明(见门禁结果)。
- 邮箱脱敏:整串前 3 后 4 会遮掉域名、不便辨认 → 只遮 @ 前本地部分,手机整串照契约;布局图邮箱显示完整邮箱为示意,报告此取舍。
- 子面板头在布局示意(返回+标题)基础上保留原关闭钮:embedded 抽屉需随时可退,不改既有 chrome 语义。
- 无密码且 email/phone 皆未绑定的边缘账号(纯 OAuth 无邮箱)→ 发送钮禁用 + 提示先绑定(`noBoundContact`),后端 NOT_BOUND 码仍有兜底映射。
- 后端 me/password、me/phone、me/email 路由尚未合入本分支 → 前端按共享契约写死,`npm test` 全部通过(无依赖后端行为的端到端测试因后端缺失而红)。

## 证据
- `npm test` 摘要:ℹ tests 1269 / pass 1267 / fail 0 / skipped 2(6673ms)
- `npm run typecheck`:exit 0
- docs-check 等价 grep:exit 1(grep 零命中,`! grep` 即通过)
- `git diff --check` + `git show --check`:无输出
- commits:`440c476`(i18n)、`10489b0`(子面板)、`600df4f`(auth-modal)、`164853e`(map-shell 接线)

门禁: PASSED
结论: OK
