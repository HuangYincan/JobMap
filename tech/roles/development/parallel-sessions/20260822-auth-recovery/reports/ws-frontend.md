# ws-frontend 汇报(2026-08-22)

## 实际改动(worktree `/Users/acccan/dm-wt-ar-frontend`,分支 `feature/auth-recovery`,4 commits)

### A. 注册后绑定引导(auth-modal.tsx + auth-modal.module.css)
- `server/src/components/auth-modal.tsx:85-90` 新增绑定引导 state:`bindGuide`/`bindTarget`("phone"|"email"|null)/`bindValue`/`bindCode`/`bindSent`/`bindResendIn`(独立于 OTP tab state,避免串扰)。
- `:104-118`(close 重置 effect)追加绑定引导 state 重置;`:131-136` 新增 bindResendIn 60s 倒计时 effect(与 resendIn 同模式)。
- `passwordRegister` 成功路径 `:317-320`:`onSignedIn(); setBindGuide(true);`(原 `onClose()` 移除,弹窗不关闭;登录态已建立)。OTP/OAuth 登录成功路径保持原样(不弹引导)。
- `:328-347` `bindSendCode`:`POST /api/auth/otp/send { provider: bindTarget, target }`,成功复用 `sendCodeSuccess`/`sendCodeSuccessEmail` 顶部气泡 + 60s 冷却。
- `:351-374` `bindNow`:`POST /api/auth/me/phone|email { phone|email, code }`;成功 `setNotice(bindSuccess)` + `setTimeout(onClose, 700)`(短 toast 后关弹窗);失败错误码映射 `:262-272` `bindErrorKey`(与 account-panel `contactErrorKey` 同表):`PHONE_TAKEN`→takenPhone、`EMAIL_TAKEN`→takenEmail、`INVALID_CODE`→codeInvalid、其余 securityFailed。
- `:408-485` 绑定引导 JSX(弹窗 form 区域顶层条件分支):`bindTitle`(welcomeBindTitle,沿用 `titleId` 保证 dialog aria-labelledby)+ `bindHint` + 手机/邮箱二选一选择卡(`role="group" aria-label={targetLabel}`,选中 `bindCardActive` 高亮 #007AFF)+ 表单(目标输入 + 发送验证码文字钮 + 验证码输入 + 蓝色主按钮 bindDone)+ 跳过按钮(→ onClose);错误行复用现有 `styles.error`。✕ 关闭沿用卡片既有 close 按钮。
- `auth-modal.module.css` 新增 `.bindGuide/.bindTitle/.bindHint/.bindCards/.bindCard(+Active)/.bindDone/.skipBind`(遵循既有 token;主按钮 `var(--blue, #007AFF)`;选择卡 min-height 46px;绑定输入复用既有 `.field/.inputShell/.inlineSend`),dark 模式选择器补 `.bindCard`。

### B. 忘记密码入口(password tab 登录模式)
- `server/src/components/auth-modal.tsx:536-552` 密码输入框与「登录」按钮之间新增 `forgotLink`(仅 `pwdMode === "login"`);点击:`setTab("email")` + 按 tab 切换既有逻辑清 error/sent/resendIn/code + `resetPasswordForm()` + `setNotice(forgotHint)`(顶部气泡提示「验证码登录后,可在 个人资料 → 密码与安全 中重设密码」)。password tab 其余结构零改动。
- `auth-modal.module.css` 新增 `.forgotLink`:`var(--blue-ink, #0062cc)` 12px 文字链接,`min-height: 44px` 满足可点击区 ≥44px,`align-self: flex-start` 左对齐(与布局图一致)。

### i18n 新增 key(server/src/lib/i18n.ts:647-689,zh/en 成对,10 个)
`welcomeBindTitle` / `bindGuideHint` / `bindPhone` / `bindEmail` / `targetLabel` / `bindDone` / `skipBind` / `bindSuccess` / `forgotPassword` / `forgotHint`。
复用未新增:`sendCode` / `verifyCode` / `resendCode` / `resendInSeconds` / `sendCodeSuccess(Email)` / `phoneNumber` / `emailAddress` / `phonePlaceholder` / `emailPlaceholder` / `otpCodePlaceholder` / `takenPhone` / `takenEmail` / `codeInvalid` / `securityFailed`。

### 文档
- `tech/28-account-security.md:112-116` 新增 `### 5.1 忘记密码恢复`(3 条):验证码登录是唯一密码找回通道(忘记密码入口 → email tab 验证码登录 → 个人资料重设密码);username 注册引导绑定(可跳过)保证新账号默认有备用凭证;死锁边界(无任何凭证时无恢复通道,业界同)。仅新增小节,其余未动。

## 门禁结果
- npm test:`cd server && npm test` → **1429 tests,1427 pass / 2 skip / 0 fail**(与基线 1427 pass 完全一致,无回归;component-contracts 对 auth-modal 的正则契约如 `autoRegisterHint` 距 `tab === "password"` >800 字符仍满足)
- typecheck:`npm run typecheck` → **通过**(tsc --noEmit,0 错误)
- docs-check:`make docs-check` 等价 grep 在 worktree 全量跑 → **通过**(无 drift 模式;主树 `/Users/acccan/domain-map` 被沙箱拦截无法 cd/grep,worktree 即同仓库全量 checkout,已等价覆盖,见问题段)
- git diff --check:`git diff --check HEAD~4` → **通过**(exit 0)

## 遇到的问题
- 主树 `make docs-check` 沙箱拦截(cd / grep 主树均被拒)→ 以 worktree 全量等价 grep 验证(同一仓库 checkout,tech/28 变更即在此),结果通过;合并时建议在 dev 侧再跑一次确认。
- `bindNow` 成功需「短 toast 后关闭」,但 topToast 渲染在 AuthModal 内部、`open=false` 即 unmount → 用 `setTimeout(onClose, 700)` 让 toast 可见约 0.7s 再关(幂等,重复点击/提前 ✕ 无副作用)。
- 绑定表单独立 state(bindValue/bindCode/bindSent/bindResendIn)而非复用 OTP tab 的 target/code/sent/resendIn:避免「先访问 email tab 留痕 → 注册 → 引导表单串值」的脏状态,close 时统一重置。
- 忘记密码链接「可点击区 ≥44px」与紧凑布局冲突 → 链接本体 min-height 44px(文字垂直居中),牺牲少量纵向留白换取合规点击区,严格按布局图置于密码框与登录按钮之间。

## 证据
- 4 commits:`13c02a5`(i18n)/ `42c4802`(绑定引导)/ `cd3a156`(忘记密码入口)/ `d702761`(tech/28),仅拥有文件 4 个,+330/-2;工作树干净,无未提交改动。
- 测试输出摘要:ℹ tests 1429 / pass 1427 / fail 0 / skipped 2 / duration 21.9s。

门禁: PASSED
结论: OK
