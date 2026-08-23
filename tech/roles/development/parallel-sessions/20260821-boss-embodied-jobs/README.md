# 20260821-boss-embodied-jobs — 新增岗位数据源(Embodied-AI 岗位列表)

## 目标

新增工作模式数据源 `embodied-jobs`:github.com/Octoday-Hub/Embodied-AI `topics/02-jobs.md`(具身智能行业岗位聚合列表,2026-08-21 快照 **538** 个机会:国内 354 / 海外 85 / 专项 99)。纯解析任务——信息全部在快照内,**零网络抓取**、无登录/验证码/反爬问题。

## 数据源事实(2026-08-21 核)

- URL: `https://github.com/Octoday-Hub/Embodied-AI/blob/main/topics/02-jobs.md`
- Raw: `https://raw.githubusercontent.com/Octoday-Hub/Embodied-AI/main/topics/02-jobs.md`
- 快照: `<batch>/source/embodied-02-jobs.md`(400,992 bytes; sha256 `d862c540ed3d7ee7c0ed53dd2dbfb2b3798de6fa50b07fd45891df2e804d79ff`)
- 结构: HTML table(rowspan 公司行 + 每岗一行),5 列 = 公司/岗位/类型(社招·校招·实习)/地点/投递(每行一个 `<a href>` 投递链接)
- 三节: `## 国内机会`(line 13)/ `## Overseas Opportunities`(line 2308)/ `## 人才计划`(line 2943);`## HR专属通道`(line 3674)无岗位,跳过
- 授权: 仓库 API `license: null`(**无 LICENSE 文件**,社区维护列表);按「published-github-file」记入 SOURCE_META 与 data-sources 注册表
- 类型列 → JobFamily 直接映射: 社招→`social` 校招→`campus` 实习→`intern`

## Workstream 表

| ws | 分支 | worktree | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|---|
| ws1 | `feature/embodied-jobs-data` | `../dm-wt-embd-a` | 解析脚本 + drops 生成(新公司 embj-*,同名现有公司追加 positions) | `server/scripts/extract-embodied-jobs.mjs`(新增)、`server/data/recruitment/embodied-jobs/**`(新增)、`server/data/recruitment/{radar,official-career,qqdoc-official,qqdoc-jobs}/**`(仅追加 positions/sources 字段)、`server/tests/`(extract + drops 校验测试) | `server/src/**`、`tech/`、`db/` |
| ws2 | `feature/embodied-jobs-source` | `../dm-wt-embd-b` | fileDropAdapter 适配器 + 注册 + 测试(fixture)+ ETL 文档 + data-sources 注册表 | `server/src/lib/recruitment-adapters/embodied-jobs.ts`(新增)、`server/src/lib/recruitment-source.ts`(+kind)、`server/src/lib/recruitment-import.ts`(+SOURCE_META)、`server/tests/`(adapter 测试,fixture 自包含)、`tech/roles/data/etl/embodied-jobs.md`(新增)、`tech/roles/data/data-sources.md`(+行)、`server/README.md`(测试计数,若变) | `server/data/recruitment/**`、`tech/` 其余、`db/` |

## 合并顺序

1. `feature/embodied-jobs-data`(ws1 — 数据先行)
2. `feature/embodied-jobs-source`(ws2 — 消费方后合并)

## 冲突备忘(与在飞批次)

- `server/src/lib/recruitment-source.ts` / `recruitment-import.ts`:在飞 `feat/qqdoc-jobs-source` 分支同改(kind union + SOURCE_META 条目)→ 合并时保留双方条目。
- `server/data/recruitment/{radar,official-career,qqdoc-official,qqdoc-jobs}/**`:两个批次都可能在同名公司 drop 上追加 positions → JSON 冲突时保留双方 positions 数组,不丢数据。
- 主工作树有未提交残留(在飞批次的 drops 等),与本批次无关,勿动。

## 门禁(每个 WS)

worktree 内:`cd server && npm test`(基线 568:566 pass / 2 skip)、`npm run typecheck`、`make docs-check`、`git diff --check`。

## 状态

- [ ] ws1 DISPATCH → DONE → MERGED
- [ ] ws2 DISPATCH → DONE → MERGED
- [ ] dev 合并 + push(门禁绿自动)
- [ ] 验证(测试数 / drops 校验 / 抽验)

## Env-only 待办(见 deferred-notes.md)

- `npm run import:seed:apply`(需 DATABASE_URL)落地 embodied-jobs 到 Postgres
- AMap geocode(需 AMAP_WEB_KEY)补职场坐标
