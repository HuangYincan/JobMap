# Boss State — 20260819-regression-fix

## meta
- slug: 20260819-regression-fix
- date: 2026-08-19
- batch_dir: tech/roles/development/parallel-sessions/20260819-regression-fix
- goal: 修复 2026-08-19 全量并入 dev 后的 7 个用户验收回归 bug(侧控栏 logo/邮箱、Profile 身份卡/求职偏好下拉、工作 noMore、收藏按模式区分+kind 守卫、工作视口刷新)
- owner: boss-agent(2026-08-19)
- milestone_link: (无 PR,dev 内批次)

## stage
current: VERIFY
updated_at: 2026-08-19T04:0x

## workstreams
| ws | branch | worktree | prompt | report | status | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|
| w1 | fix/sidebar-chrome-regress | /Users/acccan/dm-wt-w1 | prompts/w1.md | reports/w1.md | MERGED | 03:30 | 03:42 | GREEN · 15b75d5 · dcf944e |
| w2 | fix/profile-identity | /Users/acccan/dm-wt-w2 | prompts/w2.md | reports/w2.md | MERGED | 03:30 | 03:45 | GREEN · 86fb03e · 74877a2 |
| w3 | fix/work-nomore | /Users/acccan/dm-wt-w3 | prompts/w3.md | reports/w3.md | MERGED | 03:30 | 03:47 | GREEN · ea42f3d · 05786f1 |
| w4 | fix/work-domain-leak | /Users/acccan/dm-wt-w4 | prompts/w4.md | reports/w4.md | MERGED | 03:30 | 03:50 | GREEN · 08b65ef+15c2820+75172fc · 6dfcf1e |
| w5 | fix/viewport-refresh | /Users/acccan/dm-wt-w5 | prompts/w5.md | reports/w5.md | MERGED | 03:30 | 03:45 | GREEN · 1826416 · 1eb0044 |

## merge_order
1. w1(纯 CSS,独立) → 2. w2(account-panel,独立) → 3. w3(工作加载判定) → 4. w5(视口替换,依赖 w3 noMore 对接) → 5. w4(marker/cache)
- 冲突集中在 map-shell.tsx / viewport-search.ts;w3 先行 w5 对接;按各 prompt「不碰」为据。

## adjudication_log
- 03:50 | w4 | 进程退出码 1(Exceeded USD budget 3),但 3 个 commit 已落盘、汇报已写 PASSED/OK、worktree 干净 | 判定为预算耗尽发生在工作完成之后;boss 亲自重跑 w4 全部门禁(npm test 294/0、typecheck、docs-check、diff-check)全绿 | 接受,GREEN
- 04:05 | 全批 | 3 处合并冲突(map-shell.tsx / viewport-search.ts / viewport-search.test.mjs) | merger 按各 prompt「不碰」语义解决,boss 复验 loadWorkViewport(return {pois,noMore}+kind 守卫)、视口替换(noMore 复位+existing:[])、savedPlacesToOverlay(mode 过滤)+mode-cache(kindMatchesMode)全部一致 | 接受,MERGED_ALL

## deferred_notes
- 04:05 | 其他 | 各 worker 为 headless 会话,无浏览器,未产出 UI 截图。视觉验收建议:侧控栏 logo 居中/邮箱截断、Profile 身份卡高度、求职偏好下拉玻璃质感、收藏 pin 按模式、工作 noMore + 视口刷新——需带浏览器会话或用户复核
- 04:05 | 其他 | 主树存在未提交改动 `.claude/agents/boss-worker.md` + `.claude/agents/boss-merger.md`(幂等恢复补充,7 行)与 `CLAUDE.md`(故障恢复节)——非本批产生,疑似并行会话/用户编辑,未提交、未回退,留待用户处理

## next_plan
- 当前 milestone: 20260819-regression-fix(dev 内批次,不含 main)— 全部完成 ✅
- 剩余步骤: 无。dev HEAD 6dfcf1e 已 push origin/dev(ahead/behind=0),298 tests/296 pass/0 fail。
- 下一步: 可选 SCAN(只读质量扫描)或结束;视觉验收待用户/带浏览器会话
