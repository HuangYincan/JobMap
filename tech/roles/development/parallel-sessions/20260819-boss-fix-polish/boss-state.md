# Boss State — 20260819-boss-fix-polish

## meta
- slug: 20260819-boss-fix-polish
- date: 2026-08-19
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-fix-polish
- goal: 修复 2 个用户 bug(视口空白+marker 泄漏 / 公司 icon)+ 功能完善(profile 已投递可点击)
- owner: boss-agent
- milestone_link: tech/20-development-plan.md(队列 B 遗留)

## stage
- current: VERIFY(完成,终态)
- updated_at: 2026-08-19

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws1 | fix/work-viewport-blank | /Users/acccan/dm-wt-ws1 | prompts/ws1.md | reports/ws1.md | DONE | 544e514 | 2026-08-19 | 2026-08-19 | OK |
| ws2 | fix/marker-leak | /Users/acccan/dm-wt-ws2 | prompts/ws2.md | reports/ws2.md | DONE | 8a07cf0 | 2026-08-19 | 2026-08-19 | OK |
| ws3 | fix/company-icons | /Users/acccan/dm-wt-ws3 | prompts/ws3.md | reports/ws3.md | DONE | a33bd24 | 2026-08-19 | 2026-08-19 | OK |
| ws4 | feat/profile-applications-open | /Users/acccan/dm-wt-ws4 | prompts/ws4.md | reports/ws4.md | DONE | 63b0aa5 | 2026-08-19 | 2026-08-19 | OK |

## merge_order
1. ws1 → 2. ws2 → 3. ws3 → 4. ws4(红则停;ws1/ws2 同域先合,ws4 最后避开 map-shell 冲突)

## adjudication_log
(空)

## deferred_notes
- Env-only: icon 存量修复需 import:seed:apply + 缓存 bump(见 deferred-notes.md)
- 数据口径: 距离筛选圆心跨城语义,待用户拍板
- 其他: B3 城市聚合等用户批准布局图

## next_plan
- 本批: DISPATCH 4 workers → COLLECT → ADJUDICATE → MERGE → VERIFY
- 后续里程碑: (无,本批即目标闭环)

## recovery
- last_stage_written: DISPATCH
- resume_history: -

## verification(boss 亲自,2026-08-19)
- git 抽验: dev HEAD a79c941,4 个 merge commit 在列,worktree 全清 ✓
- 全量测试: 398 pass / 0 fail(merger 4 轮逐分支重跑)✓
- 实机验证(dev :3000 + Playwright):
  1. 挂载对齐加载 ✓: 停上海缓存刷新页面后,无需操作缓存自动对齐回杭州视野
  2. 拖动后刷新 ✓: 单次拖动 marker 数(3)== catalog 数(3),缓存视野同步
  3. marker 泄漏 ✓: 干净状态往返计数一致,无残留
  4. icon 解析链 ✓: marker 渲染 favicon.im <img>(careerUrl→favicon),失败走 🏢 emoji 兜底
  5. ⚠️ distance 圆心跨城: 用户开过距离过滤后跨城整城空白(实机复现,见 deferred)
  6. ⚠️ 连续快速交互(多次 zoom+drag)偶发 marker 失步,dev 热更新环境干扰下复现不稳定,
     需生产模式复验(风险项,见 deferred)

## leftovers(终态遗留)
- tech/16-bug-fixes.md 未记录本次 4 项修复(worker 文档遗漏,待补)
- ws2 浏览器实机未由 worker 执行(由 boss 实机验证替代)✓
- seed-data.ts 52 个 google s2 logoUrl(超 ws3 边界,另开 WS)
- distance 圆心跨城语义 + Env-only icon 存量(见 deferred-notes.md)
