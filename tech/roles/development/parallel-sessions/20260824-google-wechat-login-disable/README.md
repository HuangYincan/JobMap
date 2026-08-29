# 20260824 — Google/微信登录按钮禁用

## 目标
把登录弹窗中的 Google 登录与微信登录按钮改为「灰色、不可点击」状态。

## 裁决(无派发)
此目标是对**现有按钮**的交互+视觉修改(可点击→不可点击、正常色→灰),
按 boss-agent 铁律 #5「修改现有 UI 设计(视觉布局/交互/流程变化)→ 跳过,
记 deferred-notes.md」,**未派发任何 worker**,整批仅记录。

## Workstream 表
| ws | 分支 | worktree | 状态 | 说明 |
|---|---|---|---|---|
| — | — | — | DEFERRED | 见 `deferred-notes.md` |

## 关键定位(供后续可执行)
- `server/src/components/auth-modal.tsx:21-24` — `SOCIAL` 数组(github/google/wechat)
- `server/src/components/auth-modal.tsx:598-609` — 按钮渲染,当前 `disabled={busy}`
- `server/src/components/auth-modal.module.css:425` — `.social` 无 `:disabled` 样式
- 相关测试:`server/tests/oauth.test.mjs`、`server/tests/demo-login-gate.test.mjs`

## 涉及文件
- 本文档
- `deferred-notes.md`
- `boss-state.md`
