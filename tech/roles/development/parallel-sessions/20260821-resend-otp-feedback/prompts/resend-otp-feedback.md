# Workstream: resend-otp-feedback — 发送反馈 UI + 邮件打磨

## 背景

上一批(20260821-resend-otp,已合入 dev c97b349)接通了 Resend 邮箱验证码真发。本批补**发送成功反馈**与**邮件模板打磨**,纯前端 + 邮件模板,**后端零改动**。

## 布局图(已审定,按此实现)

```
A. OTP 发送按钮(auth-modal.tsx:363-370 inlineSend)
   现状:  [发送验证码]  → 成功后文字变 [重新发送],无其他反馈
   目标:
     发送前:  [发送验证码]            enabled(有 target 时)
     成功后:  [59 秒后再次发送]        disabled,60s 每秒递减
     归零后:  [重新发送]              enabled(sent 保持 true)

B. 消息气泡(页面顶部水平居中)
   现状: 发送成功零反馈
   目标: sendCode 成功 → fixed 药丸:
     top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
     z-index: 60(高于 modal overlay z-40)
     background: rgba(0, 122, 255, 0.1); border: 1px solid rgba(0, 122, 255, 0.28);
     color: var(--blue-ink); font-size: 13px; font-weight: 600; border-radius: 99px;
     padding: 10px 16px; box-shadow: var(--shadow); pointer-events: none; role="status"
     toastIn 动画 0.2s cubic-bezier(0.32, 0.72, 0, 1)(fade + translateY(-4px))
     prefers-reduced-motion 关闭动画
     2.6s 自动消失(setTimeout + cleanup,仿 account-panel.tsx:279-283)
     文案按 provider:email → "验证码已发送,请查收邮件";phone → "验证码已发送"

C. 验证码邮件 HTML(verification-email.ts)
   现状: #f2f3f5 底 + 白卡 420px(radius 12)+ 标题 18px + 引导 14px + code 块
         (36px #007aff, bg #f5f7fa, border #e5e7eb, radius 10)+ 有效期/防泄露行
   目标(润色,保持浅色 + 内联样式 table 布局,绝不用 <style> 标签):
     白卡顶部 4px #007AFF 圆角顶条 → "JobMap" 字标(600 16px #1c1c1e)
     → 1px #e5e7eb 分隔线 → 标题"登录验证码"(20px 700 #1c1c1e)
     → 引导"请在登录页面输入以下验证码:"(14px #6e6e73)
     → code 块增强: bg rgba(0,122,255,0.08), border rgba(0,122,255,0.25),
       radius 12, padding 20px, 36px 700 #007aff letter-spacing 8px,
       块内小标签"6 位验证码"(12px #007aff, 块顶对齐或居中)
     → 有效期行加粗关键数字:"验证码 {时间} 前有效(10 分钟)"(13px #6e6e73,
       时间部分 font-weight 600)
     → "请勿泄露给他人。若非本人操作,请忽略本邮件。"(13px #8e8e93)
     → 分隔线 + footer"本邮件由系统自动发送,请勿直接回复。"(12px #8e8e93 居中)
   纯文本 fallback 同步润色(标题【JobMap登录验证码】,行结构同 html 事实)
```

## 任务(按序)

### 1. i18n keys — `server/src/lib/i18n.ts`
在 OTP keys 区(约 570-593,`sendCode`/`resendCode` 附近)新增(as const 对象,key 自动入类型):
```ts
resendInSeconds: { zh: '{s} 秒后再次发送', en: 'Resend in {s}s' },   // 手动插值,仿 agentWelcome 先例
sendCodeSuccessEmail: { zh: '验证码已发送,请查收邮件', en: 'Code sent, check your inbox' },
sendCodeSuccess: { zh: '验证码已发送', en: 'Code sent' },
```
注意 `translations` 对象结构是 `key: { zh, en }`(先确认实际结构再写)。

### 2. 倒计时 — `server/src/components/auth-modal.tsx`
- 新增命名常量(模块顶部):`const RESEND_COOLDOWN_SECONDS = 60;`(与后端 otpRateConfig.cooldownMs=60s 对齐,禁 magic number)
- 新 state:`const [resendIn, setResendIn] = useState(0);`(0 = 无倒计时)
- `sendCode` 成功分支(约 110 行 `setSent(true)` 处):`setSent(true); setResendIn(RESEND_COOLDOWN_SECONDS);` + 触发气泡(见任务 3)
- 倒计时 effect(useEffect + setInterval 1s,cleanup 必写;`resendIn > 0` 时递减,到 0 停):
  ```ts
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((v) => (v > 1 ? v - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [resendIn > 0]);
  ```
