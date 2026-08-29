# Workstream: google-wechat-disabled

> 你是在独立 worktree 中工作的 headless 开发 worker。**worktree 已由 boss 预建,合并由 boss 统一做**——不要 merge、不要 push、不要动主仓库,也不要创建/切换分支。

## 背景

登录弹窗(第三方登录区)目前有三个按钮:GitHub / Google / 微信,全部可点击。
用户已明确授权(2026-08-24):**把 Google 登录和微信登录变成灰色不可点击状态**;
GitHub 按钮保持现状。此改动出自 `deferred-notes.md #UI-001`,用户已批准,现作为本 workstream 执行。

## 你的 worktree

- 绝对路径:`/Users/acccan/dm-wt-google-wechat-disabled`(cwd 必须在此)
- 分支:`fix/google-wechat-login-disabled`(已存在,直接工作)
- `server/node_modules` 已 symlink,无需安装依赖

## 任务(严格按此范围,不扩大)

1. **组件禁用逻辑** — `server/src/components/auth-modal.tsx`
   - `SOCIAL` 数组(约 21-24 行):给 `google`、`wechat` 两项加禁用标记(建议 `disabled: true` 字段;`github` 不加)。
   - 按钮渲染(约 598-609 行):`disabled={busy || item.disabled}`(类型定义同步;若 `SocialProvider`/`SOCIAL` 有类型约束需一并扩展)。
2. **灰色视觉** — `server/src/components/auth-modal.module.css`
   - `.social`(约 425 行)补 `:disabled` 灰态:降低可读性(如降低文字/边框透明度、去 hover 反馈),**用现有中性 token/变量,不新增品牌色**;保持按钮尺寸与布局不变(图标照旧)。
   - 风格遵守项目 liquid glass 设计系统:`#007AFF` 蓝仅用于激活态,灰色只做 disabled。
3. **测试同步** — grep `server/tests/` 中引用 auth-modal / SOCIAL / google / wechat 的用例(重点 `component-contracts.test.mjs`、`oauth.test.mjs`、`demo-login-gate.test.mjs`):
   - 断言「google/wechat 按钮可点击 / 可触发登录」的用例 → 更新为断言「按钮为 disabled / 不可点击」。
   - 若某用例是服务端 OAuth 流程测试(与前端按钮无关),保持不动。
   - **更新测试,不要绕过测试**。
4. **不改**:GitHub 按钮、布局/间距/动画、登录弹窗其他逻辑、API 层(`/api/auth/oauth*` 不动)。

## 文档契约

若行为描述存在于 `tech/` 或 `agent.md`(如登录方式说明),同步更新;若无相关文档,跳过即可(不要为了改而改)。

## 门禁(全部须过;失败则修,不要跳过)

```bash
cd /Users/acccan/dm-wt-google-wechat-disabled/server && npm test
cd /Users/acccan/dm-wt-google-wechat-disabled/server && npm run typecheck
cd /Users/acccan/dm-wt-google-wechat-disabled && make docs-check
```

- 测试跑完看总数(应 1600+,skip 不影响);typecheck 零错;docs-check 零告警。
- 若测试有与本改动无关的既有失败,在汇报「遇到的问题」段如实列出,不要假装通过。

## 提交

小步、常规提交,message 用 Conventional Commits(如 `feat(auth): disable google/wechat social login buttons` 与 `test(auth): ...` 分开提交)。

## 回报(必须)

写汇报到绝对路径 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260824-google-wechat-login-disable/reports/google-wechat-disabled.md`:
- 改动摘要(改了哪些文件/行,测试如何同步)
- 门禁结果(测试总数 pass/skip、typecheck、docs-check)
- 「遇到的问题」段(如有)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
