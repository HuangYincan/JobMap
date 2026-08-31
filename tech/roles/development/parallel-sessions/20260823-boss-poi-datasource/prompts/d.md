# ws-d — tech/29 刷新为 r5 runbook + etl 来源审查

## 背景(2026-08-23 boss 实测)
r5 geocode 前置代码已全部就绪(dev HEAD dda9555,含 grader 放宽 fix/grader-seq-relax),但执行是 Env-only。用户需要一份**可照着跑的执行手册**:多日排程、每日命令、验证点、import 与 UI 验证。同时 ws-b 引入了 OSM Nominatim 海外数据源(来源审查文档由 ws-b 写),本 WS 负责把 tech/29 从「r5 待执行」状态刷新为「r5 可执行 runbook」终态版,并把 `.address-work/`(用户手动探索的百度/搜狗/360 搜索引擎地址源,未入库)的审查结论写入文档。

## 任务(worktree:/Users/acccan/dm-wt-pds-d,分支 docs/poi-r5-runbook)
1. **刷新 `tech/29-geocode-r5-status.md`**:
   - 保留根因段;更新「现状」为 2026-08-23 实测基线(中心钉点 1330 / 上海 344 / needsRerun 1076 / cityList 929 / stayCenter 249 / noAddress 5;sitesTotal 2410;与 2026-08-22 基线 1346 的差异说明——数据源更新所致)。
   - 新增「**r5 执行 runbook**」章节:配额事实(三 provider place 检索各 ~100 次/日,来源 URL)、多日排程建议(每天跑至 QUOTA_EXHAUSTED 自动短路;建议按 Top 城市 `--cities 上海` 优先)、每日命令、验证点(audit-city-center-pins 数字下降、drops 坐标 diff)、import 步骤(`npm run import:seed:apply`,Env-only)、UI 验证 + MODE_CACHE_VERSION bump 提示。
   - 引用 ws-a(多城市列表串判定)/ ws-b(Nominatim 海外源)/ ws-c(daily 进度)的新能力(分支合并后生效;文档写「2026-08-23 批次合并后」)。
   - 文档必须只含**可验证事实**;不确定处标注待实测。
2. **`.address-work/` 审查结论写入 etl 文档**:在 `tech/roles/data/etl/` 新增或更新文档,记录用户手动探索的搜索引擎地址源(百度/搜狗/360/必应 HTML 抓取)的**审查结论**:合规风险(验证码/登录墙/条款)、为何不作为正式数据源(或列为 deferred 探索项)、后续若使用需满足的条件(来源审查、限流、不绕过)。不把抓取代码入库。
3. **deferred 清单更新**:tech/29 末尾明确 Env-only 待办(geocode r5 apply 多日 / import:seed:apply / Nominatim 海外执行 / MODE_CACHE_VERSION bump)。

## 文件边界
- 改:`tech/29-geocode-r5-status.md`、`tech/roles/data/etl/`(新增或更新)。
- 可读 ws-a/b/c 的 `reports/`(若已生成)与代码产物,但**不写代码**;数字以自己实测为准(可运行 `server/scripts/audit-city-center-pins.mjs` 复核)。
- 不碰:server 代码、UI、其他 tech 文档(除非明显的既有错误)。
- 不 merge / 不 push。

## 门禁
```bash
cd /Users/acccan/dm-wt-pds-d && make docs-check && git diff --check
# 事实复核(只读):
cd /Users/acccan/dm-wt-pds-d/server && node scripts/audit-city-center-pins.mjs | head -20
```
每次小步 Conventional Commits(`docs(data-quality): ...`)。

## 回报
写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-poi-datasource/reports/ws-d.md`:
1. 改动摘要(tech/29 新增章节、etl 文档)
2. audit 复核数字
3. 「遇到的问题」段(如有)
4. 门禁逐项结果
末两行必须精确:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
