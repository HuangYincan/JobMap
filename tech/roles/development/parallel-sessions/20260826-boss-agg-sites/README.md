# 批次 Manifest — 20260826-boss-agg-sites(radar 聚合岗位饿死多城站点修复)

## 用户发现

「很多大公司的 POI 没有收录,比如深圳腾讯。」

## 根因(boss 已逐层验证)

数据在、坐标真实,但被「聚合行单站挂载」饿死:

1. crawler(`radar_jobs.py:276-281`)对**全国性招聘大类标题**(aggregate,如「技术类 产品类 市场类 设计类 职能类」)把岗位挂到 `main_site_id = sites[0]`(第一个城市占位);仅当标题明确含单一城市才挂该城市。这是快照约定,不是数据错误。
2. 读路径 POI 粒度 = 一站点一 POI;positions 按 `siteId === site.id` 精确分配:
   - 离线:`server/src/lib/recruitment-source.ts` `poiFromSourceSite`(约 :248 `.filter((p) => p.siteId === site.id …)`)
   - DB:`server/src/lib/recruitment-store.ts` `positionsBySite`(:184-189 按 pos.site_id 分桶)
3. 结果:`腾讯:腾讯-site-beijing` 独占 3 个 radar 聚合岗 → 深圳/上海/广州 POI positions=0 → `.filter(positions.length > 0)` 整条排除。

量化:radar 含 aggregate 行公司 **594 家**,其 1385 站中 **696 站零岗位**(腾讯/字节/美团/百度/京东/小米全中)。

## 修复方案(boss 裁定)

**aggregate 行 = 公司级在招信号,计入该公司每个站点**;specific 行仍按 siteId 精确归属。
语义依据:crawler 注释自述 aggregate 标题是「招聘大类」(全国性),site_id 只是占位 —— 挂到全部站点是对上游语义的忠实展开,不是虚报(specific 岗位不动)。

| ws | 分支 | worktree | 合并顺序 |
|---|---|---|---|
| g-agg-sites | fix/aggregate-site-fanout | /Users/acccan/dm-wt-g-agg-sites | 1 |

门禁:`cd server && npm test` + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/g-agg-sites.md。不 merge、不 push、不碰主树、不跑 geocode/import、不改 crawler(Python 侧约定保留,TS 读路径修)。

## final (2026-08-26)
- FINISHED — worker 中断 1 次(3 commit 已落)→ 续作补测试+门禁 PASSED → merge c2e5196 push origin/dev
- boss VERIFY: 主树 1677 tests/1674 pass/0 fail/3 skip;CI run 32914940285 success;POI 总数 529→833,腾讯深圳等 696 饿死站恢复
- merge-report.md 由 boss 补写(merger 会话在写报告前被杀,合并动作本身已完成并逐项复验)

## 不做
- 不改 crawler/radar_jobs.py 的 site_id 占位写法(上游快照约定;TS 读路径是唯一消费方)。
- 不动 specific 行为与 alive/isAuthenticPositionId 过滤。
- LLM 校验(llm-validate)/i18n 的 aggregate 引用不在本批(如测试牵连最小适配)。
