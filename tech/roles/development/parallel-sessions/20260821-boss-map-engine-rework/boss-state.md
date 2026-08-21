# Boss State — map-engine-rework

## meta

- slug: 20260821-boss-map-engine-rework
- date: 2026-08-21
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework
- goal: 完善三大服务商切换功能(一切皆插件;实现不了则删)——用户授权深度重构,根因 9 项已诊断坐实
- owner: boss
- decision: **重构不删**(根因=适配层被绕过,非厂商差异不可控);若 ws-5 验证证实不可达则按用户 goal 删功能
- conflict_guard: 不碰 tech/01|03|06、agent.md;map-shell.tsx 仅授权行段(其他会话并行)

## stage

- current: DISPATCH(轮2 ws-2/3/4 并行已派发,进程内通道)
- updated_at: 2026-08-21

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | feature/poi-contract | /Users/acccan/dm-wt-rw1 | prompts/ws-1.md | reports/ws-1.md | MERGED | d7d4b90→527e631 | 轮1 17:20 | 18:4x | OK(1068 tests boss 复核;合并 527e631 已 push) |
| 2 | feature/poi-controller | /Users/acccan/dm-wt-rw2 | prompts/ws-2.md | reports/ws-2.md | DONE | 29da66e | 轮2 | | OK(4 commits,boss 复核 1075/1073 pass;白名单外测试同步已裁决接受) |
| 3 | feature/engine-switch-lifecycle | /Users/acccan/dm-wt-rw3 | prompts/ws-3.md | reports/ws-3.md | DONE | 390aebb | 轮2 | | OK(4 commits,boss 复核 1076/1074 pass;docs-check 基线红惯例) |
| 4 | feature/engine-zindex | /Users/acccan/dm-wt-rw4 | prompts/ws-4.md | reports/ws-4.md | DONE | 8a223d6 | 轮2 | | OK(5 commits,boss 复核 1073/1071 pass) |
| 5 | feature/engine-search-cleanup | /Users/acccan/dm-wt-rw5 | prompts/ws-5.md | reports/ws-5.md | PENDING | — | — | | |

## merge_order

轮1: ws-1(契约先行,其余依赖) → 合并
轮2: ws-2 → ws-3 → ws-4(并行开发,按序合并)
轮3: ws-5(依赖轮2) → 合并
每轮 push origin/dev;红则停。批次目录最后 commit 入库。

## adjudication_log

(空)

## deferred_notes

(空;沿用 20260821-boss-map-engine 批次 deferred-notes 的 #1-#6)

## next_plan

- milestone 1:轮1 ws-1 契约+适配层 → 合并
- milestone 2:轮2 ws-2/3/4 → 合并
- milestone 3:轮3 ws-5 验证收尾 → 合并 → 批次入库
- milestone 4:终态 + 总汇报(含「切换功能完善/删除」裁决依据)

## recovery

- last_stage_written: DISPATCH(轮1 已派发)
- resume_history: 17:20 | ws-1 派发(spawn-worker.sh,首次因 cwd 漂移 127 失败,绝对路径重派;沙箱拦截嵌套 claude,后续须 dangerouslyDisableSandbox=true)
- **17:36 | API 402 Insufficient Balance**:ws-1 worker 启动即死(logs/ws-1.log 仅 1 行 402);worktree 零改动(acc51c6 基线)。
- **17:40 | 重派成功?**:spawn-worker.sh 重派(bqlxmi3xj),worker 存活 3:18 后仍 402 —— 余额确凿耗尽,非瞬时。
- **17:45 | 通道切换**:进程内 Agent(boss-worker 类型)派发 ws-1(a34db044c8a7a2777)。
- **18:2x | 进程内同样 402(三通道坐实)**:a34db044c8a7a2777 工作 35+ 分钟(验证 SDK 声明、改 7 文件、将跑测试)后 402 死亡。结论:共享计量确凿耗尽,一切子进程通道(进程外/进程内)均不可用;仅主会话主循环仍响应(待定)。**终态:批次硬阻塞,等用户充值**。
- **恢复协议(充值后)**:`/boss-agent --resume /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework` → 对账:ws-1 worktree 含**未提交改动**(git status 7 文件:types.ts + 三引擎 + 三测试,与 ws-1 边界一致)——续作重派:同一 worktree,worker 先 `git status` 审阅未提交草稿 → 继续 → 门禁 → 写报告。勿全新重派(草稿有价值)。
