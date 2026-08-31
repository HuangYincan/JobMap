# Boss State — 20260822-boss-saved-layer-mutex

## meta
- slug: 20260822-boss-saved-layer-mutex
- date: 2026-08-22
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-mutex
- goal: 收藏图层互斥语义 —— 开:地图只显示收藏点 + Explore 列表切收藏;关:恢复搜索管线(用户当面决策:地图+列表都切)
- owner: boss (supervised loop)
- milestone_link: n/a

## stage
- current: NEXT → 终态(目标完成)
- updated_at: 2026-08-22

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws-1 | fix/saved-layer-mutex | ../dm-wt-saved-mutex | prompts/ws-1.md | reports/ws-1.md | MERGED | 3dd619a(merge) | 2026-08-22 | 2026-08-22 | ✅ 全绿(1149 pass/2 skip/0 fail) |

## merge_order
1. ws-1(唯一,豁免版 instructions 二次派发后合并成功)

## adjudication_log
- 2026-08-22 | 前批次 | 用户反馈「收藏图层开关没区别」 | Explore 判定:叠加语义实现正常(去重并集+同样式),互斥语义从未实现;非 bug → 新批次实现互斥(用户当面决策地图+列表都切) | ✅ 本批已实现
- 2026-08-22 | ws-1 | merger preflight BLOCKED:主树残留 蔚来.json(Env-only geocode 产物,用户所有)+ next-env.d.ts(生成噪音) | **裁决**:蔚来.json 去留为数据口径问题→deferred;merge 技术可行(分支改动与蔚来.json 零重叠)→豁免版 instructions(还原 next-env.d.ts,蔚来.json 原样保留不触碰),重派 merger | 待 merger v2

## deferred_notes
- 2026-08-22 | Env-only/数据口径 | 主工作树残留 `server/data/recruitment/official-career/蔚来.json`(M):2 条职位 AMap geocode 产物(lng/lat,定海凯虹广场/丽水万地广场),用户所有,本批未触碰;是否提交入库由用户/数据批次裁决(merger preflight 曾因它 BLOCKED,豁免后 merge 已放行)

## next_plan
- ✅ PLAN → DISPATCH → COLLECT → ADJUDICATE(merger preflight 残留豁免)→ MERGE(豁免版 v2 全绿)→ VERIFY 抽验通过
- ✅ dev HEAD 3dd619a,已 push origin dev(c5dd6fd..3dd619a);记忆已更新(saved-overlay-is-a-layer → 互斥模式)
- 🏁 **目标完成,批次终态。无剩余里程碑,无 main 目标(无 PR)。**

## recovery
- last_stage_written: NEXT(终态)
- resume_history: 2026-08-22 | merger v1 preflight BLOCKED(主树残留 蔚来.json Env-only geocode 产物 + next-env.d.ts 噪音)→ boss 裁决:豁免版 instructions v2(蔚来.json 不触碰、next-env.d.ts 还原)→ 重派 merger 成功 MERGED_ALL。蔚来.json 待用户/数据批次裁决(记 deferred_notes)
