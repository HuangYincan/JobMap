# Deferred Notes — 20260820-boss-national-data

| # | 类型 | 内容 |
|---|---|---|
| D-1 | Env-only | **geocode:sites:apply(明日配额重置后跑)**。AMap place-text(10044)+ Baidu(302 天配额超限)双配额今日耗尽,8 城坐标 geocode 阻塞。已就位:fetch 20s 超时 monkey-patch(ca54ce7)+ BAIDU_MAP_AK 注入修复(0b7c1da)+ w4 地址-城市一致性门控(奇安信类错配拦截)。明日重跑后,上海 379 个未 geocode 站点 + 南京/西安 51/47 站点将获得坐标,聚合徽章数字自然增长。命令:`npm run geocode:sites:apply -- --cities 上海市,北京市,深圳市,成都市,广州市,南京市,武汉市,西安市`(需 AMAP_WEB_KEY / BAIDU_MAP_AK,配额外自动兜底)。注意脚本不读 .env.local,需先 `set -a && . ./.env.local && set +a`。 |
| D-3 | 其他(源不可用) | zhiye 北森源 148 租户全量采集 0 可采(robots.txt 阻断 / 新版 portal 无 API 路径)——适配器与合规约束正确工作,源在 robots 约束下不可用;增量由飞书源承担,后续可关注 zhiye robots 策略变化 |
