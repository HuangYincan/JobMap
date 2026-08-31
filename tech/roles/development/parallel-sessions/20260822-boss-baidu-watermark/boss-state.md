# Boss State — baidu-watermark

## meta
- slug: 20260822-boss-baidu-watermark
- date: 2026-08-22
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-baidu-watermark
- goal: 隐藏百度地图左下角水印(anchorBL / logo_hd.png)
- owner: boss
- milestone_link: —

## stage
- current: DONE(终态:目标完成)
- updated_at: 2026-08-22

## meta
- final: dev HEAD = dbf9c91(merge: fix/baidu-watermark),已 push origin/dev,与本地同步
- 门禁: npm test 1415 pass / 0 fail / 2 skip;typecheck/docs-check/diff-check 全绿
- worktree/分支已清理;无 main 涉及;无 Env-only 待办

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| w1 | fix/baidu-watermark | /Users/acccan/dm-wt-baidu-watermark | prompts/w1.md | reports/w1.md | DONE(裁决放行) | 447bcc0 | 2026-08-22 | 2026-08-22 | 放行,待 merge |

## merge_order
1. w1

## adjudication_log
2026-08-22 07:30 | w1 | worker 报门禁 FAILED(2 个 split-city-sites 数据漂移失败);dev 单文件复验 20/20 绿(主树数据文件被并行会话 merge 污染,不可信);干净 worktree 单文件复验**仍红** → 坐实 17cb454 基线自身红 | **放行 w1**(失败与 w1 零关联:仅依赖 city-centers/spatial-query/recruitment JSON;w1 相关契约测试绿);数据漂移记 deferred-notes;merge 须等并行会话 engine-polish-2 主树 merge 完成后派 | 等待中

## deferred_notes
2026-08-22 | 合规提示(其他,非阻塞) | 隐藏百度 logo 水印违反百度地图 ToS(版权标识)。项目已对高德(.amap-logo)、腾讯(logo_def)同款 CSS 隐藏(既有先例,map-shell.module.css),本次为补齐惯例缺口;生产上线前可自行评估是否保留任一厂商标识。不阻塞本批。
2026-08-22 | 数据口径(预存基线红,非本批引入) | dev(17cb454)基线上 `split-city-sites.test.mjs` 有 2 个失败:上海站点真实坐标 121.439346/31.197401 vs 测试期望 121.47/31.23(worker 单文件复验 + boss 干净 worktree 复验均复现)。**已解决**:并行会话 engine-polish-2 的 merge(f808fd0)顺带修复,新基线单文件复验 20/20 绿,无需进一步动作。

## next_plan
- 里程碑: 1/1 完成(隐藏百度水印)
- 剩余步骤: 无,批次终态
- 下一步: 无(最终总汇报已出)

## recovery
- last_stage_written: DONE
- resume_history: 2026-08-22 | 并行会话检测:engine-polish-2 主树 merge 进行中(07:27 起),本批次等待其完成(f808fd0)后再合并,无冲突
