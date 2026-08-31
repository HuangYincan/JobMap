# Deferred Notes — 20260822-mobile-agent-embed

> boss 不自动处理、需用户后续决策/操作的事项。类型:UI设计 = 改现有 UI 设计(不派发);Env-only = 环境/密钥操作(不自动跑);其他 = 口径/外部依赖。

| # | 类型 | 内容 | 触发条件/操作指引 |
|---|---|---|---|
| 1 | 其他(已闭环) | 轮1 的 dev 数据测试红(drops-coordinate-consistency / split-city-sites)已由并发 geofix(5c8dca2)修复,merger 终态门禁 ALL_GREEN(1415 pass/0 fail) | 无需操作 |
| 2 | UI设计(edge,待用户观感确认) | **375px 窄屏(SE/12 mini)工具栏可能换行**:宽度核算 355px 内容 + 32 padding = 387 > 375,`flex-wrap:wrap` 兜底会把头像折到第二行(390px 起正常)。保持 40px 触控目标未缩 | 用户看实际效果后决定是否加 `@media (max-width:380px)` 缩小 item/间距 |
| 3 | 其他(已闭环) | 轮1 的视觉验证待办已完成:boss Playwright(移动 390×844 + 桌面 1440×900)AX/DOM 全项验证通过;截图 `.playwright-mcp/mobile-toolbar-initial.png`、`.playwright-mcp/mobile-agent-sheet-embedded.png` | 无需操作 |
