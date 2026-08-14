# 技术文档索引

本目录包含项目的核心技术文档,供开发者和 AI Agent 参考。

## 文档清单

| 文档 | 说明 | 目标读者 |
|---|---|---|
| [01-architecture.md](01-architecture.md) | 插件化架构全景、技术栈、目录结构、API 设计 | 开发者/架构师 |
| [02-data-model.md](02-data-model.md) | 抽象数据模型、核心表设计、PostGIS 空间分析 | 开发者/DBA |
| [03-plugin-system.md](03-plugin-system.md) | ⭐ 插件开发指南、如何新增领域插件 | 插件开发者 |
| [04-workflow.md](04-workflow.md) | 贡献工作流、分支策略、Code Review 规范 | 贡献者 |
| [05-milestones.md](05-milestones.md) | 项目里程碑、阶段划分、验收标准 | 项目经理 |
| [06-decisions.md](06-decisions.md) | 架构决策记录(ADR) | 开发者/架构师 |

## 快速导航

**我想...**
- 了解项目整体架构 → [01-architecture.md](01-architecture.md)
- 理解数据库设计 → [02-data-model.md](02-data-model.md)
- **开发一个新插件** → [03-plugin-system.md](03-plugin-system.md) ⭐
- 贡献代码 → [04-workflow.md](04-workflow.md)
- 查看开发进度 → [05-milestones.md](05-milestones.md)
- 了解技术决策理由 → [06-decisions.md](06-decisions.md)

## 与公众文档的关系

| 文档类型 | 位置 | 受众 | 内容风格 |
|---|---|---|---|
| **技术文档**(本目录) | `/DOCS/` | 开发者/AI Agent | 详细的技术细节、实现方案、设计理由 |
| **公众文档** | `/docs/zh-cn/` | 终端用户/开源贡献者 | 使用教程、功能说明、部署指南 |
| **角色协作文档** | `/docs/roles/` | 团队内部 | PRD/测试报告/部署记录/安全审计 |

## 文档维护规范

- **代码变更 → 同步文档**:修改数据库/API/插件系统后,必须同步更新对应文档
- **新功能开发**:先更新本目录文档(技术方案),功能完成后写公众文档(使用教程)
- **文档即代码**:文档 PR 与代码 PR 同等重要,未更新文档的 PR 不予合并

详见 [agent.md](../agent.md) 的"文档维护契约"章节。
