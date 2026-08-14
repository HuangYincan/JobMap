# 角色协作文档体系

本目录按照现代化互联网公司的角色分工,组织项目协作文档。

## 角色划分

| 角色 | 职责 | 文档类型 |
|---|---|---|
| 产品经理(Product) | 需求管理/优先级排序/用户研究 | PRD/路线图/竞品分析 |
| 开发(Development) | 功能实现/架构设计 | 技术方案/实施记录 |
| 测试(Testing) | 质量保障/Bug 管理 | 测试计划/Bug 报告 |
| 运维(Operations) | 部署/监控/故障处理 | 部署记录/故障复盘 |
| 安全(Security) | 安全审计/渗透测试 | 安全报告/修复方案 |
| 数据(Data) | 数据质量/ETL 管道 | 数据文档/清洗记录 |

## 目录结构

```
roles/
├── README.md                        # 本文档
├── product/                         # 产品经理
│   ├── README.md                    # 产品文档索引
│   ├── PRD/                         # 产品需求文档
│   │   ├── 01-mvp-recruitment.md
│   │   ├── 02-user-profile.md
│   │   └── 03-recommendation.md
│   ├── roadmap.md                   # 产品路线图
│   └── user-research/               # 用户研究
│       └── target-users.md
├── development/                     # 开发
│   ├── README.md
│   ├── architecture/                # 架构文档(链接到 DOCS/)
│   ├── implementation/              # 实施记录
│   │   ├── phase-0.md               # P0 实施记录
│   │   ├── phase-1.md
│   │   └── phase-2.md
│   └── code-review/                 # Code Review 记录
│       └── review-checklist.md
├── testing/                         # 测试
│   ├── README.md
│   ├── test-plans/                  # 测试计划
│   │   ├── unit-test-plan.md
│   │   └── e2e-test-plan.md
│   ├── test-reports/                # 测试报告
│   │   ├── bug-reports.md           # Bug 汇总
│   │   └── coverage-report.md
│   └── qa-checklist.md              # 上线检查清单
├── operations/                      # 运维
│   ├── README.md
│   ├── deployment/                  # 部署文档
│   │   ├── vps-deployment.md
│   │   └── release-checklist.md
│   ├── monitoring/                  # 监控
│   │   ├── metrics.md               # 关键指标
│   │   └── incident-log.md          # 故障记录
│   └── runbook.md                   # 运维手册
├── security/                        # 安全
│   ├── README.md
│   ├── red-team/                    # 红队(攻击)
│   │   ├── penetration-test.md
│   │   └── vulnerability-scan.md
│   ├── blue-team/                   # 蓝队(防御)
│   │   ├── security-hardening.md
│   │   └── incident-response.md
│   └── security-audit.md            # 安全审计报告
└── data/                            # 数据
    ├── README.md
    ├── data-sources.md              # 数据源清单
    ├── etl/                         # ETL 管道文档
    │   └── recruitment-pipeline.md
    └── data-quality.md              # 数据质量报告
```

## 协作流程示例

### 新功能开发

1. **产品经理**写 PRD → `product/PRD/04-commute-analysis.md`
2. **开发**读 PRD → 写技术方案 → `development/implementation/phase-5.md`
3. **开发**实现功能 → 提交 PR
4. **测试**根据 PRD 写测试用例 → 执行测试 → 记录 Bug → `testing/test-reports/bug-reports.md`
5. **开发**修 Bug → 再测试
6. **运维**部署到生产 → 记录 → `operations/deployment/release-v1.0.md`
7. **运维**监控指标 → `operations/monitoring/metrics.md`

### 故障处理

1. **运维**发现故障 → 记录 → `operations/monitoring/incident-log.md`
2. **开发**排查原因 → 修复 → 记录 → `development/implementation/hotfix-xxx.md`
3. **运维**复盘 → 改进 → `operations/incident-postmortem.md`

## 文档维护规范

### 何时更新角色文档

| 事件 | 更新文档 | 负责角色 |
|---|---|---|
| 产品需求确定 | `product/PRD/*.md` | 产品经理 |
| 开始实现功能 | `development/implementation/phase-X.md` | 开发 |
| 遇到技术问题 | 同上,记录到"遇到的问题"章节 | 开发 |
| 发现 Bug | `testing/test-reports/bug-reports.md` | 测试 |
| 部署到生产 | `operations/deployment/release-vX.X.md` | 运维 |
| 发生故障 | `operations/monitoring/incident-log.md` | 运维 |
| 安全漏洞 | `security/red-team/vulnerability-scan.md` | 安全 |
| 数据质量问题 | `data/data-quality.md` | 数据 |

### 文档模板

每个角色目录下的 `README.md` 提供文档模板和示例。

## 与其他文档的关系

| 文档类型 | 位置 | 受众 | 特点 |
|---|---|---|---|
| **技术文档** | `/DOCS/` | 开发者/AI Agent | 详细技术实现,架构设计 |
| **公众文档** | `/docs/zh-cn/` | 终端用户 | 使用教程,功能说明 |
| **角色文档**(本目录) | `/docs/roles/` | 团队内部 | 协作记录,过程文档 |

**协作原则**:
- 技术决策记录在 `DOCS/06-decisions.md`(ADR)
- 产品需求记录在 `product/PRD/`
- 实施过程记录在 `development/implementation/`
- 测试结果记录在 `testing/test-reports/`

## 适用于 AI Agent

本文档体系专为 **AI 驱动的开发流程** 设计:

- **主 Agent**:统筹全局,分配任务给子 Agent
- **产品 Agent**:读 PRD,规划功能
- **开发 Agent**:实现功能,记录到 `implementation/`
- **测试 Agent**:执行测试,记录 Bug
- **运维 Agent**:部署监控,记录故障

每个 Agent 工作前后维护对应角色的文档,形成**可追溯的协作记录**。

## 下一步

查看各角色的 `README.md`:
- [product/README.md](product/README.md) - 产品经理文档指南
- [development/README.md](development/README.md) - 开发文档指南
- [testing/README.md](testing/README.md) - 测试文档指南
- [operations/README.md](operations/README.md) - 运维文档指南
- [security/README.md](security/README.md) - 安全文档指南
- [data/README.md](data/README.md) - 数据文档指南
