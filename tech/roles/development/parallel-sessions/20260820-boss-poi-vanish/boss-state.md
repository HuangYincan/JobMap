# Boss State — 20260820-boss-poi-vanish

## meta
- slug: 20260820-boss-poi-vanish
- date: 2026-08-20
- batch_dir: tech/roles/development/parallel-sessions/20260820-boss-poi-vanish
- goal: 修复「第一次点击公司 POI → 地图先回默认初始化位置(杭州)→ 所有 POI 消失」
- owner: boss (Claude Code 主会话)

## stage
- current: DONE(终态)
- updated_at: 2026-08-20

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws-poi-vanish | fix/poi-first-click-camera | /Users/acccan/dm-wt-poi-vanish | prompts/ws-poi-vanish.md | reports/ws-poi-vanish.md | MERGED | 1760395 | 2026-08-20 | 2026-08-20 | OK → dev cd360dd |

## merge_order
1. ws-poi-vanish(MERGED_ALL,已 push;dev = origin/dev = cd360dd)

## adjudication_log
- <2026-08-20> | PLAN | Explore 根因:hasInteractedRef 抑制 settle 相机 + distance 圆心错 + handleLocate 失败兜底 | 单 WS 修复三个根因(worker 改 hasInteractedRef→userMovedMapRef 收窄写点) | 通过

## deferred_notes
- 聚合徽章下钻城市行政中心 = 设计行为,不修

## next_plan
- 已完成:PLAN → DISPATCH → COLLECT(OK,3 commits)→ MERGE(cd360dd)→ **VERIFY 浏览器实测 3 场景全部通过**:
  ① settle 成功 + 首点点击(6s 延迟,双重确认):相机飞到用户位置上海 [121.475,31.228] zoom 15,pins 107→108 不消失(修复前:永停杭州)
  ② settle 失败路径(3s/5s 延迟,相机停杭州):pins 保持 107 不消失
  ③ handleLocate 失败:相机保持拖动后视野 [119.8685,30.1056],不回杭州默认
- 批次目录入库 + push 待收尾(即本状态写入后执行)

## recovery
- last_stage_written: DONE
- resume_history: -
