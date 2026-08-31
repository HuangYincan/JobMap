# q-robots — robots 同 UA 多组规则合并

## 路径

- worktree: `/Users/acccan/dm-wt-q-robots`
- branch: `fix/quality-robots-groups`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-robots.md`
- scan finding: #12

## 任务

1. 复验 `crawler/app/domain_map_importer/acquire.py` 对同一 UA 多个最佳匹配 group 是否只保留最后一组。
2. 按 RFC 9309 语义合并所有同等最具体 UA 匹配组的规则，再执行现有最长路径与 Allow tie-break；`*` wildcard 遵循相同逻辑。
3. 增加 fixture 覆盖：重复精确 UA group、重复 wildcard group、精确 UA 优先于 wildcard、跨组 Allow/Disallow 冲突及最长匹配。
4. 更新 robots 专属来源审查/行为文档，只描述已验证行为。

## 边界

- 不处理 #13 网络失败 fail-open 策略，不处理 #1 Feishu UA，不发起 live crawl。
- 不修改任何数据文件或 UI，不安装依赖。

## 门禁与提交

- 运行 crawler 对应测试套件（按仓库现有命令）
- `make docs-check`
- `git diff --check`
- Conventional Commits；不要 merge，不要 push。

## 回报

给出 RFC 行为、fixtures、测试结果及 commit。末两行：

`门禁: PASSED` 或 `门禁: FAILED`

`结论: OK` 或 `结论: BLOCKED: <一句话>`

## Boss 裁决附录（续派）

worker 首轮已提交 `37f9c60`、`df7efeb`，仅因测试命令 approval 缺失而 BLOCKED。Boss 已在同一 worktree 执行 `make test-unit`，结果 `Ran 114 tests` / `OK` / exit 0；持久日志位于批次 `logs/q-robots-boss-test.log`。请核对分支与该日志，不重做实现；更新 `reports/q-robots.md` 的门禁结果和末两行 token 为真实终态。若工作树无额外改动，不要制造空提交。
