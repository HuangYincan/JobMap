# Deferred Notes — 20260822-mobile-sheet-fixes

> boss 不自动处理、需用户后续决策/操作的事项。类型:UI设计 = 改现有 UI 设计(不派发);Env-only = 环境/密钥操作(不自动跑);其他 = 口径/外部依赖。

| # | 类型 | 内容 | 触发条件/操作指引 |
|---|---|---|---|
| 1 | 其他(已闭环) | 视觉实测(Playwright 390×844)完成:AI 面板填满抽屉(605px)、输入/控制行贴底(仅 24px 安全边距);收藏图层按钮「仅展示/取消展示收藏图层」双向文案 + 40px 高度。截图 `.playwright-mcp/mobile-agent-sheet-pinned.png` | 无需操作 |
| 2 | UI设计(edge,待用户观感确认) | **375px 窄屏(SE/12 mini)工具栏可能换行**:宽度核算 355px 内容 + 32 padding = 387 > 375,`flex-wrap:wrap` 兜底会把头像折到第二行(390px 起正常)。保持 40px 触控目标未缩 | 用户看实际效果后决定是否加 `@media (max-width:380px)` 缩小 item/间距 |
| 3 | 其他 | 测试过程中把测试浏览器里 收藏图层 overlay 偏好从开切到关(仅 MCP 测试 profile 的 sessionStorage,不影响用户真实浏览器) | 无需操作 |
