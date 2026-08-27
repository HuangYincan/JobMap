# 20 — 持续开发计划(2026-08-17 起)

> 本文件由主会话维护。**禁止提前结束任务**:完成一项,从「队列」取下一项,
> 维护文档 / SKILLS / 仓库提交,一切皆插件,改动前先计划。

## 主线 D:求职导航 Agent(P5,当前主线)

权威计划见 `tech/31-job-navigation-agent-plan.md`。P5 只覆盖 Work 模式的通勤约束找岗、
岗位/通勤对比和面试到达计划；逐向导航、后台定位与离开 App 后的主动提醒进入 P6。

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| D0 | 产品/技术/验收总计划 | ✅ 2026-08-27 | `tech/31`;含三主场景、ASCII 审批稿、指标与 workstream |
| D1 | 路线供应商、来源与隐私决策 | ⏳ 待执行 | 核对官方权限/条款/配额/坐标/缓存;决定事件是否持久化及留存 |
| D2 | provider-neutral 路线核心 | ⏸️ 等 D1 | Route Provider、estimate 降级、会话绑定 artifact、API 与错误矩阵 |
| D3 | Work/Navigation Agent 域工具 | ⏸️ 等 D2 | 岗位搜索/详情、路线、比较、通勤过滤、`showRoute` 受控动作 |
| D4 | 离线评测与产品分析 | ⏸️ 等 D3 | 30–50 案例、事件契约、漏斗 SQL、Python 指标报告 |
| D5 | 桌面/移动前端体验 | 🚫 等用户明确批准布局 | 路线 overlay、通勤筛选、比较/行程状态;批准前不得写前端代码 |
| D6 | 会话内主动建议与集成验收 | ⏸️ 等 D5 | 0 结果放宽、缺槽澄清、面试缓冲;三主场景端到端 100% |

## 主线 A:全国规模工作模式落地(tech/18 收尾)

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| A1 | 28 家名企打标审核 | ✅ 2026-08-17 用户确认 | tier 0–13, category 国标大类 |
| A2 | enterprise ~640 家批量打标 | ✅ 5 subagent 分片完成 | QA 统一漂移:京东/美团/拼多多/比亚迪/百度 → 4-6 |
| A3 | 写回 drops JSON(tier/category) | ✅ 681 文件 | import plan 0 issues / 0 dropped |
| A4 | QA 抽查 | ✅ `qa-labels.mjs` 全绿 | 覆盖率 668/668、锚点 0、变体 0 |
| A5 | 迁移 012 本地应用 + import:seed:apply | ✅ 2026-08-21 geocode-quota 批处理(配额短路 + 腾讯三级兜底;迁移 012 已随 `001`–`016` live apply) | ⚠️ site upsert 会覆盖 lng/lat:必须先 geocode 再 apply,否则 DB 杭州坐标被清空 |
| A6 | tech/19 命中统计 + tech/18 里程碑 | ✅ | 30 大类命中,other 仅 8 |
| A7 | 全国验收:DB 读路径 + LOD 全档 | ⏳ 待执行(2026-08-21 geocode-quota 批已解除配额阻塞:短路 + 腾讯兜底) | geocode:sites:apply → import:seed:apply → 验收 |
| A8 | **杭州 POI 本地化(tech/22)** | ✅ 2026-08-17 | 100.6 万行入库(`hz_pois` 迁移 013),杭州内零 AMap 调用,杭州外 1 次/滚动回退;无限滚动 50/批 cap 1000;详 `tech/22-hangzhou-poi-local.md` |

## 队列 B:已知遗留

| # | 任务 | 说明 |
|---|---|---|
| B1 | `isAlivePosition` 双实现合并 | ✅ 统一到 position-alive.ts(2026-08-17) |
| B2 | LLM 校验 817 条全量 | ✅ pass 82 / warn 724 / fail 10 / error 1;聚合行误判 fail 已修复(696 条归位) |
| B2.1 | 10 条 fail 数据修正 | ✅ 2026-08-18 | 移除 4 / 修正标题 3 / 保留聚合 3 / 重跑 1;重跑 813 条:86 pass / 718 warn / 8 fail / 1 error |
| B3 | 城市聚合(zoom ≤ 7) | ✅ 2026-08-19 批准并实现(触发阈值定为 zoom ≤ 8,见 `tech/21-city-clustering.md`) |
| B4 | category 前端消费(筛选/标签) | 打标完成后,插件式筛选器(等 B3 方向定后排期) |
| B5 | 聚合行拆解(696 条) | ✅ 拆解计划已生成(`split-plan-20260817.md`);执行拆解是数据修正,与 B2.1 一起排期 |
| B6 | 科大讯飞 error 单条 | ✅ 2026-08-18 | B2.1 全量重跑自动覆盖:`radar-b871edcdf925` 现为 warn(titleReal=true) |

## 队列 C:持续维护(2026-08-17 已完成)

- ✅ parallel-development skill:补充 bulk-labeling fan-out 模式
- ✅ agent.md:数据维护脚本表 + 打标指南指针
- ✅ CHANGELOG:WS1-4 合并 + tier 重做 + 打标记录
- ✅ tech/13、14、18、19 语义同步
- ✅ `.env.example` 补全(LLM 节 + 模板说明)
- ✅ `validation-report-*.json` 入 .gitignore
- 每完成一项:测试全绿 + `make docs-check` + `git diff --check` + conventional commit

## 当前阻塞与建议

1. **AMap 日配额**(10044):2026-08-21 geocode-quota 批已处理——`geocode-sites-apply.mjs`
   连续 5 站配额类失败自动短路(`QUOTA_EXHAUSTED` 退出),并新增腾讯 WebService 第三级兜底
   (AMap→百度→腾讯)。剩余站点下次运行续跑,幂等。A7 验收仍待执行:
   `npm run geocode:sites:apply` → `npm run import:seed:apply`。
2. **B3 城市聚合**:已批准并实现(2026-08-19,见 `tech/21-city-clustering.md`)。(B2.1 修正方案已于 2026-08-18 执行完毕)
