# Workstream: auth-placeholders — 登录框提示词正式化

## 背景

用户反馈:手机/邮箱输入框的提示信息(placeholder)太随意,要更正式,或删掉。已选定:更正式(上方已有"手机号/邮箱"标签,示例格式冗余)。

## 目标

`server/src/components/auth-modal.tsx:361` 现状:
```tsx
placeholder={tab === "phone" ? "+86 13800000000" : "you@example.com"}
```
改为 i18n 正式提示(中英双份):

| key | zh | en |
|---|---|---|
| phonePlaceholder | `请输入手机号` | `Enter phone number` |
| emailPlaceholder | `请输入邮箱` | `Enter email address` |

- 新 keys 加在 `server/src/lib/i18n.ts` 的 phoneNumber/emailAddress 附近(约 574-581)
- 组件处:`placeholder={tab === "phone" ? t("phonePlaceholder", lang) : t("emailPlaceholder", lang)}`

## 文件边界

- 只改 `server/src/components/auth-modal.tsx`(:361 placeholder 行)与 `server/src/lib/i18n.ts`(2 新 keys)
- **不动**验证码输入框的 `placeholder="000000"`(:380,用户未提)
- 不碰其他文件;不跑 npm install;Conventional Commits(`fix(auth): …`)

## 门禁

```bash
cd /Users/acccan/dm-wt-auth-placeholders/server && npm test
cd /Users/acccan/dm-wt-auth-placeholders/server && npm run typecheck
cd /Users/acccan/dm-wt-auth-placeholders && make docs-check   # 无 Makefile 则回主仓库根
cd /Users/acccan/dm-wt-auth-placeholders && git diff --check
```
docs-check 若有他批产物自匹配(已知问题)在汇报说明即可,不算 FAILED。

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-auth-placeholders/reports/auth-placeholders.md`:改动文件、新 keys、门禁结果。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
