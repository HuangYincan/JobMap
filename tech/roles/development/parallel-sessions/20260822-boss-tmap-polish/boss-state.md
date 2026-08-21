# Boss State — tmap-polish

## meta

- slug: 20260822-boss-tmap-polish
- date: 2026-08-22
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish
- goal: 用户 7 个真机 bug(TMap POI 缩放聚合/卫星深色/百度失败/水印/比例尺/公司icon/右下角控制)
- owner: boss
- decision: 全部技术类,直接派发;水印隐藏为用户明确要求(ToS 权衡记录);无 UI 设计改动(zoom 按钮仅契约化,视觉不变)

## stage

- current: DISPATCH(轮1 ws-a/b/c 已派发,进程内通道)
- updated_at: 2026-08-22

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a | feature/tmap-poi | /Users/acccan/dm-wt-pa | prompts/ws-a.md | reports/ws-a.md | RUNNING | c7e5625 | 轮1 | | |
| b | feature/tmap-style-controls | /Users/acccan/dm-wt-pb | prompts/ws-b.md | reports/ws-b.md | RUNNING | c7e5625 | 轮1 | | |
| c | feature/baidu-ready-signal | /Users/acccan/dm-wt-pc | prompts/ws-c.md | reports/ws-c.md | RUNNING | c7e5625 | 轮1 | | |

## merge_order

轮1: ws-a → ws-b → ws-c(并行开发,按序合并;tencent-engine.ts 段切分已隔离)。每轮 push origin/dev。

## adjudication_log

(空)

## deferred_notes

见 deferred-notes.md(#1 百度真实验证待 boss;#2 水印 ToS 权衡)

## next_plan

- milestone 1: ws-a/b/c 开发 → 合并 → push
- milestone 2: boss Playwright 真实验证全部 7 项(含百度全链路)
- milestone 3: 终态汇报(7 项逐一结果 + 是否触发删除 fallback 的终裁依据)

## recovery

- last_stage_written: PLAN(批次创建)
- resume_history: —
