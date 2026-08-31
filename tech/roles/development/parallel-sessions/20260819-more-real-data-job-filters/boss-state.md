# Boss State — more-real-data-job-filters

## meta
- slug: 20260819-more-real-data-job-filters
- date: 2026-08-19
- batch_dir: tech/roles/development/parallel-sessions/20260819-more-real-data-job-filters
- goal: ① 真实数据扩量(不只得物/智元/禾赛 3 家) ② 提高沪杭公司数量 ③ 岗位按职能分类 + 岗位筛选(得物 600+ 岗位需可筛选)
- owner: boss (main session)
- milestone_link: (无)

## stage
- current: VERIFY → NEXT (终态)
- updated_at: 2026-08-19

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws-data-feishu | feat/data-more-feishu | (已清理) | prompts/ws-data-feishu.md | reports/ws-data-feishu.md | MERGED | 7f0ff8d → 4f5598a | 2026-08-19 | 2026-08-19 | ✅ 21 租户 ~8800 portal 岗;plan 672/10642 0 issues;crawler 62 OK |
| ws-ui-job-filters | feat/ui-job-filters | (已清理) | prompts/ws-ui-job-filters.md | reports/ws-ui-job-filters.md | MERGED | 02d4405 → eca65bc | 2026-08-19 | 2026-08-19 | ✅ 366 tests / typecheck / docs-check;视觉冒烟:技术→17/23、+校招+「算法」→2/23 |

## merge_order
1. ws-data-feishu → 2. ws-ui-job-filters ✅ 均合并 (4f5598a, eca65bc), dev @ eca65bc 已 push

## adjudication_log
- 2026-08-19 | ws-data-feishu | worker 预算中断(爬取后台任务未完成, 仅提交配置) | boss 续作: 直接跑全量爬取 + 补爬蔚来/小鹏(--only + --max-jobs 5000) + 门禁 + 提交 | ✅ 全部落地

## deferred_notes
- 2026-08-19 | Env-only | radar 沪杭公司批量 geocode 落点(630 家雷达公司中上海 348/杭州 98,
  key 已配置;公司名歧义需人工审批 override/exclude;apply 待用户授权
  `npm run geocode:sites:apply -- --dry-run` 先行)。
- 2026-08-19 | Env-only | import:seed:apply(本批 21 家 drops 合入 dev,由用户执行)。

## next_plan
- 探索 ✅(前端筛选现状 + 数据扩展机会)
- 本批: ws-data-feishu(21 家 feishu 租户爬取) + ws-ui-job-filters(岗位级筛选 UI) 并行
- merge 后: 用户 import:seed:apply → geocode 落点(待授权) → 用户验收
- 后续批次: mokahr(142 家)/zhiye(138 家)/hotjob(42 家) 适配器(最大增量, 需评估 WAF 风险)

## recovery
- last_stage_written: PLAN (骨架)
- resume_history: (无)
