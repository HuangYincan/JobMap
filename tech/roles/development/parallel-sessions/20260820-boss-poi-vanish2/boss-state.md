# Boss State — 20260820-boss-poi-vanish2

## meta
- slug: 20260820-boss-poi-vanish2
- date: 2026-08-20
- batch_dir: tech/roles/development/parallel-sessions/20260820-boss-poi-vanish2
- goal: 修复「第一次点击公司 POI → 回默认位置 + POI 消失」(第三轮,终修)
- owner: boss (Claude Code 主会话)

## stage
- current: DONE(终态)
- updated_at: 2026-08-20

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws-poi-vanish2 | fix/map-remount-camera | /Users/acccan/dm-wt-poi-vanish2 | prompts/ws-poi-vanish2.md | reports/ws-poi-vanish2.md | MERGED | 3cab133 | 2026-08-20 | 2026-08-20 | OK → dev 5fd4c2f |

## merge_order
1. ws-poi-vanish2(MERGED_ALL,已 push;dev = origin/dev = 5fd4c2f)

## adjudication_log
- <2026-08-20> | PLAN | 用户三报同一 bug;浏览器实测定位根因:首次点击 pin → Next dev 按需编译 → HMR fast refresh → MapShell fiber 重建(DOM 复用)→ createMap 重跑(构造栈铁证)→ 硬编码默认 [120.15,30.27] zoom 13 | 修复:createMap(mapCenter, zoom) 用 state 恢复相机 + settle 仅默认位置时飞用户位置 | 浏览器复验通过

## deferred_notes
- 消除 Next dev 按需编译/HMR 本身 = dev 工具行为,不修(生产环境无此问题;修复对两种环境均有效)
- 地图组件架构重构(大工程)非本次范围

## next_plan
- 已完成:根因(实测铁证)→ 修复(2 commits:createMap 用 state + settle 默认位置门控,lib/camera-center.ts 常量单源)→ MERGE 5fd4c2f push → **浏览器复验(移动端首次点击 pin:mapsCreated 重建仍发生但相机保持用户视野 [121.475,31.228] zoom 12,POI 108 不消失;settle 不抢镜头 zoom 未被拉 15)**
- 测试:502 tests / 500 pass / 0 fail / 2 skip,typecheck/docs-check/diff 全绿
- 批次目录入库 + push 待收尾

## recovery
- last_stage_written: DONE
- resume_history: -
