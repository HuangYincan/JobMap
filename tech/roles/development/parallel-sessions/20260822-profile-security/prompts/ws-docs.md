# WS: ws-docs — 账号安全文档(tech/28 + 契约更新)

你是 headless 开发 worker。工作目录是**你的 worktree**:`/Users/acccan/dm-wt-ps-docs`(已预建,分支 `feature/account-security-docs`,从 dev 切出)。**worktree 已预建,boss 统一合并;你绝不 merge / push / 建分支。** 完成后写汇报到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-profile-security/reports/ws-docs.md`(末两行 token)。

## 背景

平台认证体系(OTP 邮箱/手机验证码登录、OAuth、username+password)正在新增**账号安全管理**:
修改密码、绑定/更换手机与邮箱、邮箱+密码登录。后端(ws-backend)与前端(ws-frontend)并行实现中。
本 WS 只写文档,不写任何代码。文档必须反映**契约(下方已定稿,与代码实现一致)**;若你发现
worktree 内代码与契约有出入,以契约为准写文档,并在「遇到的问题」里指出差异。

## 参考先例
- `tech/27-oauth-login.md` — 认证功能文档风格(流程、端点表、错误映射、配置清单)。
- `tech/14-api-contract.md` — Account 节(:20-30)契约清单格式。
- `tech/README.md` — 文档索引(每篇一行)。

## 任务(全部在 worktree 内)

### 1. 新建 `tech/28-account-security.md`
内容:
- **概述**:账号安全能力(设置/修改密码、绑定/更换手机与邮箱、邮箱+密码登录),2026-08-22 引入。
- **API 契约**(与 README 共享契约完全一致):
  - `POST /api/auth/password/login` — `{ username, password }`,username 接受**邮箱或用户名**;
    失败统一 401 `INVALID_CREDENTIALS`(不泄露账号是否存在);成功 `{ ok:true, user }` + session cookie。
  - `POST /api/auth/me/password` — body `{ oldPassword?, otp?: { provider:'email'|'phone', target, code }, newPassword }`;
    身份验证规则:已有密码 → oldPassword(可 otp 替代);无密码 → otp 必须且 target 必须命中已绑定凭证;
    错误码:400 `PASSWORD_TOO_SHORT` / 401 `WRONG_PASSWORD` / `INVALID_CODE` / `NOT_BOUND` / `UNAUTHORIZED`;
    成功 200 `{ ok:true, user }`。
  - `POST /api/auth/me/phone` — `{ phone, code }`;409 `PHONE_TAKEN`;401 `INVALID_CODE`;成功 `{ ok:true, user }`。
  - `POST /api/auth/me/email` — `{ email, code }`;409 `EMAIL_TAKEN`;401 `INVALID_CODE`;成功 `{ ok:true, user }`。
  - user JSON 增加 `hasPassword: boolean`(password_hash 非空);`GET /api/auth/me` 与登录响应均含。
- **语义与决策**:
  - 绑定/更换 = 更新 `users.phone|email` + auth_identities 新行 upsert + 旧行删除;**不做完全解绑**(至少保留一个登录凭证)。
  - 邮箱注册仍走 OTP(email tab 验证即登录);设置密码在 Profile「密码与安全」;之后可用邮箱+密码登录。
  - password tab 注册保持 username;登录字段接受邮箱或用户名。
  - OTP 发送复用 `POST /api/auth/otp/send`;me/* 路由只 `consumeOtp` 校验。
  - 密码哈希沿用 `lib/password.ts` scrypt(格式 `scrypt$N$r$p$salt$hash`),密码永不返回前端。
- **前端入口**:Profile「密码与安全」「手机与邮箱」子面板;AuthModal password tab「邮箱或用户名」。
- **测试**:`server/tests/account-security.test.mjs` 覆盖点一句话。

### 2. 更新 `tech/14-api-contract.md` Account 节
在 :27(Password accounts 行)后新增一行(或就近改写,保持既有行号风格):
密码管理(2026-08-22):`POST /api/auth/me/password` / `me/phone` / `me/email` 契约一句话 +
`password/login` 的 username 字段接受邮箱 + user JSON `hasPassword` 字段;详见 tech/28。
**只改 Account 节附近,不动其它节。** 注意保持每行一个端点/主题的紧凑风格。

### 3. 更新 `tech/README.md` 索引
新增一行 `- [28-account-security.md](./28-account-security.md) — 账号安全:密码/手机/邮箱管理、邮箱+密码登录(2026-08-22)`。

## 文件边界
拥有:`tech/28-account-security.md`(新)、`tech/14-api-contract.md`(仅 Account 节)、`tech/README.md`(仅索引)。
**不碰**:任何代码(server/、crawler/、db/)、.env*、其它 tech 文档(tech/16、tech/27 等不动)。

## 门禁(必须在 worktree 内跑,全部通过才算 OK)
```bash
cd /Users/acccan/dm-wt-ps-docs/server && npm run typecheck   # 文档 WS 也应保证类型不受影响(通常无变化)
cd /Users/acccan/domain-map && make docs-check               # 主树跑
git diff --check
```
`npm test` 不必跑(无代码改动),但若 `make docs-check` 有文档规范要求(如行宽、索引完整性),照改你的文件满足它。

## 提交
- Conventional Commits(`docs(account): ...`)。只 commit 你拥有的文件。

## 汇报
写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-profile-security/reports/ws-docs.md`:
- 做了什么(三个文件各一段,含 file:line)
- 遇到的问题(文档与契约出入/规范失败等,一句话一个)
- 门禁结果(typecheck、docs-check、diff-check)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
