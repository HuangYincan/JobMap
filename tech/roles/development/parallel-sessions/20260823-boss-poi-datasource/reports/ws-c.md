# ws-c 汇报(2026-08-23)

## 实际改动(2 commits on feat/poi-daily-run,基于 dda9555)

1. `1bb3815 feat(geocode): 跨日进度持久化` — `server/scripts/geocode-sites-apply.mjs` + `.gitignore`
   - **进度文件**:`server/.geocode-progress.json`(root `.gitignore` 已登记 `/server/.geocode-progress.json`)。格式:
     `{ version, updatedAt, mode: APPLY|DRY-RUN, flags: {only, cities}, run: {planTotal, attempted, resolved, unresolved, applied, skippedTotal, quotaExhausted, untouched}, remaining: {total, byCity: [{city, count, sites: [slug:siteId]}]} }`
   - 运行结束统一写盘(正常收尾与配额短路共用同一段代码);剩余 = 预扫 `needing` − 本次 `applied`(写回坐标的站点明天由 `siteNeedsGeocode` 幂等跳过;unresolved/skipped 计入剩余待重试)。**进度文件只报告/排程,不参与判定**。
   - 启动时若存在进度文件即打印「上次运行进展 + 剩余 Top 城市 + 配额事实 + 续跑提示」;`--continue` 为显式续跑标记(默认行为一致,仅 banner 差异)。
   - 预扫顺带记录每站目标城市(`siteCityTarget` 纯函数,无网络),供按城分组。
   - 城市分组键归一化(首 token 去「市」,如 `上海  南京` 脏值归入 `上海` 组),与 `--cities` 的 startsWith 过滤口径一致;排序上海/北京/深圳优先,其余按剩余数降序。
   - 头部注释写入配额事实(2026-08-23 查证,个人开发者配额):AMap place-text ~100 次/日(lbs.amap.com)+ 百度地点检索 ~100 次/日(lbsyun.baidu.com)+ 腾讯地点搜索 ~100 次/日(lbs.qq.com)≈ 300 站/日,1076 站全量约 4 天。
2. `fe228d9 feat(geocode): 每日封装` — `server/scripts/geocode-sites-daily.mjs`(新)+ `server/package.json`
   - `npm run geocode:sites:daily -- --cities 上海`:spawn apply(stdio 继承)→ 退出码 2(QUOTA_EXHAUSTED)时读进度文件打印「明日续跑指引 + 剩余 Top 城市 + 配额事实 + 下一城命令」;退出码 0 但仍有剩余(被过滤)时提示下一城;退出码与 apply 一致透传。
   - 检索逻辑全部留在 apply 脚本,封装保持薄。

## 行为验证(dry-run,无 key 环境)

`npm run geocode:sites:apply -- --dry-run --cities 上海`(等价于门禁命令;无 .env.local → 自动 DRY-RUN),尾行输出:

```
=== 进度已记录 (/Users/acccan/dm-wt-pds-c/server/.geocode-progress.json, 仅报告/排程辅助, 不参与判定) ===
剩余 1275 站 (按城市): 上海 272 | 北京 254 | 深圳 183 | 成都 107 | 广州 97 | 武汉 49 | 南京 36 | 西安 35 | …共 178 城
配额事实 (2026-08-23 查证, 个人开发者配额): … ≈ 300 站/日 — 2026-08-23 实测 backlog 1076 站 (上海 269 / 北京 246 / 深圳 182 …), 全量约 4 天。
单城跑法: npm run geocode:sites:apply -- --cities 上海   (每日封装: npm run geocode:sites:daily -- --cities 上海)

QUOTA_EXHAUSTED: AMap+百度+腾讯 配额耗尽(或无可用 key),已提前停止,剩余 1259 站待下次运行。
```

二次运行(经 daily 封装)验证启动读回 + 续跑指引,均正常(见上「上次运行进展」块)。退出码 2 透传正确。

## 遇到的问题

1. **worktree planTotal 1275 vs boss 实测 1076**:worktree drops 是 dda9555 快照,boss 在主工作树用真实 key 跑 r5 已写回的部分坐标(未提交)不在 worktree 内,故预扫数偏大。环境快照差异,非逻辑错误;进度文件以 worktree 内数据为准,merge 后自然一致。
2. **城市脏值**(`上海  南京`、`北京 洛阳  海外` 等 178 城):分组键归一化(首 token 去「市」)解决;与 `--cities` startsWith 过滤口径一致,报告的提示命令可直接命中。
3. 无 key 环境 dry-run 因 `no-key` 属配额类失败 → 连续 5 站后 QUOTA_EXHAUSTED 短路 exit 2(既有行为,非本次改动;本次未触碰检索/短路逻辑,仅在其后追加进度记录)。
4. 未新增/改动 `tech/` 文档(ws-d 负责 runbook);只写代码注释。

## 门禁结果

- `npm test`:1487 测试 — **1485 通过 / 2 skip / 0 失败**
- `npm run typecheck`:通过(tsc --noEmit 无输出)
- `make docs-check`:通过(grep 命中仅 4 处,全部在 `parallel-sessions/` 内,Makefile `--exclude-dir=parallel-sessions` 排除;本次未新增命中)
- `git diff --check HEAD~2..HEAD`:通过(无 whitespace error)
- 行为验证(dry-run):通过,见上

## 证据

- 进度文件示例:`server/.geocode-progress.json`(已 gitignore,git status 干净,未入库)
- dry-run 完整输出见上方摘录;daily 封装验证输出含「=== 今日配额耗尽 — 明日续跑指引 ===」块

门禁: PASSED
结论: OK
