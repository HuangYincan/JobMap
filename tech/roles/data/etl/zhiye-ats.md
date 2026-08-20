# Zhiye (Beisen italent `*.zhiye.com`) source review

> **Status:** ✅ adapter implemented (2026-08-20, `crawler/app/domain_map_importer/ats_zhiye.py`) — live crawl pending (boss Env E3).
> **Reviewed:** 2026-08-19 (finding); 2026-08-20 (implementation)
> **Owner:** data

## Platform

北森(Beisen)italent 招聘门户,139 个 radar 公司 careerUrl 落在 `*.zhiye.com`(全 drops 中最多)。

## Sample evidence(2026-08-19)

`fixtures/zhiye-iflytek.html`(iflytek.zhiye.com,HTTP 200 / 35KB):门户壳 + 内联配置。

- `var BSGlobal = {...}` 门户配置:`PortalId:"6e2235dc-4b88-4698-b96a-5a73c705d8db"`、`tenantInfo.Domain:"iflytek"`、导航「校招职位 → 全部职位列表 → `jumpUrl:"/jobs"`」;页面含「校园招聘」文案但**零岗位行**。
- SPA 包已定位:`BSGlobal.staticPath = "//acdn.bstatics.com/ux/ux-recruitment-portal-2022/release/dist/"` + `pc-ef703ae29522fd7fa535.chunk.min.js`(2022 portal 构建,含页面路由逻辑)。
- HTML 内全部 URL 为 portal-oss 静态资源(portal-oss.zhiye.com 的 image/resource),无任何 JSON 接口地址;列表由 JS 加载。

## Adapter implementation(2026-08-20)

`crawler/app/domain_map_importer/ats_zhiye.py` 把三步探针实现为**运行时代码**(探针本身即采集流程,无需预先人工确认端点):

1. **壳 HTML**:`fetch(careerUrl)` → `parse_bs_global` 取 `PortalId` / `tenantInfo.Domain`;`bundle_url` 取 `ux-recruitment-portal-2022` 的 `pc-*.chunk.min.js`(protocol-relative → https)。
2. **Bundle**:单次礼貌 GET → `extract_api_paths` grep 引号内 `/api/*` 候选(过滤 login/captcha/upload 等非岗位路径)。
3. **端点探测**:`probe_endpoint` 按 job 关键词( position/job/recruit/search )优先,GET `?portalId=…`,非 JSON 响应再试 POST `{"portalId":…}`;首个返回可解析岗位列表的端点胜出,`fetch_all_jobs` 按 `?portalId=…&page=N&pageSize=M` 分页到 total/max_jobs。

**响应契约**(首个实采后锁定,见校准点):`{"code":0,"data":{"list":[…],"total":N}}`;别名 `data.list/jobs/records`、`total/count/totalCount`、行 id `jobId/positionId/id`、标题 `title/name/positionName`。

**输出**:与 feishu 同款 SourceCompany drop(继承 radar curated sites,为 job 城市补 `{slug}-site-{pinyin}` 站点);岗位 `externalId = portal-zhiye-{id}`(`portal-*` 前缀被 `isAuthenticPositionId` 视为真实岗位);聚合类标题按 radar 校准的 `is_aggregate_title` 标记 `aggregate: true`;`source: "zhiye-ats"`。

**接线**:`cli.py zhiye --dir <radar> --out-dir <official-career> [--only …] [--write]`——租户即 radar drops 中 careerUrl 落 `*.zhiye.com` 的公司(139 家),dry-run 默认不写;`--page-size`/`--max-jobs`/`--interval` 与其他命令一致。

**合规**:全程 `PoliteFetcher`(robots 门禁、≥2s 节流、诚实 UA `DomainMapImporter/0.1`),无登录/无验证码/无限流绕过;带分享 token 的 referral 链接一律不请求。robots.txt / 条款观察仍需网络(首次实采时记录)。

## Verdict

**可实现(代码已就绪,待采集校准)**:职位列表 API 端点不在 HTML 中,但三步探针已固化为适配器运行时行为,端点与响应形状由探针实测后锁定。

**校准点(boss Env E3 首次实采后回填本文件)**:
1. bundle 内实际 `/api/*` 路径与 `_BUNDLE_RE` 的 2022 版本匹配度;
2. 岗位列表端点的真实 method/query(portalId 参数名、分页参数名);
3. 行字段名与 `_ID_KEYS`/`_TITLE_KEYS`/城市字段别名是否吻合;
4. robots.txt 与条款观察记录。

## 后续

- boss Env E3:实采 139 家(礼貌、按探针契约);实测后按校准点回填本文件,升级为 live-validated。
- `tech/roles/data/data-sources.md` 台账同步为「adapter implemented, live crawl pending」。
