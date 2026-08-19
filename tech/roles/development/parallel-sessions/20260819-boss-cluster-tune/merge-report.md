# 合并报告(2026-08-19)

## 结果总览
- 成功合并: ws-a / ws-b / ws-c(3 分支全部并入 dev,门禁逐分支全绿)
- 失败/遗留: 无

## 逐分支明细
按 manifest 合并顺序逐个 `git merge --no-ff`(dev 主工作树),随后跑完整门禁。

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-a | fix/cross-city-bleed | ✅ 232a2ea | 414 pass / 0 fail(2 skip)· typecheck ✅ · docs ✅ · diff ✅ | 无冲突 |
| ws-b | fix/cluster-center | ✅ 95f2502 | 420 pass / 0 fail(2 skip)· typecheck ✅ · docs ✅ · diff ✅ | 无冲突 |
| ws-c | fix/first-click-locate | ✅ 7e03adf | 421 pass / 0 fail(2 skip)· typecheck ✅ · docs ✅ · diff ✅ | 无冲突 |

每次 merge 后均 `git push origin dev`,各 worktree 移除、本地分支删除。

## 冲突解决清单
无冲突(三分支文件互不重叠:spatial-query/recruitment-store · city-centers/city-cluster · map-shell/component-contracts)。

## 遗留问题
- 数据层修正(Bug1 根因:company_sites 147 条「城市标签与坐标矛盾」行 · 76 公司 · 914 open 岗位)= Env-only(数据重灌 + 重跑 geocode),已由 boss 记入 deferred-notes.md,本批不做。
- Bug2 静态 CITY_CENTERS 表未命中城市回退均值(兜底语义,设计如此,非缺陷)。
- 全库代码审查(boss-scanner all)+ 持续优化 = 后续里程碑,非本批范围。

## 最终 dev 状态
- `dev` @ 7e03adf,含 3 个 merge commit(ws-a / ws-b / ws-c),三处文件互不冲突。
- 主工作树干净,worktree 已全部移除,fix/* 分支已全部删除,已 push origin/dev。

门禁: ALL_GREEN
结论: MERGED_ALL
