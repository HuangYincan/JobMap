# 并行开发批次索引(Parallel Sessions)

> **用途**:`tech/roles/development/parallel-sessions/` 下全部并行开发批次的导航入口。
> 每个批次一个目录,按约定存放 `README.md`(manifest)+ `prompts/` + `reports/` +
> `merge-report.md` + `boss-state.md` + `deferred-notes.md`。
> 各批次 deferred-notes 的 open 项统一追踪见 **[deferred-ledger.md](../deferred-ledger.md)**;
> 质量扫描报告见 [quality-scans/](../quality-scans/)(20260819-docs / 20260819-all / 20260820-all)。

## 目录结构约定

| 文件/目录 | 内容 |
|---|---|
| `README.md` | 批次 manifest:目标 / 根因摘要 / Workstreams 表(ws、分支、worktree、prompt、汇报、拥有/不碰)/ 合并顺序 / 门禁 / Env 步骤 |
| `prompts/<ws>.md` | 每个 workstream 一份开发 prompt(背景、任务、文件边界、门禁、回报契约) |
| `reports/<ws>.md` | 每个 workstream 一份汇报(实际改动、门禁结果、问题、证据;末两行 token) |
| `merge-report.md` | 收尾合并报告:逐分支 merge 明细、冲突解决清单、遗留问题、最终 dev 状态 |
| `boss-state.md` | boss 无人值守批次的运行状态机(meta/根因/stage/workstreams/merge_order/adjudication) |
| `deferred-notes.md` | 需用户决策 / Env-only / 数据口径 / 验收的遗留项(open 项统一登记进 deferred-ledger) |

> **in-flight 数据(未入库,2026-08-21 复验):** `feat/qqdoc-jobs-source` 分支含 qqdoc-jobs drops(163 家新增公司,腾讯文档投递链接,commit `29f8583`),未合并 dev、无会话目录/merge-report。

## 批次索引(按日期倒序)

