# Boss State — 20260820-boss-rail-settle

## meta
- slug: 20260820-boss-rail-settle
- date: 2026-08-20
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-rail-settle
- goal: 修复「首点侧控栏二级卡片 item 时整页刷新感」——settle 自动定位加「用户已交互」门控(geolocation resolve 晚于首交互时不再整幅跳变)
- owner: boss-agent(无人值守)
- dev_tip: d61e720(dev 干净;上一批 51c0406 已合入)

## stage
- current: NEXT(全部完成:1/1 分支合入 dev 并 push;终态)
- updated_at: 2026-08-20

## 最终结果
- dev @ 870af90(push 至 origin/dev;基线 d61e720 → 870af90,1 个 merge commit)
- 门禁:502 tests / 500 pass / 2 skip / 0 fail;typecheck 0;docs-check pass;diff --check 干净
- boss 复验(Playwright + grantPermissions + geolocation 延迟 5s):
  - 场景 A(首点 rail 后 resolve):zoom 保持 13,不跳变 ✓
  - 场景 B(未交互 resolve):zoom 13→15 自动定位保留 ✓

## 根因确认记录(三重证据)
1. 代码:map-shell.tsx L544 门控 `!userMovedMapRef && isNearDefaultCenter` → L545-547 瞬间 setCenter+setZoom(15);React 层无 remount、无浏览器 reload
2. 用户线索对应:「取决于视角」= isNearDefaultCenter 门控(拖过图不触发);「绝大多数触发」= 多数用户不拖图;「任何 item」= 首交互时间窗与 geolocation resolve 重合
3. 实测(Playwright+grantPermissions+延迟 resolve):zoom 13→15 在 resolve 时刻瞬间跳变;无权限环境永不跳变(解释上一批无法复现)

## workstreams
| ws | 主题 | 分支 | worktree | prompt | report | status | last_tip | verdict |
|---|---|---|---|---|---|---|---|---|
| w1 | settle 门控加「用户已交互」ref | fix/settle-user-interaction-gate | /Users/acccan/dm-wt-w1 | prompts/w1.md | reports/w1.md | DONE | 863f7f2 | OK(502 pass/2 skip;boss 双场景复验通过) |

## merge_order
1. w1(唯一 WS)

## adjudication_log
(空)

## deferred_notes
(空)

## next_plan
- [x] [1] PLAN:根因三重确认(上一批假设证伪 → settle 跳变机制)→ README + prompts/w1.md + 本 state
- [ ] [2] DISPATCH:预建 worktree → spawn worker w1
- [ ] [3] COLLECT → ADJUDICATE
- [ ] [4] MERGE:merger 合并 + push dev
- [ ] [5] VERIFY:Playwright + geolocation 授权复验(交互后 resolve 不跳变;未交互仍跳变)
- [ ] [6] NEXT:绿 → 终态 + 总汇报

## recovery
- last_stage_written: PLAN
- resume_history: 无
