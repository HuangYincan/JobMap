# 批次 20260821-resend-otp-feedback — OTP 发送反馈 UI + 邮件打磨

## 目标
1. auth-modal OTP 发送成功后:按钮变"xx 秒后再次发送"(倒计时 60s 禁点),页面顶部水平居中消息气泡("已发送")
2. 验证码邮件模板润色 + 主题改 "JobMap登录验证码"
3. 纯前端 + 邮件模板;后端零改动

## Workstream 表

| ws | 分支 | worktree | 主题 | 状态 |
|---|---|---|---|---|
| resend-otp-feedback | feature/resend-otp-feedback | /Users/acccan/dm-wt-resend-fb | 倒计时按钮 + toast + i18n + 邮件打磨 + 测试/文档 | PENDING |

## 合并顺序
1. resend-otp-feedback(唯一,全绿后 merger 合入 dev 并 push)

## 关键文件
- `server/src/components/auth-modal.tsx` + `auth-modal.module.css` — 倒计时 + 气泡
- `server/src/lib/i18n.ts` — 新 keys
- `server/src/lib/verification-email.ts` — 主题 + 模板润色
- `server/tests/resend-client.test.mjs` — subject 断言同步
- `tech/25-resend-email.md` — 同步

## 布局图(LAYOUT,已按设计系统审定)
见 prompts/resend-otp-feedback.md 顶部。