- reset 与 `sent` 同步:modal close 分支(约 90 行)与 tab 切换分支(约 258 行)的 `setSent(false)` 旁加 `setResendIn(0)`
- 按钮(363-370):
  ```tsx
  const resendDisabled = busy || !target.trim() || resendIn > 0;
  ...
  disabled={resendDisabled}
  {resendIn > 0
    ? t("resendInSeconds", lang).replace("{s}", String(resendIn))
    : sent
      ? t("resendCode", lang)
      : t("sendCode", lang)}
  ```
  (用局部变量或内联均可,保持现有代码风格)

### 3. 消息气泡 — `server/src/components/auth-modal.tsx` + `auth-modal.module.css`
- 新 state:`const [notice, setNotice] = useState<string | null>(null);`
- 气泡计时 effect(仿 account-panel.tsx:279-283 的 setTimeout + cleanup 惯例):
  ```ts
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  ```
- `sendCode` 成功分支:`setNotice(t(tab === "email" ? "sendCodeSuccessEmail" : "sendCodeSuccess", lang));`(与 setSent/setResendIn 一起)
- 渲染:`{notice && <div className={styles.topToast} role="status">{notice}</div>}` 放在组件根(与 overlay 同级,position:fixed 不受 overlay 内布局影响)
- `auth-modal.module.css` 新增:
  - `.topToast`(按布局图 B 全部样式;z-index 60)
  - `@keyframes toastIn { from { opacity: 0; transform: translate(-50%, -4px); } to { opacity: 1; transform: translate(-50%, 0); } }`(注意 transform 链:translateX(-50%) 要与动画位移共存——用 `translate: -50% 0` 属性或动画内带 -50%,保证动画前后水平位置一致)
  - `@media (prefers-reduced-motion: reduce) { .topToast { animation: none; } }`
- reset:close/tab 切换时 `setNotice(null)`(与 sent 同步)

### 4. 邮件模板 — `server/src/lib/verification-email.ts`
- `EMAIL_SUBJECT` 改为 `'JobMap登录验证码'`
- `buildVerificationEmailHtml` 按布局图 C 润色:保持**全内联样式 + table 布局**(邮箱客户端安全,无 `<style>`),浅色主题,验证码仍 #007aff,仅插值 code 与时间
- `buildVerificationEmailText` 同步:标题 `【JobMap登录验证码】`,行结构同 html 事实(验证码 + 10 分钟 + 防泄露)

### 5. 测试同步 — `server/tests/resend-client.test.mjs`
- subject 断言(约 test #9 附近,断言 `'登录验证码'`)改为 `'JobMap登录验证码'`
- 模板断言若含标题文案一并核对;其余不动

### 6. 文档 — `tech/25-resend-email.md`
- 主题(subject)提及更新为 `JobMap登录验证码`(若文档有)
- 补一行:前端 OTP 发送按钮 60s 倒计时与后端 cooldownMs 对齐(客户端禁用防连点)

## 硬约束

- **零后端改动**:不碰 `app/api/auth/otp/*`、`account-store.ts`、`session-store.ts`、`resend-client.ts`
- **保持前端契约**:`component-contracts.test.mjs:222-233` 锁定 `autoRegisterHint`(JSX + i18n block + signIn-then-hint 顺序)与 SocialIcon/no-X 契约——不得破坏;按钮文案/占位符无测试锁定,可自由改
- 不加新依赖;不跑 npm install
- 风格:CSS Modules + globals.css tokens;动画 `cubic-bezier(0.32, 0.72, 0, 1)`;禁 magic number;strict TS;注释中文
- 提交 Conventional Commits(小步)

## 门禁(全绿才算完成)

```bash
cd /Users/acccan/dm-wt-resend-fb/server && npm test
cd /Users/acccan/dm-wt-resend-fb/server && npm run typecheck
cd /Users/acccan/dm-wt-resend-fb && make docs-check   # 若无 Makefile 回主仓库根跑
cd /Users/acccan/dm-wt-resend-fb && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-resend-otp-feedback/reports/resend-otp-feedback.md`:改动文件清单、测试数、文档更新、「遇到的问题」段。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
