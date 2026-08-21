# Deferred Notes — 20260821-boss-map-engine

需用户决策/执行的项(boss 不自动做,最终总汇报统一告知)。

| # | 类型 | 内容 | 状态 |
|---|---|---|---|
| 1 | Env-only | `NEXT_PUBLIC_TENCENT_JSAPI_KEY` 申请与配置:lbs.qq.com 控制台新建 key 并勾选 JS API GL,配入 `server/.env.local`。此前 WS-D 腾讯引擎的**真实 key 冒烟缺口**由 mock 测试代替 | 待用户 |
| 2 | Env-only | `NEXT_PUBLIC_BAIDU_AK` 配置:lbs.baidu.com 控制台;AK 可复用现有 `BAIDU_MAP_AK` 值,但 JSAPI 需配置 referer 白名单 | 待用户 |
| 3 | 冲突防护 | 重叠文档 `tech/01-architecture.md`、`tech/03-plugin-system.md`、`tech/06-decisions.md`、`agent.md` 的更新(多引擎插件化声明、map-render capability、ADR) — **等 `20260821-docs-maintenance` 批次完成后单列独立文档批次** | 待 docs-maintenance 完成 |
| 4 | Env-only | 三家同配的真实冒烟(默认高德、手动切腾讯/百度、状态保持、样式降级)需项 1/2 的 key 就位后执行,结果记录进 tech/23 | 依赖 1/2 |
| 5 | 其他 | 切换引擎后底图样式回到首渲染快照(契约无 getStyle()):后续可在 MapView 契约加 getStyle() 后消除;三家同配时用户切换可能遇到底图回退(小) | 待后续契约增强 |
| 6 | 其他 | 非 AMap 引擎的 geolocation 蓝点行为未验证(createMap 里 getCurrentPosition(view.raw) 是 amap-api 专属逃生舱);真机冒烟时核对,必要时 map-shell 层适配 | 依赖 1/2 |
