# Boss State — poi-datasource

## meta
- slug: 20260823-boss-poi-datasource
- date: 2026-08-23
- batch_dir: tech/roles/development/parallel-sessions/20260823-boss-poi-datasource
- goal: 完善公司岗位 POI 数据源——中心假坐标(上海 344 站)落真实办公坐标,扩展海外数据源,让 Env-only r5 可正确、快、多日执行
- owner: boss (main tree dda9555, dev)
- milestone_link: tech/18-national-scale-plan.md (工作模式数据质量) + tech/29-geocode-r5-status.md

## stage
- current: DONE(终态)
- updated_at: 2026-08-23T12:05+08:00

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a | fix/poi-citylist-branch | /Users/acccan/dm-wt-pds-a | prompts/a.md | reports/a.md | DONE | aebbc1e | 2026-08-23T11:32+08:00 | 2026-08-23T11:41+08:00 | 门禁 PASSED/结论 OK(1489 tests,audit 基线不变) |
| b | feat/poi-nominatim | /Users/acccan/dm-wt-pds-b | prompts/b.md | reports/b.md | DONE | 75de386 | 2026-08-23T11:32+08:00 | 2026-08-23T11:52+08:00 | 门禁 PASSED/结论 OK(5 commits,Nominatim 集成) |
| c | feat/poi-daily-run | /Users/acccan/dm-wt-pds-c | prompts/c.md | reports/c.md | DONE | fe228d9 | 2026-08-23T11:32+08:00 | 2026-08-23T11:47+08:00 | 门禁 PASSED/结论 OK(进度文件已 gitignore) |
| d | docs/poi-r5-runbook | /Users/acccan/dm-wt-pds-d | prompts/d.md | reports/d.md | DONE | 3722c87 | 2026-08-23T11:32+08:00 | 2026-08-23T11:45+08:00 | 门禁 PASSED/结论 OK(文档按 prompt 能力描述,合并后需抽验一致性) |

## merge_order
1. ws-a(多城市列表串判定,基础)→ 2. ws-b(海外路由,复用 a)→ 3. ws-c(进度记录,独立)→ 4. ws-d(文档,收全部事实,最后)

## adjudication_log
(空)

## deferred_notes
| ts | 类型 | 内容 |
|---|---|---|
| 2026-08-23 | Env-only | geocode r5 apply 全量(1076 站,三 provider 各 ~100 次/日,约 4 天,每天跑至 QUOTA_EXHAUSTED 短路;建议 --cities 上海 优先) |
| 2026-08-23 | Env-only | import:seed:apply(r5 后;DB 1556→对齐 JSON,用户 UI 所见才更新) |
| 2026-08-23 | Env-only | UI 验证 + MODE_CACHE_VERSION bump(import 后) |
| 2026-08-23 | Env-only | Nominatim 海外站实际执行(r5 后按 runbook) |

## next_plan
1. ✅ PLAN(摸底:1330 中心钉点/上海 344/needsRerun 1076/三 key 齐备/配额事实)→ 2. ✅ LAYOUT(无 UI)→ 3. ✅ DISPATCH(4 ws)→ 4. ✅ COLLECT(4/4 绿)→ 5. ✅ ADJUDICATE(无)→ 6. ✅ MERGE(ALL_GREEN,dev HEAD 72cf016,已 push)→ 7. ✅ VERIFY(1509 tests/0 fail/2 skip;4 分支 merge 无冲突;worktree 已清;文档-代码一致性抽验通过)
8. **剩余(Env-only,用户执行)**:r5 apply 多日(~4 天,`npm run geocode:sites:daily` 或 `geocode:sites:apply --cities 上海` 优先)→ import:seed:apply → UI 验证 + MODE_CACHE_VERSION v18 → Nominatim 海外执行(见 tech/29 v2.0 runbook 与 deferred-notes.md)

## recovery
- last_stage_written: DONE(终态)
- resume_history: -
