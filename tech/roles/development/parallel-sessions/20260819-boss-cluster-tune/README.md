# Manifest — 20260819-boss-cluster-tune

## 目标

用户 /boss-agent 请求(2026-08-19):

1. **BUG 1**:缩放后杭州附近出现了深圳、成都等(跨城 POI 串味)
2. **BUG 2**:聚合点没有处在市中心
3. **BUG 3**:第一次点击公司 poi 总是会回到用户所在位置
4. 修完 bug 后做**全库代码审查**,再**持续优化**

## 根因(Explore 已确认)

| Bug | 根因 | 文件:行 |
|---|---|---|
| 1 | DB `company_sites` 147 条「city=深圳/成都/北京/上海等但坐标=杭州」行(76 公司,914 open 岗位);SQL 只按 geom bbox 裁剪,不校验 city↔bounds 一致性;客户端 runPOIPipeline 无 inBounds | recruitment-store.ts:114-120, spatial-query.ts:79-84, search.ts:818-864, map-shell.tsx:1333-1341 |
| 2 | 聚合锚点 = 组内 pin 坐标均值,非城市行政中心;仓库无城市中心表 | city-cluster.ts:81-89, map-markers.ts:303 |
| 3 | 挂载 geolocation 异步回调(setCenter(userLocation))与首次点 pin 竞态,把相机拽回用户位置;仅首次(geolocation 只 resolve 一次) | map-shell.tsx:549-562, amap-api.ts:567-615 |

## workstreams

| ws | 分支 | 主题 | 文件 | 状态 |
|---|---|---|---|---|
| ws-a | fix/cross-city-bleed | Bug1 查询层 city↔bounds 一致性防御(数据重灌 Env-only → deferred) | recruitment-store.ts、spatial-query.ts(抽纯函数)、tests | PENDING |
| ws-b | fix/cluster-center | Bug2 静态 CITY_CENTERS 表 + clusterCities 用中心锚点(均值兜底) | city-centers.ts(新)、city-cluster.ts、tests | PENDING |
| ws-c | fix/first-click-locate | Bug3 挂载 geolocation 相机移动加「已交互」守卫(hasInteractedRef) | map-shell.tsx、tests | PENDING |

## 合并顺序

1. ws-a → 2. ws-b → 3. ws-c(文件互不冲突,可并行开发;合并按完成序,冲突按「不碰」解决)

## 后续里程碑

- MERGE 全部绿 → VERIFY 浏览器复验 3 bug
- 全库代码审查(boss-scanner all)→ 审批 → fix 批次
- 持续优化(用户已授权按计划推进)

## VERIFY 结果(2026-08-19,实机 DB + API 复验)

| Bug | 验证方式 | 结果 |
|---|---|---|
| 1 跨城串味 | `/api/pois?mode=work&bounds=杭州视口(119.9,30.1,120.5,30.4)` | ✅ total=26,全为 杭州市/杭州 标签,**零跨城**;对照:同 bbox 旧 SQL(仅 bbox)会返回 101 条跨城行(沪28/京23/深22/蓉16/广8/汉4),现被 `cityBoundsConsistencySql` 滤除 |
| 1 全国视野 | 同 API 大 bbox(100,20,125,40) | ✅ 不裁剪,107 条含 上海6/北京4/广州1 + 杭州,真实跨城徽章保留 |
| 2 市中心锚点 | 纯函数 `clusterCities`(北京散点 116.0~117.0) | ✅ 锚点 116.4/39.9 = CITY_CENTERS 北京(非均值 116.567/40.000);未知城市(哈尔滨)回退均值 ✅ |
| 3 首点被拽回 | code review map-shell | ✅ setCenter/setZoom/setMapCenter 全进 `if (!hasInteractedRef.current)`;dragstart/zoomstart/click/onMarkerClick 四处置位;handleLocate 原义保留 |

dev @ 7e03adf(3 merge commits 232a2ea/95f2502/7e03adf)已 push origin/dev,worktree 已清,fix/* 分支已删。
