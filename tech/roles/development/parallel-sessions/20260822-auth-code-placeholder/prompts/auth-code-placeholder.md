# Workstream: auth-code-placeholder — 去掉验证码输入框占位符

## 背景

用户要求去掉验证码输入框的占位符提示。

## 目标

`server/src/components/auth-modal.tsx:380` 现状:
```tsx
<input ... autoComplete="one-time-code" placeholder="000000" />
```
改为**移除 `placeholder` 属性**(整行删掉该属性,不保留空字符串)。

## 文件边界

- 只改 `server/src/components/auth-modal.tsx` 这一行(其余 input 属性 inputMode/autoComplete 保留)
- 不碰 i18n、其他文件;不跑 npm install;Conventional Commits(`fix(auth): 移除验证码输入框占位符`)

## 门禁

```bash
cd /Users/acccan/dm-wt-auth-code-ph/server && npm test
cd /Users/acccan/dm-wt-auth-code-ph/server && npm run typecheck
cd /Users/acccan/dm-wt-auth-code-ph && make docs-check   # 无 Makefile 则回主仓库根
cd /Users/acccan/dm-wt-auth-code-ph && git diff --check
```
docs-check 若有他批产物自匹配(已知问题)在汇报说明即可,不算 FAILED。

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-auth-code-placeholder/reports/auth-code-placeholder.md`。**末两行必须精确为**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
