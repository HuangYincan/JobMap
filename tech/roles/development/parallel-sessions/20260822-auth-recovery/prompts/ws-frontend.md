# WS: ws-frontend — 注册引导绑定 + 忘记密码入口

你是 headless 开发 worker。工作目录是**你的 worktree**:`/Users/acccan/dm-wt-ar-frontend`(已预建,分支 `feature/auth-recovery`,从 dev 切出)。代码在 `server/src/`。**worktree 已预建,boss 统一合并;你绝不 merge / push / 建分支。** 完成后写汇报到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-auth-recovery/reports/ws-frontend.md`(末两行 token)。

## 背景

账号安全批次(20260822-profile-security)已合并:`POST /api/auth/me/password|phone|email`、user JSON `hasPassword`、
`password/login` 接受邮箱。**遗留缺口(用户确认根治)**:未绑定凭证的 username 用户忘密码后无法恢复
(OTP 验证码登录按 identity 匹配会新建账号,绑定需登录态)。本 WS:
1. **注册引导绑定**:password tab 注册成功后,弹窗内引导绑定手机或邮箱(OTP 验证,可跳过)→ 新账号必有备用凭证。
2. **登录卡片「忘记密码」入口**:password tab 登录模式加链接 → 切验证码登录 tab + 提示。

## 关键现状(已探明)

- `server/src/components/auth-modal.tsx`:
  - `passwordRegister`(约 :271-297):注册成功 `onSignedIn(); onClose();` — 插入引导 step 的挂点。
  - `passwordSignIn`(约 :243-270):登录成功同样 `onSignedIn(); onClose()`。
  - tab state `tab`(:72 默认 "phone");`pwdMode` "login"|"register";密码表单 :355-420(含辅助提示行 `pwdLoginHint`)。
  - OTP 发送已有实现(phone/email tab 的 sendOtp 模式,约 :165-169):`POST /api/auth/otp/send`,60s 倒计时 state。
  - `notice`(topToast)与 `setError`(错误行)机制已有。
- `server/src/components/account-panel.tsx` 的绑定实现(:493-545)可参考:sendCode → otp/send、提交 → me/phone|email、错误码映射。
- i18n:`server/src/lib/i18n.ts`(zh/en 成对)。

## 布局图(已获 boss 批准,照此实现)

### A. 注册后绑定引导(新 UI,弹窗内 step)

```
注册成功 → 弹窗不立即关闭,切换为绑定引导视图:
┌──────────────────────────────┐
│                    ✕(关闭)    │
│  🎉 {welcomeBindTitle}        │   ← 「注册成功,欢迎!」
│  {bindGuideHint}              │   ← 「建议绑定手机或邮箱:忘记密码时可用验证码找回」
│  ┌──────────────┬───────────┐ │
│  │ 📱 {bindPhone} │ ✉️ {bindEmail} │  ← 两张选择卡(46px+ 行,选中高亮 #007AFF 边框)
│  └──────────────┴───────────┘ │
│  选择后显示表单:               │
│  ┌──────────────────────────┐ │
│  │ {targetLabel}  ───────────┐│ │  ← 手机号/邮箱输入
│  │ [ {sendCode} ]  (文字钮)   ││ │
│  │ {verifyCode}  ───────────┐│ │  ← 验证码输入(发送后 60s 倒计时复用既有模式)
│  │ [ {bindDone} ] (蓝主按钮)  ││ │  ← 「完成绑定」
│  └──────────────────────────┘ │
│  [ {skipBind} ] (文字按钮)     │  ← 「跳过」
└──────────────────────────────┘
```

- 交互:注册成功 → `setBindGuide(true)`(不 onClose);选择卡 phone/email 二选一(`bindTarget` state);
  发送验证码 → `POST /api/auth/otp/send`(provider 按所选,target=输入值);「完成绑定」→
  `POST /api/auth/me/phone|email` `{ phone|email, code }` → 成功:短 toast(复用 notice/topToast)「绑定成功」→ `onClose()`;
  失败:错误行(409 PHONE_TAKEN/EMAIL_TAKEN → 「该手机号/邮箱已被绑定」;401 INVALID_CODE → 「验证码错误或已过期」;其余通用)。
  「跳过」/ 点 ✕ → `onClose()`。`onSignedIn()` 在注册成功时照常调用(登录态已在),绑定引导不影响。
- **注意**:注册成功即 `onSignedIn(); onClose();` 的现有流程改为 `onSignedIn(); setBindGuide(true);`(不关弹窗)。
  OAuth / OTP 登录成功路径**保持原样**(不弹绑定引导)。

### B. 忘记密码入口(password tab 登录模式,改现有 UI 已授权,克制)

```
现状(password tab 登录):           目标:
│  [ 登录 ](绿)                    │  {forgotPassword} ?          ← 12px --blue-ink 链接,登录按钮下方
│  没有账号? 注册                   │  [ 登录 ](绿)
│  (pwdLoginHint 辅助提示保留)      │  没有账号? 注册
│                                  │  (pwdLoginHint 保留)
```

- 链接位置:密码输入框与「登录」按钮之间(或按钮下方),样式 `--blue-ink` 12px,可点击区 ≥44px。
- 点击行为:`setTab("email")` + `setNotice(t("forgotHint", lang))` + 重置 password 表单(清 error/输入,照 tab 切换既有逻辑)。
- 提示文案(forgotHint):「验证码登录后,可在 个人资料 → 密码与安全 中重设密码」(zh)/en 对应。
- **只加链接与行为,不动 password tab 其余结构。**

## 任务清单(全部在 worktree 内)

1. auth-modal.tsx:A(绑定引导 step)+ B(忘记密码入口);注册成功流程改挂点。
2. auth-modal.module.css:绑定引导所需样式(选择卡、表单行;遵循既有 token,主按钮蓝 #007AFF)。
3. i18n.ts:新增 key(zh/en):`welcomeBindTitle`/`bindGuideHint`/`bindPhone`/`bindEmail`/`targetLabel`/
   `sendCode`(若已有复用)/`verifyCode`(若已有复用)/`bindDone`/`skipBind`/`bindSuccess`/`forgotPassword`/`forgotHint`
   /`takenPhone`/`takenEmail`(若已有复用)。已有 key 优先复用,不重复造。
4. tech/28-account-security.md:新增「忘记密码恢复」小节(2-4 行):验证码登录是恢复通道;
   username 注册引导绑定;死锁边界(无任何凭证时无恢复通道,业界同)。只加这一节,不动其它内容。

## 文件边界
拥有:`server/src/components/auth-modal.tsx`、`auth-modal.module.css`、`server/src/lib/i18n.ts`、
`tech/28-account-security.md`(仅新增小节)。
**不碰**:后端路由与 account-store、account-panel.tsx、map-shell.tsx、其它 tech/*、.env*、测试文件。

## 门禁(必须在 worktree 内跑,全部通过才算 OK)
```bash
cd /Users/acccan/dm-wt-ar-frontend/server && npm test
cd /Users/acccan/dm-wt-ar-frontend/server && npm run typecheck
cd /Users/acccan/domain-map && make docs-check   # 主树跑(若沙箱拦截 cd,以等价 grep 验证并在汇报注明)
git diff --check
```
不要跑 `npm install` / `npm ci`(deny)。

## 提交
- Conventional Commits,小步(`feat(auth): ...` / `i18n(...)` / `docs(account): ...`)。只 commit 你拥有的文件。

## 汇报
写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-auth-recovery/reports/ws-frontend.md`:
- 做了什么(A/B 各一段,含 file:line)、新增 i18n key 清单、tech/28 小节位置
- 遇到的问题(冲突/取舍/实现难点,一句话一个)
- 门禁结果(测试数、typecheck、docs-check、diff-check)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
