# 批次 manifest — 20260819-more-real-data-job-filters

> 目标(用户 2026-08-19 `/boss-agent`):① 真实数据扩量(不只得物/智元/禾赛 3 家)
> ② 提高沪杭公司数量 ③ 岗位按职能分类 + 岗位筛选(得物 600+ 岗位可筛选)。

## 探索结论(2026-08-19,Explore subagents)

- **飞书 ATS 租户 53 个**(radar drops careerUrl 扫描),49 个未爬。复用 `cli.py feishu`
  适配器(POST `/api/v1/search/job/posts`,website-path 头选池)即可批量扩量。
- radar 630 家公司:上海 348 / 杭州 98 / 北京 91 / 深圳 42——批量 geocode 落点可让
  地图公司数大增(Env-only,key 已配置,待用户授权 apply)。
- 前端岗位筛选现状:公司级筛选完备(FilterPanel:roleFamily/jobTaxonomy/scale/education/
  salary/onlyOpen 等),**岗位级筛选完全缺失**——poi-detail.tsx:208-246 全量平铺渲染
  公司内所有在招岗位(得物 669 岗全渲),无筛选/搜索/分页。

## Workstream 表

| ws | 分支 | 主题 | 产出 | 拥有 |
|---|---|---|---|---|
| ws-data-feishu | feat/data-more-feishu | 21 家沪杭优先 feishu 租户批量爬取 | official-career drops + FEISHU_TENANTS 扩展 | crawler/app/domain_map_importer/cli.py、ats_feishu.py、server/data/recruitment/official-career/ |
| ws-ui-job-filters | feat/ui-job-filters | 岗位级职能分类/筛选 UI(新功能) | poi-detail 岗位列表筛选条 | server/src/components/poi-detail.tsx、*.module.css(及必要传参) |

## 合并顺序

1. ws-data-feishu(数据,爬取→drops)
2. ws-ui-job-filters(前端,独立)

(两 WS 文件不相交,可并行;merge 顺序如上)

## Deferred(本批不自动执行)

- **radar 沪杭公司批量 geocode 落点**(Env-only + 数据口径:公司名歧义需人工审批
  override/exclude;key 已配置,待用户授权跑 `npm run geocode:sites:apply`)。这是
  「沪杭公司少」的另一半解法,本批 feishu 爬取先提供真实岗位增量。
- import:seed:apply(Env-only,本批 drops 合入后由用户执行)。

## 门禁(每个 WS)

- ws-data-feishu:crawler unittest 全绿;`plan-seed-import.mjs` 0 issues/0 dropped;
  每新增 drop 有 portal-* 岗位且带 JD;礼貌节流 ≥2s,失败租户记 error 不中断。
- ws-ui-job-filters:`npm test` 全绿、`npm run typecheck` 干净;新 UI 符合 liquid glass
  设计系统(#007AFF 蓝、12px --blue-ink、chips/搜索条);桌面+移动(drawer)双端生效。

## 汇报契约

worker 写 `reports/<ws>.md`,末两行 token:`门禁: PASSED|FAILED` / `结论: OK|BLOCKED: …`。
