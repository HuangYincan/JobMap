# auth-placeholders 汇报(2026-08-22)

## 实际改动
- `server/src/lib/i18n.ts` → 在 `phoneNumber`/`emailAddress` 之后新增 2 个 i18n key:
  - `phonePlaceholder`: zh `请输入手机号` / en `Enter phone number`
  - `emailPlaceholder`: zh `请输入邮箱` / en `Enter email address`
- `server/src/components/auth-modal.tsx`(:392) → 手机/邮箱输入框 placeholder 由硬编码 `"+86 13800000000"` / `"you@example.com"` 改为 `t("phonePlaceholder", lang)` / `t("emailPlaceholder", lang)`,随 tab 切换

## 门禁结果
- npm test: 1113 通过 / 0 失败(2 skip,skip 为已知项)
- typecheck: 通过(tsc --noEmit 无错误)
- docs-check: 通过(Documentation policy check passed,worktree 内有 Makefile)
- git diff --check: 通过

## 遇到的问题
- 无。验证码输入框 `placeholder="000000"` 按要求未动。

## 证据
- commit `67feb87` `fix(auth): 登录框提示词正式化(手机号/邮箱 placeholder 改 i18n)`(2 files changed, +11/-1)
- 测试输出尾部:`tests 1115 / pass 1113 / fail 0 / skipped 2`

门禁: PASSED
结论: OK
