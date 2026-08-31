# Deferred Notes — 20260823-boss-scan-fix

来源:质量扫描 `tech/roles/development/quality-scans/20260823-all/scan-report.md`。以下项 boss 判定**需用户决策/Env-only/追踪**,本轮不派发。

## 需用户决策

| 时间 | 类型 | 内容 |
|---|---|---|
| 2026-08-23 | 数据口径 | #9:`证劵` 别字扩散 13 文件(radar 11 + qqdoc-jobs 2);3 个新疑似转录错误——中国**一众**集团(cfhi.com=中国一重,site 齐齐哈尔)、**城堡证劵**(Citadel 官方中文=城堡证券)、**方联**证劵(careerUrl wlzq.zhiye.com=万联证券)。修复需拍板:**改名是否影响已保存/投递引用(旧 id 别名策略,016 site_key 可作锚)** + 疑似三项人工核对 |
| 2026-08-23 | 数据口径 | #19:同公司多 slug(radar 7 对 + official-career/radar 跨源大小写不合并):合并口径——同官网/同品牌是否合并、以哪个 slug 为准;需用户拍板后建别名表或按(名称归一,城市)合并;修后 import 计数联动 |
| 2026-08-23 | 其他 | #16:`crawler acquire.py robots 失败口径`——「404/无 robots 允许」惯例 vs「网络异常/5xx 保守拒绝」需用户拍板(deferred-ledger D-05 追踪) |
| 2026-08-23 | 其他 | #2:全局 OTP 发送每日预算数值(本批已实现 per-IP/per-account/per-target 守卫;全局桶需产品决策) |

## Env-only(用户操作)

| 时间 | 类型 | 内容 |
|---|---|---|
| 2026-08-23 | Env-only | #4:代码已改「生产缺 SESSION_SECRET 拒绝签名」;实际在**生产环境设置 SESSION_SECRET** 属用户操作(tech/15 部署时) |

## 追踪(不派,条件触发)

| 时间 | 类型 | 内容 |
|---|---|---|
| 2026-08-23 | 追踪 | #10(D-18):map-shell.tsx 3210 行持续增长,继续抽 hooks(抽屉手势/代理桥/收藏图层渲染),component-contracts 门禁;**本轮不派**:4195c9b5 会话仍在推进地图引擎相关批次,与该组件冲突面大;待该会话结束后的下一轮再评估 |
| 2026-08-23 | 追踪 | #15:spatial-query city/district ILIKE 前置通配符无索引;数据量到万级后补 pg_trgm GIN(记录:2026-08-23 数据量 companies 1040,未达触发线) |
| 2026-08-23 | 追踪 | 4195c9b5 会话仍在运行(engine-polish-2 轮10+),dev 会继续变动;本批合并前一律 pull 最新 dev,若与后续轮次重叠需重新对账 |
