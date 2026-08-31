# Feishu jobs ATS (`*.jobs.feishu.cn`) source review

> **Status:** ✅ live-validated + full crawl executed (2026-08-19, `cli.py feishu` → official-career drops with `portal-feishu-*` positions). 得物 155 校招+585 社招 / 智元 52+928 / 禾赛 54+137。
> **Reviewed:** 2026-08-19
> **Owner:** data / product

## Platform

飞书招聘 (Feishu ATS / ATSX) 公开职位门户。公司站点为 `https://<tenant>.jobs.feishu.cn/`,页面是 feishu `saas-career` 单页应用(服务端只渲染壳,职位数据由公开 JSON API 提供)。

## 端点发现(2026-08-19,JS bundle 分析)

旧文档的 `GET /api/v1/search_job` 是**猎头平台 catch-all**:任何请求都返回「字节跳动猎头平台」HTML 壳,永远不是 JSON(2026-08-19 实测教训)。真实端点从 `saas-career` bundle(`static/js/5615.*.js` 模块 60877)逆向得出:

```
POST https://<host>/api/v1/search/job/posts?<query 镜像 body>&_signature=<可选>
headers: website-path=<site_id>(选池,见下)
         portal-channel: saas-career, portal-platform: pc(页面 SDK 印章,可选)
body: {"keyword":"","limit":50,"offset":0,"job_category_id_list":[],
       "tag_id_list":[],"location_code_list":[],"subject_id_list":[],
       "recruitment_id_list":[],"portal_type":6,"job_function_id_list":[],
       "storefront_id_list":[],"portal_entrance":1}
→ {"code":0,"data":{"job_post_list":[...],"count":N}}
分页:limit+offset 直到 offset >= count。
```

实测要点:

- **UA 门禁**:爬虫 UA(`DomainMapImporter/0.1`)一律 405,浏览器 UA 200。适配器仅在 feishu 端点 override UA——无登录/无验证码/无限流绕过,仅通过端点自身的 UA 门禁;`robots.txt` 不存在(404,无门禁)。其余爬取保持诚实 UA + 2s 节流。
- **池选择**:`website-path` 头选租户站点池——得物校招官网 `578078`(155 校招)、智元 `946993`(52)、禾赛 `073183`(54);缺省返回社招池(得物 585 / 智元 928 / 禾赛 137)。
- **`_signature` 不需要**(页面 SDK 生成,空查询时省略即可)。
- `portal_type` 对租户无区分(1..8 同池)。
- **salary/address 对游客隐藏**:`job_post_info` 富字段在 list/detail 均为 null;可得字段=标题/完整 JD(description+requirement)/城市列表/招聘类型/发布时间。

## Access method

- 走 `PoliteFetcher`(robots 门禁、≥2s 间隔、无登录/无验证码/无限流绕过)。分页 `limit+offset` 直到 `offset >= count`。
- 爬取入口:`cli.py feishu --out-dir <official-career> --radar-dir <radar> --write`(dry-run 默认不写)。租户配置在 `cli.py FEISHU_TENANTS`(host/website_path/slug/radarBase)。
- drop 继承 radar 的 curated 站点(id/地址/坐标),岗位按城市落 site;新城市补 `{slug}-site-{pinyin}` 城市文本站点。

## Response shape(实测)

```json
{"code": 0, "data": {"job_post_list": [{"id", "title", "description",
  "requirement", "city_list": [{"name": "上海"}], "publish_time",
  "recruit_type": {"id": "201", "name": "正式", "parent": {"name": "校招"}}}],
  "count": 928}}
```

解析器容错:`code != 0`、非 JSON、缺 `job_post_list` 一律记 `api_errors` 并降级到 HTML 启发路径,不中断整批。

## 数据可得性(岗位 × 真实 JD)

| 字段 | 来源 | 状态 |
|---|---|---|
| 岗位标题 | `job.title` | ✅ |
| 真实 JD 文本 | `job.description` + `job.requirement`(HTML → 纯文本,≤8000 字符) | ✅ 本能力价值核心 |
| per-job 详情页链接 | `https://{host}[/{website_path}]/position/{id}/detail` | ✅ |
| 招聘类型 | `recruit_type.name`/`parent.name` → family(校招→campus/实习→intern/全职·外包→social) | ✅ |
| 城市 | `city_list[].name`(禾赛 ATS 笔误「北揽」→ 归一「北京」) | ✅ |
| 稳定性 | `portal-feishu-{id}` 幂等去重,id 为全局 snowflake | ✅ |
| salary/address | 门户对游客隐藏 | ❌ 不可得(诚实展示无薪资岗位) |

## Rate / retention / kill switch

- 默认 2s 间隔;`--max-jobs` 每池上限(默认 2000);失败不中断。
- 职位带 `retrievedAt` 与 `applySource: official`,JD 写入 `description`(import 已支持,`recruitment-import.ts` upsert `description` 列)。
- Kill switch:dry-run 默认不写;或删除 `portal-feishu-*` externalId。
- **数据策略(2026-08-19)**:公司有 `portal-*` 岗位时,`planSeedImport` 抑制其 `radar-*` 聚合行(`suppressRadarForPortalCompanies`)——官方直爬真实岗位优先,radar 快照聚合降级。

## 可信度评估

官方招聘门户直连,JD 与链接由雇主/ATS 录入并公开展示 → **高可信**,优于上游快照聚合行。与 LLM 质检(`validate-positions-llm.mjs`)配合作为真实数据基准。

## 后续

1. 试点全量爬取已完成(得物/智元/禾赛);`import:seed:apply` 后地图显示真实岗位。
2. **租户扩充(2026-08-20,ws-w2)**:以下候选租户已加入 `cli.py FEISHU_TENANTS`(28 家),复用同一适配器,补配置即可;证据 = radar drops careerUrl,website_path 取数字路径段:

   | 租户 | host | website_path | 证据(drop) |
   |---|---|---|---|
   | 英科医疗 | global-intco.jobs.feishu.cn | `840753` | `radar/英科医疗.json`(`/840753/position/list`) |
   | 真格基金 | zhenfund.jobs.feishu.cn | `356542` | `radar/真格基金.json`(`/356542/position/list`) |
   | 原力灵机 | dexmal-inc.jobs.feishu.cn | `285572` | 自身 drop 仅短链 `/s/-cbzfrbbx98`;数字段取自同租户 `radar/dexmal-原力灵机.json`、`radar/dexmai原力灵机.json`(`/285572/position/list`) |
   | 算秩未来 | acnizrso7ikb.jobs.feishu.cn | (空) | `radar/算秩未来.json` 仅 referral token 链接 → 不留 website_path,只爬默认/社招池;token 链接不请求 |

   路径模式一致性核对:带数字路径段的 careerUrl 形态(`/<id>/position/list`、`/<id>/?…`)与既有租户(波克/小鹏等)一致;短链与 referral token 链接按既有规则留空/不请求。
3. 更多 feishu 租户可继续复用同一适配器,补 `FEISHU_TENANTS` 配置即可(radar drops 中仍有 ~40 个未配置的 `*.jobs.feishu.cn` host,后续可系统性扫描)。
