# 20 — 持续开发计划(2026-08-17 起)

> 本文件由主会话维护。**禁止提前结束任务**:完成一项,从「队列」取下一项,
> 维护文档 / SKILLS / 仓库提交,一切皆插件,改动前先计划。

## 主线 A:全国规模工作模式落地(tech/18 收尾)

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| A1 | 28 家名企打标审核 | ✅ 2026-08-17 用户确认 | tier 0–13, category 国标大类 |
| A2 | enterprise ~640 家批量打标 | ✅ 5 subagent 分片完成 | QA 统一漂移:京东/美团/拼多多/比亚迪/百度 → 4-6 |
| A3 | 写回 drops JSON(tier/category) | ✅ 681 文件 | import plan 0 issues / 0 dropped |
| A4 | QA 抽查 | ✅ `qa-labels.mjs` 全绿 | 覆盖率 668/668、锚点 0、变体 0 |
| A5 | 迁移 012 本地应用 + import:seed:apply | 🔄 **卡 AMap 配额(10044,2026-08-17 仍未重置)** | ⚠️ site upsert 会覆盖 lng/lat:必须先 geocode 再 apply,否则 DB 杭州坐标被清空 |
| A6 | tech/19 命中统计 + tech/18 里程碑 | ✅ | 30 大类命中,other 仅 8 |
| A7 | 全国验收:DB 读路径 + LOD 全档 | ⏳ 依赖 A5 | geocode 配额重置后:geocode:sites:apply → import:seed:apply → 验收 |
| A8 | **杭州 POI 本地化(tech/22)** | ✅ 2026-08-17 | 100.6 万行入库(`hz_pois` 迁移 013),杭州内零 AMap 调用,杭州外 1 次/滚动回退;无限滚动 50/批 cap 1000;详 `tech/22-hangzhou-poi-local.md` |

## 队列 B:已知遗留

| # | 任务 | 说明 |
|---|---|---|
| B1 | `isAlivePosition` 双实现合并 | ✅ 统一到 position-alive.ts(2026-08-17) |
| B2 | LLM 校验 817 条全量 | ✅ pass 82 / warn 724 / fail 10 / error 1;聚合行误判 fail 已修复(696 条归位) |
| B2.1 | 10 条 fail 数据修正 | ⏳ **方案表已出(`fix-plan-20260817.md`),等用户拍板**:移除 4 / 修正标题 3 / 保留聚合 3 / 重跑 1 |
| B3 | 城市聚合(zoom ≤ 7) | ⏳ **方案 + ASCII 布局图已出(`tech/21-city-clustering.md`),等用户批准后实现** |
| B4 | category 前端消费(筛选/标签) | 打标完成后,插件式筛选器(等 B3 方向定后排期) |
| B5 | 聚合行拆解(696 条) | ✅ 拆解计划已生成(`split-plan-20260817.md`);执行拆解是数据修正,与 B2.1 一起排期 |
| B6 | 科大讯飞 error 单条 | 下次全量校验自动覆盖(LLM 空响应) |

## 队列 C:持续维护(2026-08-17 已完成)

- ✅ parallel-development skill:补充 bulk-labeling fan-out 模式
- ✅ agent.md:数据维护脚本表 + 打标指南指针
- ✅ CHANGELOG:WS1-4 合并 + tier 重做 + 打标记录
- ✅ tech/13、14、18、19 语义同步
- ✅ `.env.example` 补全(LLM 节 + 模板说明)
- ✅ `validation-report-*.json` 入 .gitignore
- 每完成一项:测试全绿 + `make docs-check` + `git diff --check` + conventional commit

## 当前阻塞与建议

1. **AMap 日配额**(10044):WS2 今天跑超;预计次日重置。重置后立即:
   `npm run geocode:sites:apply` → `npm run import:seed:apply` → A7 验收。
2. **等用户拍板**:B2.1 修正方案、B3 城市聚合布局图。
