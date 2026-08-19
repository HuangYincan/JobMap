# Deferred Notes — 20260820-boss-scan-optimize

> 需用户决策 / Env-only 项,不派 worker,任务全部完成后统一告知。
> 来源:quality-scans/20260820-all/scan-report.md

| # | 类型 | 内容 |
|---|------|------|
| scan#3 | 数据口径 | **同公司多 slug 合并**:radar 里 4399/4399游戏、dexmai/dexmal-原力灵机、nvidia/nvidia英伟达、tp/tp-link、sharpa/sharpa-robotics、minimax/minmax、上海电气/上海电气集团,及 official-career 与 radar 大小写不同(MiniMax vs minimax、Momenta vs momenta)。地图同公司多 pin、聚合计数重复。需用户拍板:同官网/同品牌是否合并、以哪个 slug 为准。批准后建 slug 别名表或按(名称归一,城市)合并。 |
| scan#5 | 数据口径 | **slug/显示名拼写错误**:akuna-capitai(Akuna Capital)、doiphindb(显示名「DoIPhinDB智臾科技」→ DolphinDB)、hrnetgronp(HRNet Group)、中信证劵(→证券)。slug 已作为 poiId/siteId 入库,改名需确认是否影响已保存/投递引用;建议修正时保留旧 slug 别名。 |
| scan#8 | 采集口径 | **robots 失败策略**:fetch_robots 网络异常/≥400 时当前返回允许(True)。建议 404/无 robots→允许(惯例),网络异常/5xx→拒绝(保守)。用户拍板后派 worker 改 acquire.py。 |
| scan#14 | Env-only/数据 | **串味行 DB 数据修正**(147 行/76 家, city 标签↔坐标矛盾):当前查询层 SQL+客户端双重剔除,数据修正批次需执行窗口 + import apply(Env-only)。 |
| scan#4-apply | Env-only | 双 https 修正(JSON 已派 ws-data 修)后重新 import 使 DB 生效:import apply 需执行窗口,不自动跑。 |
