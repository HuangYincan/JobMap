# Deferred Notes — 20260820-boss-bugfix

> 本批 Env 阶段实测发现/遗留项;承接 20260820-boss-optimize 的 D-01~D-18(见该批 deferred-notes.md)。

| # | 类型 | 项 | 内容 |
|---|---|---|---|
| E-01 | 观察 | **/api/me/notifications 429** | 冒烟时该接口返回 429(自身限流器)。非本次 3 bug 范围;若用户频繁遇到,需查限流阈值是否过紧 |
| E-02 | 观察 | **Next 16 生成文件** | `server/AGENTS.md` + `server/CLAUDE.md`(Next 16 自动生成,内容指向 node_modules/next/dist/docs/,建议 agent 写代码前查阅)已 commit 保持树干净;`next-env.d.ts` 会在 dev/build 运行间交替改写(`.next/dev/types` vs `.next/types`),属正常 |
| E-03 | 观察 | **b1 契约测试盲区** | b1 原实现(迁移先于去重)契约测试全绿但真实 DB 失败(唯一键瞬时冲突)——模板/调用序断言覆盖不了 PG 语句内唯一键检查;b1f 已修正顺序并补顺序断言。教训:import 类逻辑最终以真实 DB 验证为准(boss 已重跑验证) |
| E-04 | 待办 | **import 自愈的边界** | 自愈只处理 plan 内 authentic 岗位;DB 中若有 authentic 之外的同 external_id 历史重复(理论上无),不会清理。positions 唯一键仍为 (source_id, external_id);若未来同一 external_id 跨公司出现,需升级唯一键策略 |
