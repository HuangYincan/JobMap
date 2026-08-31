# Boss State — tmap-polish

## meta

- slug: 20260822-boss-tmap-polish
- date: 2026-08-22
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish
- goal: 用户 7 个真机 bug(TMap POI 缩放聚合/卫星深色/百度失败/水印/比例尺/公司icon/右下角控制)
- owner: boss
- decision: 全部技术类,直接派发;水印隐藏为用户明确要求(ToS 权衡记录);无 UI 设计改动(zoom 按钮仅契约化,视觉不变)

## stage

- current: 终态(4/4 WS MERGED;7/7 bug 真实验证通过)
- updated_at: 2026-08-22

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a | feature/tmap-poi | /Users/acccan/dm-wt-pa | prompts/ws-a.md | reports/ws-a.md | MERGED | 729c55f | 轮1 | | OK(1145/1143 pass 复核) |
| b | feature/tmap-style-controls | /Users/acccan/dm-wt-pb | prompts/ws-b.md | reports/ws-b.md | MERGED | b9bbfe3 | 轮1 | | OK(1149/1147 pass 复核) |
| c | feature/baidu-ready-signal | /Users/acccan/dm-wt-pc | prompts/ws-c.md | reports/ws-c.md | MERGED | cdb1918 | 轮1 | | OK(1140 pass 复核) |
| d | feature/tmap-satellite | /Users/acccan/dm-wt-pd | prompts/ws-d.md | reports/ws-d.md | MERGED | d46fff7 | 轮2 | | OK(1186 pass 复核) |

## verification(boss 亲自 Playwright,2026-08-22 19:10-19:20)

| bug | 验证方式 | 结果 |
|---|---|---|
| 1 POI 缩放/聚合 | zoom≤8 蓝像素 5500(聚合徽章 dataURL)+ LOD 切换 | ✅ |
| 2 卫星 | 修复前 231/21(全白)→ 修复后 75/38(影像渲染) | ✅ ws-d |
| 2 深色 | 标准 177 vs 深色 104,差值 73 | ✅ |
| 3 百度 | BMap 元素+canvas 渲染,挂载直连无回退,零错误 | ✅ |
| 4 水印 | logo_def.png 存在但 CSS 隐藏 | ✅ |
| 5 比例尺 | tmap-scale-control 元素存在 | ✅ |
| 6 公司 icon | zoom15:蓝 4586px + 多彩 20419px(logo 真图标) | ✅ |
| 7 右下角 zoom | 15→16 生效 | ✅ |

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
