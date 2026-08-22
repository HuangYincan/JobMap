# Batch Manifest — 20260822-boss-agent-inputbar

## 目标

用户反馈 2 项:
1. 发送消息后,发送按钮原位变「停止」;清屏移到控件行最左(inputbar);
2. 导航按钮初始不显示文本 —— `.md a` 特异性压制 `.dm-navi` 白字(CSS 蓝字蓝底)+ URL 空 name 尾逗号(navi3)。

## Workstreams

| ws | 主题 | 分支 | worktree | prompt | report | 状态 |
|---|---|---|---|---|---|---|
| inputbar | 发送↔停止原位切换 + 清屏移左 | `fix/agent-inputbar-ux` | `../dm-wt-agent-inputbar` | `prompts/ws-inputbar.md` | `reports/ws-inputbar.md` | DONE 绿(9eaa0eb) |
| navi3 | 导航按钮 CSS 特异性 + URL 尾逗号 | `fix/agent-navi-css` | `../dm-wt-agent-navi3` | `prompts/ws-navi3.md` | `reports/ws-navi3.md` | DONE 绿(a99f4d6) |

## 合并顺序

inputbar → navi3(并行,文件不相交)。

## 门禁

- `cd server && npm test` + `npm run typecheck`;根 `make docs-check` + `git diff --check`
