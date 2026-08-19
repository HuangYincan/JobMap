# Deferred Notes — 20260819-boss-cluster-tune

> 需用户决策 / Env-only / 数据口径的项。boss 不询问、不中断,任务完成后统一告知。

| ts | 类型 | 内容 |
|---|---|---|
| 2026-08-19 | Env-only | **跨城串味数据修正(本批 ws-a 只做查询层防御)**:DB 147 条「非杭州城市标签但坐标在杭州 bbox」的 company_sites 行(深圳 22/成都 18/北京 25/上海 30/广州 9/武汉 4,76 家公司,背后 914 open 岗位)。根源 = import/geocode 把一公司某杭州办公室坐标盖到所有城市行。查询层滤除后,这些公司的真实外地 office 在数据修正前不会显示。需用户确认后执行:修 import provenance + 重跑 `plan-site-geocode` / `geocode-sites-apply`(数据修正流程)。 |
| 2026-08-19 | 其他 | **icon 存量导入(承接 prev)**:`npm run import:seed:apply` + bump MODE_CACHE_VERSION + `audit:pins`,需用户确认。 |
| 2026-08-19 | 其他 | **连续快速交互 marker 失步(承接 prev)**:生产构建下复验。 |
| 2026-08-19 | 其他 | **favicon.im IP 域名覆盖率(承接 prev)**:ADR-007 已记。 |
| 2026-08-19 | 其他 | **B3 聚合 Playwright 验收(承接 prev)**:merge 后浏览器手动 zoom≤8 验证徽章/下钻(本批 ws-b 已改锚点,验收一并做)。 |
| 2026-08-19 | 其他 | **城市中心表覆盖面**:ws-b 静态 CITY_CENTERS 只含主要城市,未知城市回退 pin 均值。后续可扩表/用 city_code+AMap 行政区中心(Env)。 |
| 2026-08-19 | 其他 | **质量扫描 #4 真实 OTP 发送(产品决策)**:限流/尝试上限/过期清理本轮已做;「接入真实 SMS/邮件发送、删除 demo hint 000000」上线前需产品决策,暂保留 demo 语义。 |
| 2026-08-19 | 其他 | **质量扫描 #13 robots 失败策略口径**:fetch_robots 网络异常当前返回 True(允许);「404/无 robots 允许(惯例)vs 网络异常拒绝(保守)」区分口径需采集策略确认。 |
| 2026-08-19 | 其他 | **质量扫描 #15 全国 radar drops 站点占位名(Env-only)**:腾讯等「剩余岗位」占位名 + 无坐标;geocode:sites:apply 落坐标后按城市派生站点名(需 AMAP_WEB_KEY 配额)。 |
| 2026-08-19 | Env-only | **质量扫描 #6 map-shell 巨型组件拆分(2822 行)**:已作为 qa6 派发(视口加载/搜索状态/缓存还原抽 hooks,零行为变化,component-contracts 门禁)——**进行中**,不再是 deferred;浏览器回归验证留 VERIFY 阶段。 |
| 2026-08-19 | 其他 | **docs 扫描 #20(09-secondary-sidebar 420px 口径)**:qa5 skip,口径需与 WS-U1 汇报交叉确认,保持原状。 |
| 2026-08-19 | 其他 | **docs 扫描 #23(regression-fix 批次状态)**:qa5 skip,需主 Agent 确认批次完成状态后再改文档。 |
