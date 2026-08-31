# 批次 20260822-auth-placeholders — 登录框提示词正式化

## 目标
手机/邮箱输入框 placeholder 从示例格式(`+86 13800000000` / `you@example.com`)改为正式提示语(zh/en i18n)。

## Workstream 表

| ws | 分支 | worktree | 主题 | 状态 |
|---|---|---|---|---|
| auth-placeholders | fix/auth-modal-placeholders | /Users/acccan/dm-wt-auth-placeholders | auth-modal.tsx placeholder → i18n 正式提示 | PENDING |

## 合并顺序
1. auth-placeholders(唯一)

## 关键文件
- `server/src/components/auth-modal.tsx`(:361)
- `server/src/lib/i18n.ts`(phonePlaceholder / emailPlaceholder)
