# Deferred Notes — 20260819-boss-cluster-viewport

> 需用户决策 / Env-only / 数据口径的项。boss 不询问、不中断,任务完成后统一告知。

| ts | 类型 | 内容 |
|---|---|---|
| 2026-08-19 | Env-only | **icon 数据存量修复**(承接上一批):ws3 修复 import 合并 + 读路径解析链后,DB 存量 672 家 logo 仍空。需用户确认后执行 `npm run import:seed:apply`(把 seed/drop 的 logo 字段合入 DB)+ bump MODE_CACHE_VERSION + `audit:pins` 验证(数据修正流程,tech/16 固化)。 |
| 2026-08-19 | 数据口径 | **distance 口径已定并修复(本批)**:距离圆心已改为实时 mapCenter(ws-b),语义从「离我最近」→「离当前视野中心最近」(与服务端 boundsCenter 一致)。原「圆心跨城整城空白」问题由 ws-b 关闭。遗留:若用户想要「以我的位置为中心」的语义,需另行设计(记此条备查)。 |
| 2026-08-19 | 其他 | **连续快速交互 marker 失步风险项**(承接上一批):dev 热更新(Fast Refresh)环境下多次 zoom+拖动后偶发 marker 与 catalog 失步;生产模式未复验。建议生产构建下复验,若复现另开 fix 批次。 |
| 2026-08-19 | 其他 | **favicon.im 覆盖率**(承接上一批):实测对 IP 域名(如 47.96.146.209)返回 404 → emoji 兜底;ADR-007 已记,浏览器端抽查列为风险项。 |
| 2026-08-19 | 验收 | **B3 聚合 Playwright 未做**(可选):聚合徽章渲染依赖真实 AMap 环境,merge 后需在 dev 手动 zoom 拉低(≤8)验证徽章出现、点击下钻 zoom 11 展开个体 pin。 |