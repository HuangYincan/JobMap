# 批次 20260822-oauth-callback-500 — callback 路由 500 修复

## 目标
OAuth callback 路由 4 处 NextResponse.redirect 传相对路径,Next 16 validateURL 抛错 → 500。修复:absoluteRedirect 纯函数 + 路由改绝对 URL + 回归测试。

## Workstream
| WS | 分支 | 主题 | 状态 |
|---|---|---|---|
| ws-fix | `fix/oauth-callback-500` | absoluteRedirect + callback 路由 4 处 + oauth.test.mjs 回归 | DONE(门禁 PASSED) |

## Boss 裁决(沿用 20260822-oauth-login 批次,2026-08-22 03:42)
主树 `npm test` 的红(embodied-jobs 语料契约测试)为**未提交 geocode 残留**所致(pre-existing,双验证:干净 worktree 4/4 vs 主树 1 fail)。本次合并若红仅限该测试且根因为残留 → 豁免通过;出现其他新红 → 红则停。绝不 touch 未提交残留。
