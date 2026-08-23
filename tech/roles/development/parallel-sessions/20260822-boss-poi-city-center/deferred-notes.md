# Deferred Notes — 20260822-boss-poi-city-center

| ts | 类型 | 内容 |
|---|---|---|
| 2026-08-22 | Env-only | **geocode r5 apply**:`cd server && npm run geocode:sites:apply`(需 AMAP_WEB_KEY / BAIDU_MAP_AK / TENCENT_MAP_KEY;AMap place-text 日配额 100 次 + 百度/腾讯兜底,可分多日跑)。前置:本批 ws-a(grader 放宽)落地。预期:1092 中心待重跑站落真实坐标(其中 ~151 真实街道地址站 address geocode 直接命中;~941 城市列表占位地址站公司名检索命中)。执行后 JSON drops 坐标更新,数据需 commit(可叫 boss 跑下一批数据入库)。 |
| 2026-08-22 | Env-only | **import:seed:apply**:`cd server && npm run import:seed:apply`(需 DATABASE_URL)。geocode r5 完成后执行,把 JSON 坐标落地 Postgres。**关键**:DB 当前实测 1556 站钉城市中心(> JSON 1346),r4 数据(3e6deb3)从未 import——即使不跑 r5,先 import 一次也能让 DB 对齐 r4(1556→1346,−210)。 |
| 2026-08-22 | Env-only | **UI 验证 + MODE_CACHE_VERSION**:import 后验证地图堆叠下降(上海/北京/深圳最明显);数据变化需 bump `server/src/lib/mode-cache.ts` 的 MODE_CACHE_VERSION(先例:df4b26d 15→16)并 commit。 |
| 2026-08-22 | 数据口径 | ~150 国内站无坐标(招聘公告城市,公司在该城无公开办公室,城市中心表 86 城未覆盖三四线):不落中心,接受现状或后续扩展 CITY_CENTERS(沿用 20260821-boss-address-first 同款记录)。 |
| 2026-08-22 | 数据口径 | 41 个海外站点无坐标(AMap geocode 不支持海外地址):如需落点需集成 OSM Nominatim(沿用 address-first deferred 记录,不在本批范围)。 |
