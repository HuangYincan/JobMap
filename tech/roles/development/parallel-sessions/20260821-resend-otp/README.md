# 批次 20260821-resend-otp — Resend 验证码邮件接入

## 目标
为 `POST /api/auth/otp/send` 接入 Resend API 发送 6 位数字邮箱验证码(主题"登录验证码",浅色卡片 HTML + 纯文本 fallback)。存储/校验环节项目已具备(`auth_otp_challenges` + 内存守卫,10 分钟过期、5 次错锁),**不新建表、不迁移、无 UI 改动**。

## 决策(用户已拍板)
- **原生 fetch**(非 SDK),可注入 `fetchImpl`(仓库惯例)
- **429 与网络异常同策略:重试 1 次**(指数退避 ~500ms,`retryDelayMs` 可注入)
- 错误信封保持项目 `{ code, message }`(客户端读 `body.message`;不用 `{ ok:false, error }`)
- phone provider 保留 demo 桩(无 SMS 发送方)

## Workstream 表

| ws | 分支 | worktree | 主题 | 状态 |
|---|---|---|---|---|
| resend-otp-email | feature/resend-otp-email | /Users/acccan/dm-wt-resend-otp | 验证码生成 + Resend 客户端 + 路由 + 测试 + 文档 | PENDING |

## 合并顺序
1. resend-otp-email(唯一,全绿后 merger 合入 dev 并 push)

## 关键文件
- `server/src/lib/session-store.ts` / `account-store.ts` — 验证码生成 + issueOtp 返回明码
- `server/src/lib/resend-client.ts` / `verification-email.ts` — 新建
- `server/src/app/api/auth/otp/send/route.ts` — 路由接线
- `server/tests/resend-client.test.mjs`(新)+ `otp-guard.test.mjs` 更新
- 文档:`tech/14-api-contract.md`、`tech/25-resend-email.md`(新)、`tech/README.md`、`server/.env.example`、`server/docs/environment-variables.md`
