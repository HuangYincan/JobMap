# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-backend、ws-frontend、ws-docs × 3
- 失败/遗留: 无(0)

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-backend | `feature/account-security-api` | 合并(无冲突)→ `b8e73e9` | 1310 tests / 1308 pass / 0 fail / 2 skip;typecheck 0 错;docs-check 通过;diff-check 通过 | 无冲突 |
| ws-frontend | `feature/account-security-frontend` | 合并(无冲突,map-shell.tsx auto-merge)→ `3b6386a` | 1310 tests / 1308 pass / 0 fail / 2 skip;typecheck 0 错;docs-check 通过;diff-check 通过 | 无冲突 |
| ws-docs | `feature/account-security-docs` | 合并(无冲突)→ `673cc4d` | 1310 tests / 1308 pass / 0 fail / 2 skip;typecheck 0 错;docs-check 通过;diff-check 通过 | 无冲突 |

## 冲突解决清单
- 三次 `git merge --no-ff` 均无冲突,无需人工取舍。
- `map-shell.tsx` 在 ws-frontend 合并时 auto-merge(该文件仅由 ws-frontend 改动,dev 基线无分叉)。

## 遗留问题
- 无红停;无 Env-only 步骤(本批无新 env、无迁移;OTP 发送复用已配置的 Resend / 阿里云 SMS)。
- 口径与 UI 决策已记入 `deferred-notes.md`(不做完全解绑 / password tab 注册保持 username / 4-tab 结构不动 / 脱敏展示)。

## 最终 dev 状态
- `dev` = `673cc4d`,已 push `origin/dev`(0fac2eb → 673cc4d,3 个 merge commit)。
- 三个 feature 分支已 `git branch -d` 删除;三个 worktree(ps-backend / ps-frontend / ps-docs)已移除。
- 合并内容:邮箱+密码登录(loginWithPassword 支持 email)+ user JSON `hasPassword` + `POST /api/auth/me/{password,phone,email}` 三路由 + 12 项新测试;Profile「密码与安全」「手机与邮箱」子面板(OTP 流程 + 脱敏展示)+ AuthModal password tab「邮箱或用户名」;`tech/28-account-security.md` 契约文档 + tech/14 Account 节 + README 索引。
- 未 push main、未 force-push;主工作树无跟踪文件改动(仅预存未跟踪批次目录)。

门禁: ALL_GREEN
结论: MERGED_ALL