| 批次 | 主题(一句话) | 状态 | 关键内容指针 | 入库状态 |
|---|---|---|---|---|
| [20260821-boss-qqdoc-official](20260821-boss-qqdoc-official/README.md) | 腾讯文档官方源(qqdoc-official)落地:142 家央企/银行/国企 adapter + 官网地址提取(92 家有真实城市、50 家 city-pending) | **DONE**(w1 单分支,`1ec3fff` 合入,批次 `786fc99` 入库) | README.md · merge-report.md(门禁 PASSED,555 pass/2 skip) | 已入库(2026-08-21,merge-report 存在) |
| [20260821-boss-geocode-count](20260821-boss-geocode-count/README.md) | geocode 配额短路计数修正:真实 planTotal 输出(`1783 (attempted: 5)`) | DONE | README.md(w1 单分支,536 pass/2 skip) | 已入库 |
| [20260821-boss-geocode-memo](20260821-boss-geocode-memo/README.md) | AMap place-text 结果缓存:同 query+region 公司名检索复用,同城多站点一次查询 | DONE | README.md(w1 单分支,530 pass/2 skip) | 已入库 |
| [20260821-boss-geocode-quota](20260821-boss-geocode-quota/README.md) | geocode 双配额(AMap 10044 + 百度 302)耗尽自动短路,不空跑 | DONE | README.md(w1 单分支,520 pass/2 skip) | 已入库 |
| [20260820-boss-scan-optimize](20260820-boss-scan-optimize/README.md) | 全库扫描(20260820-all,15 发现 High 0/Med 6/Low 9)+ 派 5 批自主优化(ws-docs/api/data/hygiene/frontend) | DONE | [deferred-notes.md](20260820-boss-scan-optimize/deferred-notes.md)(scan#3/#5/#8/#14/#4-apply)→ deferred-ledger D-19/D-20/D-05/D-01/D-21 | 已入库 |
| [20260820-boss-rail-settle](20260820-boss-rail-settle/README.md) | 「首点整页刷新」= geolocation settle 相机跳变;settle 门控加「用户已交互」ref | DONE | README.md(三重证据根因 + w1 修复方案) | 已入库 |
| [20260820-boss-rail-prefetch](20260820-boss-rail-prefetch/README.md) | 「首点刷新」= dev 按需编译整页 reload;MapShell 挂载时预载全部 rail 面板 chunk | DONE | README.md(根因 + w1 方案) | 已入库 |
| [20260820-boss-poi-vanish2](20260820-boss-poi-vanish2/README.md) | POI 消失第三轮:remount 后 createMap 硬编码回杭州;改 state 相机 + settle 默认位置门控 | DONE | README.md(浏览器实测证据 + 3 点修复方案) | 已入库 |
| [20260820-boss-poi-vanish](20260820-boss-poi-vanish/README.md) | 首点 POI → 相机回杭州 + 全消失:hasInteractedRef 门控 + handleLocate 兜底 + distance 圆心 | DONE | README.md(3 根因 + w1 方案) | 已入库 |
| [20260820-boss-optimize](20260820-boss-optimize/README.md) | 用户 5 项:聚合假数据/首点视角/favicon.im 覆盖/文档维护/多城真实数据 | DONE | [deferred-notes.md](20260820-boss-optimize/deferred-notes.md)(D-01~D-18,本批核心账本)→ deferred-ledger 多数条目 | 已入库 |
| [20260820-boss-national-data](20260820-boss-national-data/README.md) | 全国真实岗位拓展(8 城)+ 聚合计数修复(fecef85 事故坐标)+ 上海扩量 | DONE | [deferred-notes.md](20260820-boss-national-data/deferred-notes.md)(D-1 geocode 8 城、D-3 zhiye 源 robots)→ deferred-ledger D-03/D-3 | 已入库 |
| [20260820-boss-bugfix](20260820-boss-bugfix/README.md) | 3 bug:positions 重复 key / POI 屏闪 / Next 16.3.1 升级(+b1f 自愈顺序修复) | DONE | [deferred-notes.md](20260820-boss-bugfix/deferred-notes.md)(E-01~E-04)→ deferred-ledger E-01~E-04 · merge-report(b1/b2/b3/b1f 四 merge) | 已入库 |
| [20260819-boss-cluster-tune](20260819-boss-cluster-tune/README.md) | 跨城串味 / 聚合锚点(市中心)/ 首点被拽回 3 bug + 全库审查前哨 | DONE | [deferred-notes.md](20260819-boss-cluster-tune/deferred-notes.md)(串味修正/icon 导入/marker 复验/OTP/robots 等)→ deferred-ledger D-01/D-02/D-17/D-04/D-05 | 已入库 |
| [20260819-boss-cluster-viewport](20260819-boss-cluster-viewport/README.md) | B3 城市聚合(zoom≤8 徽章)+ 工作 POI 不随视角修复(distance 圆心实时化) | DONE | [deferred-notes.md](20260819-boss-cluster-viewport/deferred-notes.md)(icon 承接/distance 语义已定/B3 验收)→ deferred-ledger D-02/D-16/D-15 | 已入库 |
| [20260819-boss-fix-polish](20260819-boss-fix-polish/README.md) | 视口空白/noMore 闩锁 + marker 泄漏 + 公司 icon 缺失 + 投递行可点击 | DONE | [deferred-notes.md](20260819-boss-fix-polish/deferred-notes.md)(icon 存量/圆心跨城/marker 失步/favicon.im)→ deferred-ledger D-02/D-16/D-17/D-07 | 已入库 |
| [20260819-boss-qa-fixes](20260819-boss-qa-fixes/README.md) | 全库扫描 16 条中技术类 14 条修复(qa1~qa5)+ qa6 map-shell 抽 hooks | DONE | README.md 最终结果段(qa1-qa5 @ 77ea603、qa6 @ 9b5f94a、447 tests) | 已入库 |
| [20260819-boss-smoke](20260819-boss-smoke/README.md) | boss 全链路 smoke(spawn-worker → 汇报 token → spawn-merger → merge-report) | DONE | README.md(w1 CHANGELOG 条目) | 已入库 |
| [20260819-boss-viewport-profile](20260819-boss-viewport-profile/README.md) | 首点定位 Bug1/Bug2 + F1 视口全量加载 + F2 候选类别 + F3 偏好下拉 | DONE | [deferred-notes.md](20260819-boss-viewport-profile/deferred-notes.md)(移动抽屉覆盖设计保留)→ deferred-ledger D-06 | 已入库 |
| [20260819-data-quality-shanghai-poi](20260819-data-quality-shanghai-poi/README.md) | 上海试点:官网 ATS 适配器(feishu/hotjob/zhiye)+ POI 分类加载 + 登录小字 + 收藏图层 bug | DONE | [deferred-notes.md](20260819-data-quality-shanghai-poi/deferred-notes.md)(试点 Env 全执行/聚合拆解里程碑/mokahr WAF)→ deferred-ledger D-10/D-09/D-12 | 已入库 |
| [20260819-mobile-ux](20260819-mobile-ux/README.md) | 移动端:抽屉全开高度/隐藏指南针比例尺/定位按钮/滚动保留/边缘取消选中/占位文案 | DONE | [deferred-notes.md](20260819-mobile-ux/deferred-notes.md)(默认 work 口径确认/视觉验收待办)→ deferred-ledger D-24 | 已入库 |
| [20260819-more-real-data-job-filters](20260819-more-real-data-job-filters/README.md) | 21 家沪杭 feishu 租户批量爬取(10533 岗位落库)+ 岗位级职能筛选 UI | DONE | [deferred-notes.md](20260819-more-real-data-job-filters/deferred-notes.md)(radar geocode 落点/其余 28 租户)→ deferred-ledger D-03/D-09 | 已入库 |
| [20260819-regression-fix](20260819-regression-fix/README.md) | 7 bug:侧控栏 chrome/Profile 塌陷/偏好下拉/工作 noMore/收藏按模式区分/视口刷新 | DONE | README.md(根因表 + 合并执行提示) | 已入库 |
| [20260819-auth-explore-poi](20260819-auth-explore-poi/README.md) | 加载更多 + 密码登录注册 + POI 电话/评价 + 群核岗位拆分 + 最近回实体 + 失焦丢文本 | DONE | [deferred-notes.md](20260819-auth-explore-poi/deferred-notes.md)(Env 全执行/聚合拆解/refresh-radar 覆盖风险/验收清单)→ deferred-ledger D-10/D-11/D-12/D-24 | 已入库 |
| [20260819-b2-u1-u6](20260819-b2-u1-u6/README.md) | 补录 manifest 批:LLM 校验修正 + 侧控栏 chrome + 筛选细化 + suggest + Profile 重构 + 抽屉物理 + poi-mixing | DONE | README.md(7 分支 merge 表 + 冲突解决清单指针) | 已入库 |
