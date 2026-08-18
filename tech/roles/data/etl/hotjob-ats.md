# Hotjob (wecruit / 商汤 hr.sensetime.com) source review

> **Status:** finding only — adapter NOT implemented this round (API endpoint not derivable from sample; no live probe possible in worker session).
> **Reviewed:** 2026-08-19
> **Owner:** data

## Platform

hotjob 系招聘门户(wecruit.hotjob.cn 30+ 站;样本为商汤 `hr.sensetime.com`)。

## Sample evidence(2026-08-19)

`fixtures/hotjob-st.html`(hr.sensetime.com,HTTP 200 / 12KB):Next.js 应用壳。

- 仅 React flight data(`self.__next_f.push`)与导航,零岗位数据(全文 职位/岗位/招聘 仅 1 处导航文案)。
- 职位路由 `/social`、`/campus`、`/exp/position/list` 为独立客户端路由,无 `__NEXT_DATA__` 内嵌数据。
- 站内链接实际落在 `hr-jobs.sensetime.com`(`/exp/position/list`、`/exp/login`、`/edu/`),radar 的 careerUrl 若是 `hr.sensetime.com` 会跳转。
- 首页 chunk 已确认:`/_next/static/chunks/app/(site)/page-fa449ec935f2e119.js`、`layout-b49f1c39547127ab.js`;列表路由 chunk 不在首页 HTML 中。

## Verdict

**本轮不可实现**:无网络会话无法探测接口(worker 沙箱内 `curl` 被禁,样本 HTML 是纯壳);HTML 壳不含可解析数据。**不存在「可验证事实」支撑的端点,不写未经验证的适配器**(项目规则:文档必须反映可验证事实)。待合并后 boss 试点探针:

1. `GET https://hr-jobs.sensetime.com/exp/position/list`(或 wecruit 站对应列表路由)看是否 SSR 出岗位。
2. 抓 `https://hr-jobs.sensetime.com/_next/static/chunks/app/(site)/exp/position/list/page-*.js`(需先拿列表页 HTML 里的 manifest)grep API base(单请求、礼貌)。
3. 确认后按 feishu-ats.md 模板补 `ats_hotjob.py` + 本文档升级为 implemented。

robots.txt / 条款观察:未取(需网络),PoliteFetcher 门禁照旧生效。**不绕过登录/验证码/限流**。
