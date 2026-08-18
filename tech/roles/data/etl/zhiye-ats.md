# Zhiye (Beisen italent `*.zhiye.com`) source review

> **Status:** finding only — adapter NOT implemented this round (API endpoint not derivable from sample; no live probe possible in worker session).
> **Reviewed:** 2026-08-19
> **Owner:** data

## Platform

北森(Beisen)italent 招聘门户,138 个 radar 公司 careerUrl 落在 `*.zhiye.com`(全 drops 中最多)。

## Sample evidence(2026-08-19)

`fixtures/zhiye-iflytek.html`(iflytek.zhiye.com,HTTP 200 / 35KB):门户壳 + 内联配置。

- `var BSGlobal = {...}` 门户配置:`PortalId:"6e2235dc-4b88-4698-b96a-5a73c705d8db"`、`"Domain":"iflytek"`、导航「校招职位 → 全部职位列表 → `jumpUrl:"/jobs"`」;页面含「校园招聘」文案但**零岗位行**。
- SPA 包已定位:`BSGlobal.staticPath = "//acdn.bstatics.com/ux/ux-recruitment-portal-2022/release/dist/"` + `pc-ef703ae29522fd7fa535.chunk.min.js`(2022 portal 构建,含页面路由逻辑)。
- HTML 内全部 URL 为 portal-oss 静态资源(portal-oss.zhiye.com 的 image/resource),无任何 JSON 接口地址;列表由 JS 加载。

## Verdict

**本轮不可实现**:职位列表 API 端点不在 HTML 中;worker 沙箱内 `curl` 被禁,无法从 bundle 提取或实测。**不存在「可验证事实」支撑的端点,不写未经验证的适配器**(项目规则:文档必须反映可验证事实)。待 boss 试点探针:

1. 抓 `https://acdn.bstatics.com/ux/ux-recruitment-portal-2022/release/dist/pc-ef703ae29522fd7fa535.chunk.min.js`(单请求、礼貌)grep `api/` 路径 — 该 bundle 含全部页面路由与接口地址。
2. 或直接探测 `https://iflytek.zhiye.com/api/...` 候选(以 `jumpUrl /jobs` 对应端点优先)。
3. 确认后按 feishu-ats.md 模板补 `ats_zhiye.py` + 本文档升级为 implemented(138 个 radar 公司落 zhiye 子域,收益最大,建议优先于 hotjob)。

robots.txt / 条款观察:未取(需网络),PoliteFetcher 门禁照旧生效。**不绕过登录/验证码/限流**。
