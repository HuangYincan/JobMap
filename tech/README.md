# 技术文档索引

本目录包含项目的核心技术与内部协作文档。当前仓库处于文档/脚手架阶段；文档中的目标结构不代表代码已实现。

## 文档清单

| 文档 | 说明 | 目标读者 |
|---|---|---|
| [01-architecture.md](01-architecture.md) | 插件化架构全景、技术栈、目录结构、API 设计 | 开发者/架构师 |
| [02-data-model.md](02-data-model.md) | 抽象数据模型、核心表设计、PostGIS 空间分析 | 开发者/DBA |
| [03-plugin-system.md](03-plugin-system.md) | ⭐ 插件开发指南、如何新增领域插件 | 插件开发者 |
| [04-workflow.md](04-workflow.md) | 贡献工作流、分支策略、Code Review 规范 | 贡献者 |
| [05-milestones.md](05-milestones.md) | 项目里程碑、阶段划分、验收标准 | 项目经理 |
| [06-decisions.md](06-decisions.md) | 架构决策记录(ADR) | 开发者/架构师 |
| [07-frontend-design-system.md](07-frontend-design-system.md) | 🎨 前端设计系统(Apple 风格 + 液态玻璃 + 布局审查) | 前端开发者/AI Agent |

## 快速导航

**我想...**
- 了解项目整体架构 → [01-architecture.md](01-architecture.md)
- 理解数据库设计 → [02-data-model.md](02-data-model.md)
- **开发一个新插件** → [03-plugin-system.md](03-plugin-system.md) ⭐
- 贡献代码 → [04-workflow.md](04-workflow.md)
- 查看开发进度 → [05-milestones.md](05-milestones.md)
- 了解技术决策理由 → [06-decisions.md](06-decisions.md)
- **开发前端界面** → [07-frontend-design-system.md](07-frontend-design-system.md) 🎨

## 与公众文档的关系

| 文档类型 | 位置 | 受众 | 内容风格 |
|---|---|---|---|
| **技术文档**(本目录) | `/tech/` | 开发者/AI Agent | 详细的技术细节、实现方案、设计理由 |
| **公众文档（规划）** | `/tech/zh-cn/` | 终端用户/开源贡献者 | 网站实现后再创建，只描述已验证功能 |
| **角色协作文档** | `/tech/roles/` | 团队内部 | PRD/测试报告/部署记录/安全审计 |

## 文档维护规范

- **代码变更 → 同步文档**:修改数据库/API/插件系统后,必须同步更新对应文档
- **新功能开发**:先更新本目录文档(技术方案),功能完成后写公众文档(使用教程)
- **文档即事实契约**:必须区分当前、已决定、规划、延后和历史；不得把设计写成已实现

详见 [agent.md](../agent.md) 的"文档维护契约"章节。
