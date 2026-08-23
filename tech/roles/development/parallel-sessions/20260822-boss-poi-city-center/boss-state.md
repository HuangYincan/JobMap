# Boss State — poi-city-center

## meta
- slug: 20260822-boss-poi-city-center
- date: 2026-08-22
- batch_dir: tech/roles/development/parallel-sessions/20260822-boss-poi-city-center
- goal: 修复「大量 POI 位于城市中心」——中心假坐标站落真实办公坐标
- owner: boss (main tree 17cb454, dev)
- milestone_link: tech/18-national-scale-plan.md (工作模式数据质量)

## stage
- current: DONE(终态)
- updated_at: 2026-08-22T08:15+08:00

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a | fix/grader-seq-relax | /Users/acccan/dm-wt-pcc-a | prompts/ws-a.md | reports/ws-a.md | DONE | 62626f4 | 2026-08-22T07:35+08:00 | 2026-08-22T07:49+08:00 | 门禁 FAILED(2 失败=dev 既有 r4 契约,ws-b 修)/结论 OK,boss 验证后裁决 DONE |
| b | fix/data-contract-r4-sync | /Users/acccan/dm-wt-pcc-b | prompts/ws-b.md | reports/ws-b.md | DONE | cf735b8 | 2026-08-22T07:35+08:00 | 2026-08-22T07:50+08:00 | 门禁 PASSED/结论 OK(存根 git rm 由 boss 完成 cf735b8) |
| c | fix/geocode-r5-readiness | /Users/acccan/dm-wt-pcc-c | prompts/ws-c.md | reports/ws-c.md | DONE | 0b49a8c | 2026-08-22T07:35+08:00 | 2026-08-22T07:49+08:00 | 门禁 PASSED/结论 OK(汇报环节丢失,boss 亲验补写) |

## merge_order
1. ws-a → 2. ws-b → 3. ws-c(独立为主,a→b→c 顺序)

## adjudication_log
2026-08-22T07:50 | ws-b | 沙箱拦截 git rm/zz-w9 存根无法移除 | boss 主会话执行 git rm + commit cf735b8,重命名清理完成 | 已解
2026-08-22T08:05 | ws-a | 门禁 FAILED: 2 失败为 dev 既有 split-city-sites/drops-coordinate-consistency r4 契约(ws-b 分支已修,未合并) | boss 亲验:ws-a worktree 单独跑 24 tests / 2 fail 与主树同源;非 ws-a 引入。裁决 DONE,合并 ws-b 后全绿,merger 门禁兜底 | 已解
2026-08-22T08:05 | ws-a | 问题2「两者都空不允许」未采纳 | worker 理由充分(既有测试+方向矛盾+依赖破坏),采纳 worker 判断,保留精确同名 strong | 已解
2026-08-22T08:05 | ws-a | 问题3 边界外测试更新(geocode-address-first 2 处) | 预授权条款,已列出,批准 | 已解
2026-08-22T08:05 | ws-a | 问题4 智图案例口径(裸百度 vs 百度智图) | worker 判断正确,保持 2026-08-19 防线,批准 | 已解
2026-08-22T08:05 | ws-c | 汇报环节丢失(分支已有 2 commit,log 空) | boss 亲验门禁(npm test/typecheck/docs-check/diff-check 全过)+ 通读 tech/29 + 实测 audit 脚本(1092/249/5 与 manifest 一致),补写 report | 已解


## deferred_notes
见 deferred-notes.md(Env-only: geocode r5 apply / import:seed:apply / MODE_CACHE_VERSION bump;数据口径: 无坐标站、海外站)

## next_plan
1. ✅ DISPATCH 3 ws → 2. ✅ COLLECT → 3. ✅ ADJUDICATE → 4. ✅ MERGE(ALL_GREEN, dev HEAD 2bc21d6, 已 push)→ 5. ✅ VERIFY(25/25 契约绿,1420 pass/0 fail/2 skip)
6. **剩余(Env-only, 用户执行)**:geocode r5 apply → import:seed:apply → UI 验证 + MODE_CACHE_VERSION bump(见 deferred-notes.md 与 tech/29)

## recovery
- last_stage_written: DONE(终态)
- resume_history: -
