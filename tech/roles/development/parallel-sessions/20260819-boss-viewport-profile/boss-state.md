# Boss State — 20260819-boss-viewport-profile

## meta
- slug: 20260819-boss-viewport-profile
- date: 2026-08-19
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-viewport-profile
- goal: BUG×2(Bug1 首点仍回用户位置/Bug2 切 profile poi 消失)+ 功能×3(F1 视口全量增量加载/F2 候选类别列表/F3 偏好下拉)
- owner: boss-agent

## stage
- current: **终态**(全部合并 dev @ e1ace57 并 push;浏览器 VERIFY 完成:F1 zoom 往返 3→11→6→3 列表随视角、F2 domain 候选类别 chips 点击加载 1000 结果、F3 偏好下拉 listbox 正常、Bug1/Bug2 契约+代码复验;仅 favicon.im 404 为既有 deferred)
- updated_at: 2026-08-19

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ws-a | fix/first-select-locate | /Users/acccan/dm-wt-ws-a | prompts/ws-a.md | reports/ws-a.md | DONE 门禁PASSED 结论OK | 9b5f94a→baad513 | blvxko566→bunlg20lf | - | OK |
| ws-b | fix/profile-overlay | /Users/acccan/dm-wt-ws-b | prompts/ws-b.md | reports/ws-b.md | DONE 门禁PASSED 结论OK | 9b5f94a→4506e6a | b2oom1m61→bmoq6l5u8 | - | OK |
| ws-v | feat/viewport-full | /Users/acccan/dm-wt-ws-v | prompts/ws-v.md | reports/ws-v.md | DONE 门禁PASSED 结论OK | 9b5f94a→6fa1251 | bzrgqcm1w→buzv4rmjh→b63h105x6→bj1qkdps4 | - | OK |
| ws-u | feat/category-prefs | /Users/acccan/dm-wt-ws-u | prompts/ws-u.md | reports/ws-u.md | DONE 门禁PASSED 结论OK | 9b5f94a→8a50fc2 | b1f006589→brw3lwc61 | - | OK |

## merge_order
ws-a → ws-b → ws-v → ws-u(文件互不冲突:map-shell 各段 / handleAuthAction / hook+viewport / UI 组件)

## adjudication_log
- 2026-08-19 | Explore×4 | Bug1 = 卡片/建议选中不置 hasInteractedRef(竞态盲区);Bug2 = 移动全开抽屉覆盖(视觉)+登出 overlay pref 未 reset(数据);F1 = work 视口替换式+3000 硬顶+F1 列表/地图同池;F2 = work 无类别门控(getMode 可直接用);F3 = 偏好 pill→下拉(复用 PrefField) | 技术可修,4 ws 派发;移动抽屉全开覆盖属设计由 ws-b 判断 | OK

## deferred_notes
- 见 deferred-notes.md(待 ws-b 若移动抽屉不改则补记)

## next_plan
1. DISPATCH 4 ws(预建 worktree + spawn)
2. COLLECT → 绿则 MERGE(ws-a→ws-b→ws-v→ws-u)
3. VERIFY 浏览器复验 5 项(Bug1 卡片首点/Bug2 登出、F1 zoom 往返 poi 不丢、F2 候选类别、F3 偏好下拉)
4. 终态总汇报

## recovery
- last_stage_written: PLAN
- resume_history: <2026-08-19> 4 份 Explore(af6433/a19ad/aadbd/a235)全部返回结论,根因落 README;4 份 prompt 已写;worktree 未建、未派发。
