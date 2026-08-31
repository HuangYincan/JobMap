# ws-c — r5 多日执行体验:进度持久化 + daily 封装 + 配额事实

## 背景(2026-08-23 boss 实测)
r5 geocode apply 需重跑 1076 站(上海 269 / 北京 246 / 深圳 182 …)。配额事实:AMap place-text ~100 次/日、百度 Web 服务地点检索 100 次/日、腾讯 WebService 地点搜索 ~100 次/日(个人开发者)——三 provider 合计日吞吐 ~300 站,全量约 **4 天**。apply 脚本已有 `--cities/--only/dry-run`、内存 memo、配额短路(连续 5 站配额失败 QUOTA_EXHAUSTED 退出)。但**跨日执行体验缺失**:每次运行结束用户不知道「今天跑了多少、明天剩哪些」;memo 是内存态(重启丢失,但已命中坐标已写回 JSON,alreadyLocated 跳过,幂等)。

## 任务(worktree:/Users/acccan/dm-wt-pds-c,分支 feat/poi-daily-run)
1. **进度持久化**:在 `server/scripts/geocode-sites-apply.mjs` 增加轻量进度记录(建议独立函数,包一层而非侵入主循环):
   - 运行结束时写 `server/.geocode-progress.json`(或 data/ 下可 gitignore 的位置,worker 自定但必须 gitignore 或在 .gitignore 登记):记录本次运行时间、重跑站数、成功/失败/unresolved 计数、剩余清单(按城市分组)、QUOTA_EXHAUSTED 标记。
   - 下次运行开始时若指定 `--continue`(或默认),读进度文件打印「上次进展 + 剩余 Top 城市」,不改变检索逻辑。
   - 保持幂等:已有坐标站 still 跳过(现状行为),进度文件仅是报告/排程辅助,不参与判定。
2. **daily 封装命令**:`server/package.json` 新增 script(`geocode:sites:daily`),封装「运行 apply → 若 QUOTA_EXHAUSTED 打印明日续跑指引与剩余统计」。可新增 `server/scripts/geocode-sites-daily.mjs` 薄封装(worker 自定,保持薄)。
3. **配额事实注释**:在 apply 脚本头部注释与进度报告输出中写入三 provider place 检索 ~100 次/日的事实与「全量 ~4 天」预期(2026-08-23 查证;个人开发者配额,标注来源 URL:lbs.amap.com / lbsyun.baidu.com / lbs.qq.com)。不臆造数字,注释里写明「实测/文档日期」。
4. **按城排程建议**:进度报告输出按城市排序的剩余清单(上海/北京/深圳优先),并提示 `--cities 上海` 的单城跑法(已有能力,只需在报告中提示)。

## 文件边界
- 改:`server/scripts/geocode-sites-apply.mjs`(进度记录,包层化,尽量不动检索逻辑)、`server/package.json`、可新增 `server/scripts/geocode-sites-daily.mjs`、`.gitignore`(若新进度文件)。
- 不碰:其他源、UI、`tech/` 文档(ws-d 负责 runbook;你只写代码注释)。
- 不 merge / 不 push。

## 门禁
```bash
cd /Users/acccan/dm-wt-pds-c/server && npm run typecheck
cd /Users/acccan/dm-wt-pds-c/server && npm test
cd /Users/acccan/dm-wt-pds-c && make docs-check && git diff --check
# 行为验证(无 key 时 dry-run 路径):
cd /Users/acccan/dm-wt-pds-c/server && node scripts/geocode-sites-apply.mjs --dry-run --cities 上海 | tail -5
```
每次小步 Conventional Commits(`feat(geocode): ...`)。

## 回报
写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-poi-datasource/reports/ws-c.md`:
1. 改动摘要(进度文件位置/格式、daily 命令用法)
2. dry-run 行为验证输出(尾行)
3. 「遇到的问题」段(如有)
4. 门禁逐项结果
末两行必须精确:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
