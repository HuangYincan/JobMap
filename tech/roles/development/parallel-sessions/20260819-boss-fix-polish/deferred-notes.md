# Deferred Notes — 20260819-boss-fix-polish

> 需用户决策 / Env-only / 数据口径的项。boss 不询问、不中断,任务完成后统一告知。

| ts | 类型 | 内容 |
|---|---|---|
| 2026-08-19 | Env-only | **icon 数据存量修复**:ws3 修复 import 合并 + 读路径解析链后,DB 存量 672 家 logo 仍空。需用户确认后执行 `npm run import:seed:apply`(把 seed/drop 的 logo 字段合入 DB)+ bump MODE_CACHE_VERSION + `audit:pins` 验证(数据修正流程,tech/16 固化)。 |
| 2026-08-19 | 数据口径 | **distance 圆心跨城(实机复现确认)**:用户设置距离过滤后,圆心固定(userLocation/初始中心),跨城平移后另一城 POI 全被客户端 pipeline 裁掉 → 整城空白且无提示。修复需选交互语义(圆心随视野 / 越距提示+一键清除 / 自动复位),待用户拍板。 |
| 2026-08-19 | 其他 | **连续快速交互 marker 失步风险项**:dev 热更新(Fast Refresh)环境下多次 zoom+拖动后偶发 marker 与 catalog 失步;生产模式未复验。建议生产构建下复验,若复现另开 fix 批次。 |
| 2026-08-19 | 其他 | **tech/16-bug-fixes.md 未同步**:本批 4 项修复(视口 noMore/对齐/空批次三态、marker 控制器加固、icon 解析链、profile 投递行)未记入 tech/16 与 bug-reports,需补文档。 |
| 2026-08-19 | 其他 | **favicon.im 覆盖率**:实测对 IP 域名(如 47.96.146.209)返回 404 → emoji 兜底;ADR-007 已记,浏览器端抽查列为风险项。 |
