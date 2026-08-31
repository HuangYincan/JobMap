# 合并报告(2026-08-19)

## 结果总览
- 成功合并: ws-data-feishu + ws-ui-job-filters,共 2 分支
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-data-feishu | feat/data-more-feishu | ✅ no-ff,无冲突 | ✅ npm test 360/358/0;typecheck 通过;plan-seed-import 0 issues/0 dropped(672 公司/1843 站点/10642 岗位);portal-feishu-* 抽查全过(23 文件 9799 岗);diff --check 通过;crawler unittest 62 tests 由 boss 于 2026-08-19 验证全过(见 boss-state.md,本会话沙箱内 python unittest 需人工审批,未重跑) | 无冲突 |
| ws-ui-job-filters | feat/ui-job-filters | ✅ no-ff,无冲突 | ✅ npm test 368/366/0(新增 8 个 position-filters 单测全过);typecheck 通过;docs-check 通过(无 stale 引用);diff --check 通过 | 无冲突 |

## 冲突解决清单
无冲突(两分支文件不相交:数据分支 = crawler/cli.py + server/data/recruitment/official-career/* 24 drops;UI 分支 = server/src/components/poi-detail.* + position-filters + i18n + tests)。

## 遗留问题
- `reports/ws-data-feishu.md` 缺失(worker 预算中断,boss 续作爬取+提交);本次合并以 boss-state.md verdict(62 crawler tests / plan 0 issues / portal 抑制抽查全过)+ 本会话独立复核(plan-seed-import 0/0、portal-feishu 前缀全量核对、莉莉丝 drop 抽查)为准。
- Env-only 留给用户:import:seed:apply(drops 已入 dev,待用户执行);radar 沪杭公司批量 geocode 落点(待授权 `npm run geocode:sites:apply`)。
- Playwright 浏览器自验未做(环境不可用),UI 以单测覆盖筛选逻辑。

## 最终 dev 状态
- eca65bc(已 push origin/dev);合并提交:4f5598a(data)、eca65bc(UI)
- 两分支已删除,worktree 已清理

门禁: ALL_GREEN
结论: MERGED_ALL
