# 批次 20260822-auth-modal-opacity — 登录弹窗降透明度

## 目标
用户反馈登录弹窗太透。提高 `.card` 背景 alpha(亮 0.42/0.18 → 0.90/0.84;暗 0.62/0.42 → 0.90/0.84),保留玻璃质感。单文件改动。

## Workstream 表

| ws | 分支 | worktree | 主题 | 状态 |
|---|---|---|---|---|
| auth-modal-opacity | fix/auth-modal-opacity | /Users/acccan/dm-wt-auth-opacity | auth-modal.module.css 两处背景 alpha | PENDING |

## 合并顺序
1. auth-modal-opacity(唯一)

## 关键文件
- `server/src/components/auth-modal.module.css`(:67 亮色 .card / :389-393 暗色 .card)
