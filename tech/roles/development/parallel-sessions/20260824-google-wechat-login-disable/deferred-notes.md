# Deferred Notes — 20260824-google-wechat-login-disable

> 按 boss-agent 铁律 #5:修改现有 UI 设计(视觉布局/交互/流程变化)→ 不派发,
> 记录于此,任务完成后统一告知用户。

## UI-001(2026-08-24)| 类型:UI设计(现有按钮交互+视觉) — ✅ 已执行

> 用户 2026-08-24 明确授权后转为 workstream `google-wechat-disabled`,已合并入 dev(3021da3)。

**需求(用户原话)**:把 Google 登录和微信登录变成灰色不可点击状态。

**范围**:仅 Google 与微信两个按钮;GitHub 按钮保持现状(未提及)。

**现状**:
- `server/src/components/auth-modal.tsx:21-24` — `SOCIAL` 数组含 `github | google | wechat` 三项,当前全部可点击。
- `server/src/components/auth-modal.tsx:598-609` — 按钮渲染,`disabled={busy}`(仅忙碌时禁用),点击调 `social(item.id)`。
- `server/src/components/auth-modal.module.css:425` — `.social` **无 `:disabled` 样式**,灰色需要新增 disabled 视觉(token 化,保持 liquid glass 风格)。
- 现有 provider 探测(`/api/auth/oauth/providers`)与「未配置走 demo POST」逻辑在 `social()` 内,禁用后该路径对 google/wechat 不再触发。

**建议实现方向(未执行)**:
1. `SOCIAL` 条目加禁用标记(如 `disabled: true`),仅 google/wechat。
2. 按钮 `disabled={busy || item.disabled}`。
3. `.social` 补 `:disabled` 灰态(降透明度/去色 + 无 hover 反馈;色板不可新增品牌色,灰用中性 token)。
4. 同步 `oauth.test.mjs` / `demo-login-gate.test.mjs` 中可能断言 google/wechat 可点击登录的用例;门禁 `cd server && npm test`。

**为何 defer**:非 bug 修复、不保持现有设计语义,而是有意改变登录可用集
(交互流程 + 视觉状态变化)→ 需用户在真实 UI 上确认效果。
