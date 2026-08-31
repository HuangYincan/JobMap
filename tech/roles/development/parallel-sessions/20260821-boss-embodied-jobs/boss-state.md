# Boss State — embodied-jobs

## meta

- slug: `20260821-boss-embodied-jobs`
- date: 2026-08-21
- batch_dir: `tech/roles/development/parallel-sessions/20260821-boss-embodied-jobs`
- goal: 新增岗位数据源 embodied-jobs(github.com/Octoday-Hub/Embodied-AI topics/02-jobs.md 快照,538 机会)→ drops + adapter + 注册 + 文档
- owner: boss
- milestone_link: 无(独立批次)

## stage

current: VERIFY_DONE / 终态(2026-08-21, 全部 WS 合并 + push + 独立复核全绿)
updated_at: 2026-08-21

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws1 | feature/embodied-jobs-data | /Users/acccan/dm-wt-embd-a | prompts/ws1.md | reports/ws1.md | MERGED | b22379c | 2026-08-21 | 2026-08-21 | 门禁绿;并入 dev(1af75a6)+ push |
| ws2 | feature/embodied-jobs-source | /Users/acccan/dm-wt-embd-b | prompts/ws2.md + ws2-followup.md | reports/ws2.md | MERGED | 4f870e2 | 2026-08-21 | 2026-08-21 | 首合红→裁决修复→重合并绿(b83c1d5)+ push |

## merge_order

1. feature/embodied-jobs-data(ws1 — 已并入 dev 并 push)
2. feature/embodied-jobs-source(ws2 — FOLLOWUP 修复后重新合并)

## adjudication_log

- 2026-08-21 | ws2 | 合并后门禁红:`cloneCompany` 对 `[...undefined]` spread 抛 TypeError(industries 必填但 validateSourceCompany 不查;裸 fileDropAdapter 零归一化;fixture 恰带 industries 掩盖缺口;drops 精简是有意为之) | 技术问题自裁:适配器层用 `industriesOf(name)` 补齐 + 审计其余必填字段 + fixture 改真实形状 + 加走 dedupe/cloneCompany 路径的回归测试;drops 不碰 | 续作重派 ws2(ws2-followup.md)

## deferred_notes

| ts | 类型 | 内容 |
|---|---|---|
| 2026-08-21 | Env-only | `npm run import:seed:apply`(需 DATABASE_URL)落地 embodied-jobs 数据到 Postgres;AMap geocode(需 AMAP_WEB_KEY)补职场坐标——均不自动跑 |
| 2026-08-21 | 口径 | 跨源同名公司(embj-* vs qqj-*/radar 等)在 catalog 层的去重统一,后续处理;本批次按先例:同名追加 positions,不建重复 drop |

## next_plan

- [x] [M1] ws1+ws2 并行 DISPATCH → COLLECT → ADJUDICATE(ws2 集成缺口裁决)
- [x] [M2] 全部绿 → merger 两轮(ws1 首轮绿;ws2 首合红→fix→重合绿)→ dev 合并 + push
- [x] [M3] VERIFY:独立跑全套件 756/754 pass/0 fail/2 skip;drops 47 文件 + 归一化适配器均在 origin/dev
- 里程碑全部完成 → 目标完成,终态。SCAN 不发起(无用户要求,且并发的 map-engine/avatar 批次活跃,本批无遗留质量疑点)

## recovery

- last_stage_written: DISPATCH(ws1 重派后)
- resume_history:
  - 2026-08-21 08:20 | ws1 首次派发日志在「Let me write the extraction script.」后中断,exit 0,分支零 commit、无报告 → 判定中断,幂等重派(同 worktree/分支,worker 开工前对账确认从零开始)
  - 2026-08-21 | ws2 仍在运行(log 0 字节,等待其完成通知)
