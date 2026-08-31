# Boss State — 20260825-poi-marker-resilience

## meta
- slug: 20260825-poi-marker-resilience
- date: 2026-08-25
- batch_dir: /Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-poi-marker-resilience
- goal: 修复 POI marker 生命周期 bug 批次 — 核心「检测删除后自动补回」+ 5 项健壮性(视口累积/epoch/DB伪装空结果/priceDesc排序/suggest缓存key)
- owner: boss (Yincan Huang)
- main_branch: dev (只发版不动 main;本次不涉及 main)
- main_repo: /Users/acccan/Repos/huangyincan/domain-map

## stage
current: MERGE (5/5 DONE, spawn merger)
updated_at: 2026-08-25

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a-marker-core | fix/poi-marker-autorestore | /Users/acccan/dm-wt-a-marker-core | prompts/a-marker-core.md | reports/a-marker-core.md | DONE | 6b82479 | 2026-08-25 07:22:10 | - | OK |
| b-marker-wiring | fix/poi-marker-wiring | /Users/acccan/dm-wt-b-marker-wiring | prompts/b-marker-wiring.md | reports/b-marker-wiring.md | DONE | 83155b9 | 2026-08-25 07:22:10 | - | OK(A先合后绿): typecheck 仅缺 a 契约符号, 签名已逐字核对 |
| c-viewport-guard | fix/viewport-epoch-guard | /Users/acccan/dm-wt-c-viewport-guard | prompts/c-viewport-guard.md | reports/c-viewport-guard.md | DONE | bdc032d | 2026-08-25 07:22:10 | - | OK |
| d-local-fallback | fix/local-poi-db-fallback | /Users/acccan/dm-wt-d-local-fallback | prompts/d-local-fallback.md | reports/d-local-fallback.md | DONE | d2c3c12 | 2026-08-25 07:22:10 | - | OK |
| e-search-suggest | fix/price-suggest-fixes | /Users/acccan/dm-wt-e-search-suggest | prompts/e-search-suggest.md | reports/e-search-suggest.md | DONE | 84cd0c5 | 2026-08-25 07:22:10 | - | OK |

## merge_order
1. a-marker-core (定义契约: setPOIs opts / sync() / isAttached)
2. b-marker-wiring (消费契约, 依赖 a)
3. c-viewport-guard (独立)
4. d-local-fallback (独立)
5. e-search-suggest (独立)
(任一红则停, 红停分支由 ADJUDICATE 处理)

## adjudication_log
(空)

## deferred_notes
见 deferred-notes.md (口径 2 项 / 设计不改 1 项 / 观察 1 项)

## next_plan
- milestone: 本目标 = 单一批次(6 个 bug)
- 剩余步骤: DISPATCH → COLLECT → ADJUDICATE(如有) → MERGE → VERIFY → 总汇报
- 下一步: 预建 5 个 worktree + node_modules symlink → 并行 spawn 5 worker

## recovery
last_stage_written: DISPATCH
resume_history: (无)

## adjudication_log (追加)
- 2026-08-25 | c-viewport-guard | epoch 捕获时机:prompt 写「load 开始捕获」但 +1 在 hook 中段,若 load 开头捕获会被自身 +1 判过期 | 自裁接受:改为 +1 之后立即捕获(本世代=本次刷新),契约测试固化 | OK

## adjudication_log (追加)
- 2026-08-25 | b-marker-wiring | 门禁 FAILED 仅因 typecheck 缺 a 契约符号(a 未合并),非本分支缺陷 | 自裁:不重派;按 manifest 先合 a 再合 b,merger 在 b 合并门禁中验证 | OK

## final (2026-08-25)
- stage: FINISHED — 5/5 DONE, MERGE ALL_GREEN (fd45824), VERIFY 绿 (boss 亲跑: 1631 tests/1629 pass/0 fail/2 skip; typecheck; docs-check; diff --check)
- dev == origin/dev == fd45824; worktrees 已清理; 无 main 参与, 无 PR
- deferred 见 deferred-notes.md (口径 2 / 设计不改 1 / 观察 2)
