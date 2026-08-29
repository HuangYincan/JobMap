# Deferred Notes — Quality Scan 2026-08-27

以下项目因涉及数据源授权、隐私产品口径、部署拓扑、实体判断或 Env-only 操作，不在无人值守修复批次中自动实施。

| 扫描项 | 类型 | 暂缓内容 | 建议决策 |
|---|---|---|---|
| #1 | 数据源授权 | Feishu 适配器使用浏览器 UA 绕过爬虫 UA 的 405 门禁。 | 在取得来源方明确授权前停止该访问方式；决定禁用适配器还是批准官方允许入口。 |
| #3 | 隐私/产品交互 | Agent Memory 缺少硬性敏感信息拒绝、显式确认与 consent 审计。 | 决定敏感模式、误报容忍度、保存确认交互与既有记忆处理策略。 |
| #8 | Env-only/部署拓扑 | `TRUSTED_PROXY_IPS` 未校验真实 peer，匿名用户共享限流桶。 | 明确部署平台可信客户端 IP 来源、代理链和共享限流存储后再实现。 |
| #11 | 数据源/展示口径 | 上游快照携带的 zhipin 链接被标成 official。 | 决定是否保留商业平台外链以及 UI/数据中的来源标记。 |
| #13 | 数据源访问策略 | robots 网络/解析失败当前 fail-open。 | 决定默认 fail-closed，或列出经人工批准的例外 host。 |
| #16 apply | Env-only | 本批仅生成复合 FK migration 与验证，不执行数据库迁移。 | 在目标环境先跑 preflight，再人工 apply。 |
| #21 | 数据实体口径 | Tactus 地址与 Calvin University career/apply 疑似错配。 | 人工复核实体；确认前建议 quarantine/closed。 |

## UI 说明

扫描未批准任何现有 UI 视觉/布局重设计；本批前端改动只修复既有语义下的 readiness 与边界 bug。
