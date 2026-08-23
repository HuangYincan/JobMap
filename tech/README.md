# 技术文档索引

本目录包含项目的核心技术与内部协作文档。项目已完成 Phase 2/3/4(多模式地图 + 真实招聘 catalog + 全国规模数据,已并入 `dev`),技术文档为**当前事实契约**;`00-*` 系列为历史报告,仅作背景参考。

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
| [08-multi-mode-system.md](08-multi-mode-system.md) | 多模式系统设计(Domain + Work) | 前端开发者/架构师 |
| [09-secondary-sidebar.md](09-secondary-sidebar.md) | 二级侧控栏设计规范 | 前端开发者 |
| [10-search-filter.md](10-search-filter.md) | 搜索筛选系统设计 | 前端开发者 |
| [11-phase2-plan.md](11-phase2-plan.md) | Phase 2 详细实施计划（已实施完成，历史计划记录） | 开发者 |
| [12-bundle-notes.md](12-bundle-notes.md) | Bundle 盘点(体积/分包) | 前端开发者 |
| [13-db-query-notes.md](13-db-query-notes.md) | 数据库查询笔记(索引/EXPLAIN) | DBA/后端 |
| [14-api-contract.md](14-api-contract.md) | Public / account API 契约 | 前后端开发者 |
| [15-deploy.md](15-deploy.md) | 本地部署 / runbook | 开发者/运维 |
| [16-bug-fixes.md](16-bug-fixes.md) | Bug 修复记录与回归口径 | 开发者 |
| [17-freshness-presentation-proposal.md](17-freshness-presentation-proposal.md) | 工作模式新鲜度呈现提案（已取代：tech/18 §A1；提案已存档，其数据口径为当前 catalog 口径） | 产品/前端 |
| [18-national-scale-plan.md](18-national-scale-plan.md) | 📌 全国规模工作模式 + 并行开发计划 | 架构师/开发者 |
| [19-company-labeling.md](19-company-labeling.md) | 公司打标:tier 可见性 + category 国标大类 | 数据/后端 |
| [20-development-plan.md](20-development-plan.md) | 持续开发计划(2026-08-17 起) | 开发者/项目经理 |
| [21-city-clustering.md](21-city-clustering.md) | 城市聚合(全国/省级视野密度管理) | 前端/后端 |
| [22-hangzhou-poi-local.md](22-hangzhou-poi-local.md) | 杭州 POI 本地化 + 高德省调用回退(Domain) | 前端/后端 |
| [23-map-engines.md](23-map-engines.md) | 多地图引擎(高德/腾讯/百度,切换与回退) | 前端/后端 |
| [24-agent-feature.md](24-agent-feature.md) | AI Agent 功能(自建引擎/三平台 MCP/动作协议/悬浮球) | 前端/后端 |
| [25-resend-email.md](25-resend-email.md) | Resend 验证码邮件(email OTP 真发:契约/重试/错误映射) | 后端 |
| [26-aliyun-sms.md](26-aliyun-sms.md) | 阿里云短信认证服务(phone OTP 真发:签名/错误映射/开通步骤) | 后端 |
| [30-agent-memory.md](30-agent-memory.md) | 用户个性化记忆(Agent Memory:表结构/注入预算/工具契约/隐私边界) | 后端 |
| [27-oauth-login.md](27-oauth-login.md) | 第三方登录(GitHub/Google/微信 OAuth:契约/手动配置/回退) | 后端 |
| [28-account-security.md](28-account-security.md) | 账号安全:密码/手机/邮箱管理、邮箱+密码登录(2026-08-22) | 后端 |
| [29-geocode-r5-status.md](29-geocode-r5-status.md) | geocode r5 状态与操作清单:城市中心假坐标修复链(基线/配额/import/UI 验证) | 数据/后端 |

## 快速导航

**我想...**
- 了解项目整体架构 → [01-architecture.md](01-architecture.md)
- 理解数据库设计 → [02-data-model.md](02-data-model.md)
- **开发一个新插件** → [03-plugin-system.md](03-plugin-system.md) ⭐
- 贡献代码 → [04-workflow.md](04-workflow.md)
- 查看开发进度 → [05-milestones.md](05-milestones.md) + [20-development-plan.md](20-development-plan.md)
- 了解技术决策理由 → [06-decisions.md](06-decisions.md)
- **开发前端界面** → [07-frontend-design-system.md](07-frontend-design-system.md) 🎨
- **了解全国规模计划** → [18-national-scale-plan.md](18-national-scale-plan.md) 📌
- **查 API 契约** → [14-api-contract.md](14-api-contract.md)
- **查 Bug 修复记录** → [16-bug-fixes.md](16-bug-fixes.md)
- **本地跑起来** → [15-deploy.md](15-deploy.md)

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
