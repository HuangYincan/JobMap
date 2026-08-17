# 20 — 持续开发计划(2026-08-17 起)

> 本文件由主会话维护。**禁止提前结束任务**:完成一项,从「队列」取下一项,
> 维护文档 / SKILLS / 仓库提交,一切皆插件,改动前先计划。

## 主线 A:全国规模工作模式落地(tech/18 收尾)

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| A1 | 28 家名企打标审核 | ✅ 2026-08-17 用户确认 | tier 0–13, category 国标大类 |
| A2 | enterprise ~640 家批量打标 | 🔄 进行中 | 按 industries 规则 + 公司名微调,分批产出映射 JSON |
| A3 | 写回 drops JSON(tier/category) | ⏳ | 脚本更新 668 个文件;import plan 校验全过 |
| A4 | QA 抽查(subagent 交叉验证) | ⏳ | 随机 50 家复核 tier/category 合理性 |
| A5 | 迁移 012 本地应用 + import:seed:apply(用户) | ⏳ | 本地幂等验证;seed 落库留用户执行 |
| A6 | tech/19 §2.1 命中统计回填 + tech/18 里程碑勾选 | ⏳ | 文档维护契约 |
| A7 | 全国验收:多城市 DB 读路径 + LOD 全档验证 | ⏳ | 依赖 A5 geocode 配额 |

## 队列 B:已知遗留

| # | 任务 | 说明 |
|---|---|---|
| B1 | `isAlivePosition` 双实现合并 | freshness.ts vs position-alive.ts(语义一致,早 00:30 时刻截止边缘分歧,SQL 路径为权威) |
| B2 | LLM 校验跑首批 181 条 | ✅ 2026-08-17 全量 817 条跑完(pass 82 / warn 724 / fail 10 / error 1);修复聚合行误判 fail(696 条归位 warn)。**剩余:10 条 fail 数据修正(见 B2.1)** |
| B2.1 | 10 条 fail 数据修正(用户决策) | 门户入口类(megvii/tigermed)→ 建议移除;计划/项目名类(度小满/申万宏源/曼伦)→ 保留或拆解;描述性标题(l-e-k/中信南华/奇安信/学而思网校)→ 修正或移除;硬伤(博世智驾 applyUrl=wjx.cn 问卷星)→ 移除或修 applyUrl;科大讯飞 error=LLM 空响应,重跑覆盖 |
| B3 | 全国级城市聚合展示(tech/18 预留) | zoom < 4 时按城市聚合计数,点击下钻 |
| B4 | category 前端消费(筛选/标签) | 打标完成后,插件式筛选器 |
| B5 | crawler 新城市 drops 校准 | WS2 之后新增公司入表 |

## 队列 C:持续维护

- 每完成一项:测试全绿 + `make docs-check` + `git diff --check` + conventional commit
- 文档 / SKILLS 与实现同步(agent.md、tech/、.claude/skills/)
- 一切皆插件:新功能先找「插件缝」,不写死主流程
