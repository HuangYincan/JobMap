# google-wechat-disabled 汇报(2026-08-24)

## 实际改动

分支 `fix/google-wechat-login-disabled`,3 个小步 commit(均在 worktree 内,未 merge/push):

- `feat(auth)` a38efe5 — `server/src/components/auth-modal.tsx` + `auth-modal.module.css`
  - `SOCIAL` 数组(21-31 行):类型扩展可选 `disabled?: boolean`;`google`、`wechat` 两项加 `disabled: true`,`github` 不加;注释标明出处(deferred-notes #UI-001,2026-08-24 用户授权)
  - 按钮渲染(~610 行):`disabled={busy || item.disabled}`(原 `disabled={busy}`),点击/键盘均不可触发,`social()` 与 OAuth 跳转逻辑本身零改动
  - CSS `.social:disabled`(432-438 行):中性灰态——`color: var(--muted)`(现有中性 token,非品牌色)、border/background 降低白色透明度、`cursor: not-allowed`;尺寸/间距/图标照旧,无 hover 反馈
  - 深色模式覆盖(522-526 行):`@media (prefers-color-scheme: dark)` 内 `.social:disabled` 更暗(弱于 enabled 的 rgba(255,255,255,0.06)),保持灰态语义
- `test(auth)` d94e6e9 — `server/tests/component-contracts.test.mjs`
  - 扩展「auth Other is icon rows without X」:新增断言 google/wechat 带 `disabled: true`、渲染条件 `disabled={busy || item.disabled}`、`.social:disabled` 灰态存在;断言 github **不**带 `disabled: true`(保持可点)
  - 未动的测试: `oauth.test.mjs` 全部为服务端 OAuth 流程(providers 探测 / authorize 构建 / token+userinfo 交换 / 路由存在性),与前端按钮无关 → 保持不动;`demo-login-gate.test.mjs` 测的是服务端 `demoLoginGate()` 库,前端禁用不影响其语义 → 保持不动
- `docs(auth)` dc91aef — `tech/27-oauth-login.md`
  - 「背景与动机」段末加 2026-08-24 现状块:Google/微信按钮已置灰禁用(前端入口关闭)、GitHub 保持可用、API 层 `/api/auth/oauth*` 与协议/端点不变

## 门禁结果

- npm test: **1611 通过 / 0 失败 / 2 skip**(更新后的「auth Other is icon rows without X」✔ 在列)
- typecheck(tsc --noEmit):通过,零错误
- docs-check:通过(Documentation policy check passed)
- git diff --check:干净

## 遇到的问题

无。全流程(组件 → 视觉 → 测试 → 文档)一次通过,无既有失败、无需要 boss 裁决事项。

## 证据

- 测试输出摘要:ℹ tests 1611 / pass 1609 / fail 0 / skipped 2 / duration ~7.3s;`✔ auth Other is icon rows without X (0.669ms)`
- `git log --oneline -3`:a38efe5 feat / d94e6e9 test / dc91aef docs(均在 fix/google-wechat-login-disabled)

门禁: PASSED
结论: OK
