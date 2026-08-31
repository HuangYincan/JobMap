# Deferred Notes — 20260822-mobile-toolbar

> boss 不自动处理、需用户后续决策/操作的事项。类型:UI设计 = 改现有 UI 设计(不派发);Env-only = 环境/密钥操作(不自动跑);其他 = 口径/外部依赖。

| # | 类型 | 内容 | 触发条件/操作指引 |
|---|---|---|---|
| 1 | 数据口径 | **dev 门禁红(2 数据测试)**:`drops-coordinate-consistency` / `split-city-sites` 期望仍为旧城市中心占位坐标,而 geocode r4(3e6deb3,06:29)已落真实街道坐标(如 qqj 天平路185号 121.439346/31.197401)。**非本批引入**(merger 与 boss 独立复跑证实);归属并发 geocode/address-first 会话(其 ws-pinfix2 正在飞,且已有 `fix/geocode-r4-tests` worktree 在途)。本批不派竞争修复,避免双改同一测试文件 | 并发会话收尾后若仍红,更新两测试期望为新坐标或由用户裁决 |
| 2 | 其他 | **视觉验证未跑**(浏览器被并行会话占用,Playwright MCP 锁定):移动端工具栏 5 items/激活蓝/sheets/AI 面板盖 drawer/球隐藏、桌面球保留,均需截图确认。代码侧已契约测试+逐行 diff 复核 | 浏览器空闲后在 http://localhost:3005 验证(移动 390×844 与桌面 1440);用户也可直接手机体验 |
| 3 | UI设计(edge) | **375px 窄屏(SE/12 mini)工具栏可能换行**:宽度核算 355px 内容 + 32 padding = 387 > 375,`flex-wrap:wrap` 兜底会把头像折到第二行(390px 起正常)。保持 40px 触控目标不缩,记录待视觉验证时确认观感,必要时再加窄屏 override | 用户看实际效果后决定是否加 `@media (max-width:380px)` 缩小 item/间距 |
