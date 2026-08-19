# Boss State — 20260819-boss-cluster-tune

## meta
- slug: 20260819-boss-cluster-tune
- date: 2026-08-19
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-cluster-tune
- goal: BUG×3 修复(①跨城 POI 串味 ②聚合不在市中心 ③首次点 pin 回到用户位置)→ 全库代码审查 → 持续优化
- owner: boss-agent

## stage
- current: VERIFY→SCAN(三 bug 已在 dev 实机 DB + API 验证:Bug1 杭州视口 26 pois 全杭州标签/全国视野保留真实跨城,Bug2 锚点=北京中心 116.4/39.9 / 未知城回退均值,Bug3 hasInteractedRef 门控+handleLocate 原义保留 → 派 boss-scanner all)
- updated_at: 2026-08-19

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws-a | fix/cross-city-bleed | /Users/acccan/dm-wt-wsA | prompts/ws-a.md | reports/ws-a.md | MERGED | b039c11(merge 232a2ea) | bjsyd5r5e | - | OK |
| ws-b | fix/cluster-center | /Users/acccan/dm-wt-wsB | prompts/ws-b.md | reports/ws-b.md | MERGED | fb02d6e(merge 95f2502) | b4s34l7wh | - | OK |
| ws-c | fix/first-click-locate | /Users/acccan/dm-wt-wsC | prompts/ws-c.md | reports/ws-c.md | MERGED | bd25a11(merge 7e03adf) | bx87n6e4v | - | OK |

## merge_order
1. ws-a → 2. ws-b → 3. ws-c(或按完成序;文件互不冲突:recruitment-store/spatial-query / city-cluster+city-centers / map-shell 各自独立)

## adjudication_log
- 2026-08-19 | Explore | Bug1 根因 = DB 城市标签/坐标矛盾(147 条非杭城市标签落杭坐标、76 公司、914 岗位)→ 查询层缺 city↔bounds 校验 + import/geocode provenance 缺陷(Env-only)。Bug2 = city-cluster 均值锚点,仓库无城市中心表。Bug3 = 挂载 geolocation 异步回调太慢,和首次点 pin 竞态,setCenter(userLocation) 拽走相机 | 三个都技术可修 → 拆 3 个 ws 派发;数据重灌(geocode)记 deferred | OK

## deferred_notes
- 待写(见 deferred-notes.md;合入 prev:icon 存量导入、连续交互 marker 失步、favicon IP 域名;新增:跨城串味的 DB 数据修正 = Env-only geocode 重灌;聚合城市中心若需覆盖更多城市可后续扩表)

## next_plan
1. ✅ DISPATCH 三 ws → MERGE → VERIFY(Bug1/2/3 全绿,dev @ 7e03adf,已 push)
2. ✅ SCAN(boss-scanner all → 16 发现 → 裁决:14 条技术项批派、6 条 deferred)
3. → **进行中:20260819-boss-qa-fixes 批次**(5 ws,各自 boss-state 见该批次目录)
4. #6 map-shell 拆分(qa 批次后单列)
5. 持续优化 → 终态 + 总汇报(含 deferred)

## recovery
- last_stage_written: DISPATCH
- resume_history: <2026-08-19> ws-b 首次 spawn 静默空跑(exit 0,1 字节 log,零 commit/零 report)→ 追加幂等附录重派,任务 bx37uvama。
- <2026-08-19> 三 ws 均预算超限中断(ws-a exit 1 已产出 spatial-query.ts 未接线;ws-b 重派后产出 city-centers.ts 未接线;ws-c exit 1 产出 map-shell.tsx 已完整) → 已追加续作附录(ws-a/ws-b/ws-c),全部续作重派。
