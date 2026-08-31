# Workstream: auth-otp-placeholder — 验证码框占位改"请输入验证码"

## 背景

上批移除了 `placeholder="000000"`,用户现要求占位改为正式提示"请输入验证码"。

## 目标

- `server/src/lib/i18n.ts`:在 `otpCode` key(约 582-585)旁新增:
  ```ts
  otpCodePlaceholder: { zh: '请输入验证码', en: 'Enter code' },
  ```
- `server/src/components/auth-modal.tsx`(约 414-419,验证码 input 处):加回
  ```tsx
  placeholder={t("otpCodePlaceholder", lang)}
  ```
  (与 phonePlaceholder/emailPlaceholder 同款用法)

## 文件边界

- 只改 `server/src/components/auth-modal.tsx` 与 `server/src/lib/i18n.ts`
- 不碰其他文件;不跑 npm install;Conventional Commits(`fix(auth): …`)

## 门禁

```bash
cd /Users/acccan/dm-wt-auth-otpph/server && npm test
cd /Users/acccan/dm-wt-auth-otpph/server && npm run typecheck
cd /Users/acccan/dm-wt-auth-otpph && make docs-check   # 无 Makefile 则回主仓库根
cd /Users/acccan/dm-wt-auth-otpph && git diff --check
```
docs-check 若有他批产物自匹配(已知问题)在汇报说明即可,不算 FAILED。

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-auth-otp-placeholder/reports/auth-otp-placeholder.md`。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
