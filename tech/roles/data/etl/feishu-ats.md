# Feishu jobs ATS (`*.jobs.feishu.cn`) source review

> **Status:** adapter implemented (2026-08-19, `crawler/app/domain_map_importer/ats_feishu.py`); live pilot pending post-merge `make crawl-official --write`.
> **Reviewed:** 2026-08-19
> **Owner:** data / product

## Platform

飞书招聘 (Feishu ATS / ATSX) 公开职位门户。公司站点为 `https://<tenant>.jobs.feishu.cn/`,页面是 feishu `saas-career` 单页应用(服务端只渲染壳,职位数据由公开 JSON API 提供)。

## Sample evidence(2026-08-19)

`fixtures/feishu-nio.html`(nio.jobs.feishu.cn,HTTP 200 / 179KB,URL 读取样本):

- 页面资源全部来自 `atsx-throne/hire-fe-prod/portal/saas-career/`(App 身份铁证)。
- `<script id="js-websiteInfo" type="text/json">` 携带租户身份:`tenant_name`、`tenant_id_md5`、`website_info.id`(NIO = `6982450737365485854`)。
- 特性开关 `ats.job.search_job_with_process_type` 证实职位查询走 `search_job*` API 族。
- 页面 HTML 不含任何岗位行(纯壳)→ 不能走 html_jobs.py 启发,必须走 JSON API。

## Access method

- `GET https://<host>/api/v1/search_job?page_size=<n>&page_token=<t>`(公开文档接口,OSS 项目 feishu-recruitment 等广泛使用;响应字段容错解析,见下)。
- 走 `PoliteFetcher`:`DomainMapImporter/0.1` UA、robots.txt 门禁、请求间隔 ≥2s、无登录/无验证码/无限流绕过。分页用 `page_token` 直到 `has_more=false`,单公司页数上限 5。

## Response shape(documented;live 待验)

```json
{"code": 0, "data": {"job_list": [{"id", "title", "description", "apply_url",
  "recruit_type": "social|campus|intern", "location", "job_category",
  "job_code", "create_time"}], "page_token": "...", "has_more": true}}
```

解析器容错:`data.job_list`/`data.list`、`apply_url`/`apply_link`/`url`、`description`/`job_description`;`code != 0`、非 JSON、缺 list 一律记 `api_errors` 并降级到 HTML 启发路径,不中断整批。

## 数据可得性(岗位 × 真实 JD)

| 字段 | 来源 | 状态 |
|---|---|---|
| 岗位标题 | `job.title` | ✅ |
| 真实 JD 文本 | `job.description`(HTML → 去标签纯文本,≤8000 字符) | ✅ 本 WS 价值核心 |
| per-job 申请链接 | `job.apply_url` | ✅ |
| 招聘类型 | `job.recruit_type` → family(intern/social/campus) | ✅ |
| 稳定性 | 外部 `feishu-{id}` 幂等去重 | ✅ |

## Rate / retention / kill switch

- 默认 2s 间隔;`--limit` 先小批;失败不中断。
- 职位带 `retrievedAt` 与 `applySource: official`,JD 写入 `description`(import 已支持,`recruitment-import.ts` upsert `description` 列)。
- Kill switch:dry-run(`make crawl-official` 默认不写),或删除 `feishu-*` externalId。

## 可信度评估

官方招聘门户直连,JD 与链接由雇主/ATS 录入并公开展示 → **高可信**,优于上游快照聚合行。与 LLM 质检(`validate-positions-llm.mjs`)配合作为真实数据基准。

## Pilot(合并后,boss 执行)

1. `make crawl-official --write --limit 5` 试点 feishu 公司;核对 summary 中 `source: feishu-api` 与 `added`。
2. 若响应形状与 documented 不符(常见差异:字段名、`code` 约定),按 `api_errors` 定位,在 `ats_feishu.py` 容错分支补齐,并回写本文档。
3. `plan-seed-import` 验证 0 issues 后放开全量。
