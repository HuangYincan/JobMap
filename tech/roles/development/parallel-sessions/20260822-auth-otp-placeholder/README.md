# 批次 20260822-auth-otp-placeholder — 验证码框占位"请输入验证码"

## 目标
验证码输入框占位从"移除"改为正式提示"请输入验证码"(i18n zh/en)。

## Workstream 表

| ws | 分支 | worktree | 主题 | 状态 |
|---|---|---|---|---|
| auth-otp-placeholder | fix/auth-otp-placeholder | /Users/acccan/dm-wt-auth-otpph | auth-modal.tsx + i18n 新 key | PENDING |

## 合并顺序
1. auth-otp-placeholder(唯一)

## 关键文件
- `server/src/components/auth-modal.tsx`(验证码 input)
- `server/src/lib/i18n.ts`(otpCodePlaceholder)
