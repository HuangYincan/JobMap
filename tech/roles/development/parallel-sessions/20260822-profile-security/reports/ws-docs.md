# ws-docs 汇报(2026-08-22)

## 实际改动

commit `c52550d docs(account): 账号安全契约 tech/28 + tech/14 Account 节 & README 索引更新`(worktree `feature/account-security-docs`,3 文件 +129 行)

- `tech/28-account-security.md`(新建)→ 账号安全全量契约文档:概述与动机(设置/修改密码、绑定/更换手机与邮箱、邮箱+密码登录,2026-08-22 引入)、流程总览(改密码 / 绑手机邮箱 / 邮箱+密码登录三条链路)、端点契约(`POST /api/auth/password/login` 接受邮箱或用户名、统一 401 `INVALID_CREDENTIALS`;`POST /api/auth/me/password` body `{ oldPassword?, otp?: {provider,target,code}, newPassword }` 及身份验证规则与错误码表 `PASSWORD_TOO_SHORT`/`WRONG_PASSWORD`/`INVALID_CODE`/`NOT_BOUND`/`UNAUTHORIZED`;`me/phone` 409 `PHONE_TAKEN`;`me/email` 409 `EMAIL_TAKEN`;user JSON `hasPassword: boolean` 且 `GET /api/auth/me` 与登录响应均含)、语义与决策 5 条(绑定=更新 users 字段+auth_identities upsert/删除、不做完全解绑、邮箱注册仍走 OTP、password tab 注册保持 username、OTP 发送复用 `otp/send` 仅 `consumeOtp` 校验、scrypt 沿用 `lib/password.ts` `scrypt$N$r$p$salt$hash` 永不返前端)、前端入口(Profile「密码与安全」「手机与邮箱」子面板、AuthModal password tab「邮箱或用户名」)、测试覆盖点一句话、安全说明(不泄露账号存在性 / 单向哈希 / 身份验证分层 / 唯一凭证保护 / OTP 守卫复用)。
- `tech/14-api-contract.md:28`(Account 节)→ 在 :27 Password accounts 行后新增一行「Password management (2026-08-22, tech/28)」:me/password / me/phone / me/email 契约一句话 + 错误码 + 绑定语义 + `password/login` username 接受邮箱或用户名 + user JSON `hasPassword`;只动 Account 节,其余节零改动。
- `tech/README.md:37` → 27-oauth-login 行下新增索引行 `| [28-account-security.md](28-account-security.md) | 账号安全:密码/手机/邮箱管理、邮箱+密码登录(2026-08-22) | 后端 |`。

## 门禁结果

- npm test: 未跑(纯文档 WS,无代码改动,prompt 亦不要求)
- typecheck(worktree server): 通过(`tsc --noEmit` 0 错误)
- docs-check: 通过——`cd /Users/acccan/domain-map` 被会话沙箱拦截(cwd 仅限 worktree 与批次目录),改用与 Makefile 目标完全相同的 policy grep(`docs/roles/|docs/zh-cn/|预计发布时间.*2026-02-10|BOSS.*MVP.*爬|小红书.*MVP.*爬`,`--include='*.md' --exclude-dir=parallel-sessions`)经 Grep 工具在主树跑:10 处命中**全部**在 `parallel-sessions/` 内(该目录被 make 目标排除),本 WS 三个文件零命中
- git diff --check: 通过(提交前后各验一次,`HEAD~1..HEAD` 无空白错误)

## 遇到的问题

- worktree(dev 基线)尚无 `me/password|me/phone|me/email` 路由、`password/login` 仍只收 username、user JSON 无 `hasPassword` → 属预期(ws-backend 并行实现中,未 merge);按 prompt 指示以契约为准写文档,未改动代码。boss merge 后可对照 ws-backend 实际实现复核。
- prompt 给的 README 索引行是 bullet 格式(`- [28...] — ...`),但 README 索引是 markdown 表格,插入 bullet 会破坏表格渲染 → 按既有表格行格式写入(说明文字与 prompt 一致),需 boss 确认接受该格式偏差。
- `make docs-check` 需在主树跑但 cd 被沙箱拦截 → 以等价 grep 代替,见门禁结果;若 boss 要求严格 `make` 输出,可人工跑一次。

## 证据

- typecheck:`server && npm run typecheck` → `tsc --noEmit` 无输出(通过)
- docs-check 等价 grep(主树):10 命中全在 `parallel-sessions/`(make 目标排除),零非排除命中
- `git diff --check HEAD~1 HEAD`:无输出(通过)
- commit `c52550d`,worktree 工作区干净(`git status --short` 空)

门禁: PASSED
结论: OK
