# Boss State — map-engine

## meta

- slug: 20260821-boss-map-engine
- date: 2026-08-21
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine
- goal: 地图引擎「一切皆插件」— 前端底图(AMap/腾讯/百度)多源可插拔 + 后端 geocode 配置化;只配任意一家可用、三家同配自动选一 + UI 手动可切
- owner: boss
- plan_ref: /Users/acccan/.claude/plans/baidu-ai-map-skill-skill-indexed-pearl.md
- conflict_guard: 不碰 qqdoc-jobs 文件;不碰 tech/01|03|06、agent.md(docs-maintenance 活跃)

## stage

- current: DISPATCH(轮4)
- updated_at: 2026-08-21

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a | feature/map-engine-backend | /Users/acccan/dm-wt-eng-a | prompts/a.md | reports/a.md | MERGED | 73c3f0b | 轮1 | 轮1 | PASSED/OK(603/601) |
| b | feature/map-engine-core | /Users/acccan/dm-wt-eng-b | prompts/b.md | reports/b.md | MERGED | 5fcb8a6 | 轮1 | 轮1 | PASSED/OK(632/630;zzz-debug 已随 worktree 清理) |
| c | feature/map-engine-amap | /Users/acccan/dm-wt-eng-c | prompts/c.md | reports/c.md | MERGED | 8d9338c | 轮2 | 轮2 | PASSED/OK(696/694) |
| d | feature/map-engine-tencent | /Users/acccan/dm-wt-eng-d | prompts/d.md | reports/d.md | MERGED | f96ed95 | 轮2 | 轮2 | PASSED/OK(719/717) |
| e | feature/map-engine-baidu | /Users/acccan/dm-wt-eng-e | prompts/e.md | reports/e.md | MERGED | 80d45d0 | 轮2(重派) | 轮2 | PASSED/OK(754/752) |
| f | feature/map-engine-ui | /Users/acccan/dm-wt-eng-f | prompts/f.md | reports/f.md | MERGED | 3e06a6b | 轮3(续作) | 轮3 | PASSED/OK(825/823) |
| g | feature/map-engine-docs | /Users/acccan/dm-wt-eng-g | prompts/g.md | reports/g.md | DONE | 9285062 | 轮4 | 轮4 | PASSED/OK(汇报缺失,commit 完整,boss 现场验证 824/822+2skip) |

## merge_order

轮1: a → b(不相交,按序 --no-ff)
轮2: c → d → e(依赖轮1;c 最大风险先合验证)
轮3: f
轮4: g
每轮 push origin/dev;红则停。batch 目录自身最后 commit 入库。

## adjudication_log

- 2026-08-21 | e | claude -p 异常退出(日志仅 1 行,exit 0 但无汇报);分支零 commit,worktree 有未跟踪 `server/src/lib/map-engine/baidu/` 草稿 | 续作重派同一 worktree:worker 先审阅未提交草稿(可复用/重写),必须完成全部任务+测试+门禁 | 已重派,待观察
- 2026-08-21 | d | 腾讯引擎 vendor API 沙箱禁网无法实机核实 | 接受,标注 [冒烟待验],tech/23 注明核实层级(deferred #1 真实 key 冒烟回填) | 接受
- 2026-08-21 | d | `BasePOI.source` 闭合联合无 'tencent',腾讯归一化暂沿用 'amap'(误导持久化判定) | **ws-g 收尾修正**:扩展 source 联合加 'tencent' + tencent-engine 改用之(g prompt 派发时更新边界) | 待 ws-g
- 2026-08-21 | d | engine-registry 三引擎仍是骨架(not-implemented),完整实现从各 engine 文件同名导出 | **ws-f 统一接线**:完整实现替换注册表骨架(c/d/e 同构处理;f prompt 派发时更新边界) | 待 ws-f

## deferred_notes

见 deferred-notes.md:#1 NEXT_PUBLIC_TENCENT_JSAPI_KEY(Env-only)、#2 NEXT_PUBLIC_BAIDU_AK(Env-only)、#3 重叠文档 defer、#4 真实 key 冒烟依赖 1/2

## next_plan

- milestone 1(当前):轮1 a+b 并行 → 合并 → push
- milestone 2:轮2 c+d+e → 合并
- milestone 3:轮3 f → 合并
- milestone 4:轮4 g → 合并 → batch 目录入库 commit
- milestone 5(收尾):终态 boss-state + 最终总汇报;deferred 项转用户

## recovery

- last_stage_written: DISPATCH(轮1 派发前)
- resume_history: —
