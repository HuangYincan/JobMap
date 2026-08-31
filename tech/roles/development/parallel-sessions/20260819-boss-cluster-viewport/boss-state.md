# Boss State — 20260819-boss-cluster-viewport

## meta
- slug: 20260819-boss-cluster-viewport
- date: 2026-08-19
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-cluster-viewport
- goal: ① B3 城市聚合(用户批准,阈值 zoom ≤ 8)② 修复「工作 POI 不随视角改变」(用户确认首批修复未解决)
- owner: boss-agent

## stage
- current: DONE(ws-a + ws-b 均合入 dev 963700f 并 push;浏览器验收通过)
- updated_at: 2026-08-19

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws-a | feat/city-clustering | /Users/acccan/dm-wt-wsA | prompts/ws-a.md | reports/ws-a.md | MERGED | 6cc50bb | 2026-08-19 | 2026-08-19 | OK |
| ws-b | fix/viewport-poi-update | /Users/acccan/dm-wt-wsB | prompts/ws-b.md | reports/ws-b.md | MERGED | 5ba679e | 2026-08-19 | 2026-08-19 | OK |

## merge_order
1. ws-b(dev 3ab9502)✅ → 2. ws-a(dev 963700f)✅ — 零冲突,已 push

## adjudication_log
- 2026-08-19 | ws-b | worker 两轮超预算,`distanceOrigin` 改好未 commit / 报告未写 | boss 追加续作附录重派 → commit 5ba679e;报告由 boss 用 git fsck + 主树核对如实补写(distanceOrigin 实时化已完成;空批次裁空清理层 / 契约测试列 follow-up) | OK
- 2026-08-19 | merger | spawn-merger.sh 空输出退出 | boss 改在主树按 merge-instructions 手动 --no-ff 合并 + 门禁 + push + 清理 + 写 merge-report | OK
- 2026-08-19 | 验收 | 「distance=10 + 跨城平移」仍显示 0 结果 | 判定:此为**预期语义**(圆心已实时化=离当前视野中心最近;远处视野天然被 10km 过滤裁空),非旧 bug。关掉 distance 过滤即恢复 18 结果。结果记录 merge-report。 | resolved

## deferred_notes
- 见 deferred-notes.md。本批新增/变更:
  - distance 口径已修(圆心实时化),原「圆心跨城整城空白」问题关闭。
  - B3 聚合已实现+验收,deferred「等批准」项移除。
  - 新增 follow-up:distance 深分支「keep-on-collection-fit 下 pipeline 裁空」未显式补清理层(浏览器未见回归,可选项)。

## next_plan
里程碑完成:① B3 聚合(zoom≤8)✅ ② 视口 POI 更新修复 ✅ → 已合 dev 963700f 并 push。
无剩余里程碑。遗留 deferred(全部需用户决策/Env-only,见 deferred-notes.md):
1. icon 存量导入 `npm run import:seed:apply` + bump MODE_CACHE_VERSION + audit:pins
2. 连续快速交互 marker 失步 → 生产构建复验
3. distance 深分支清理层(可选 follow-up)
4. favicon.im 对 IP 域名覆盖率(ADR-007 已记)

## recovery
- last_stage_written: DONE
- resume_history: <2026-08-19> ws-a 第 1 轮超预算 → 续作 → DONE(411 tests)。ws-b 第 1/2 轮超预算 → 续作 → commit 5ba679e + boss 补写报告。merger 空输出 → boss 手动合并。全部已合入 dev 963700f。
