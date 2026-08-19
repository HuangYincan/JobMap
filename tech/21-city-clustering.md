# 21 — 城市聚合(全国/省级视野密度管理)

> 2026-08-17 方案草案,2026-08-19 用户批准(唯一修改:触发阈值 zoom ≤ 7 → zoom ≤ 8)
> 并已实现(ws-a commit,见 §5)。

## 1. 问题

tier 模型落地后:全国视野(zoom ≤ 5)显示 tier ≤ 5 的 ~70 家、省级(6–8)
显示 ~375 家,分布在北京/上海/杭州/深圳等城市,同城 10–50 家 pin 重叠,
无法点选,视觉是"一坨"。

## 2. 交互设计(ASCII 布局图,已批准)

```
zoom ≤ 8(全国 / 省级视野)               zoom ≥ 9(城市级,自动展开)
┌───────────────────────────┐          ┌───────────────────────────┐
│                           │          │                           │
│         ╭────╮            │          │              ╭───╮        │
│    ╭────┤北京 │────╮       │          │         ╭───┤字节│        │
│    │ 12 │    │ 8  │       │          │    ╭────┤   ├───╮        │
│    ╰────╯    ╰────╯       │          │    │阿里│   │腾讯│        │
│    ╭────╮    ╭────╮       │          │    ├────╯   ╰───╯        │
│    │杭州 │    │深圳 │       │          │    │小米│                │
│    │ 15 │    │ 10 │       │          │    ╰────╯                │
│    ╰────╯    ╰────╯       │          │                          │
│                           │          │                          │
└───────────────────────────┘          └───────────────────────────┘
  聚合徽章:圆形,品牌蓝 #007AFF 描边,   点击聚合徽章 →
  白色底 + 「城市名 N」(如「北京 12」)    地图平滑缩放到该城,zoom 11,
                                        聚合徽章消失,个体 pin 出现
```

**规则**:
1. 触发:work 模式,`zoom <= 8`(全国/省级)时启用;`zoom > 8` 自动切回个体 pin。
2. 聚合粒度:`site.city`(公司办公点城市);无 city 的 pin 保持个体。
3. 徽章点击 → `map.setZoomAndCenter(11, 城市中心点)`,城市中心从该城
   所有 pin 坐标取均值(或 DB city_code 中心,先均值)。
4. 徽章 hover 显示城市 + 数量;点击仅下钻,不弹卡片(卡片由个体 pin 负责)。
5. 与现有交互零冲突:选中高亮、个体 pin 的 LOD 过滤(`tier <= zoom`,只属
   zoom > 8 个体层)全部在聚合层之外工作——聚合层不做 LOD,计数与 zoom
   无关(见规则 7)。
6. **坐标↔标签防御(2026-08-20 w1)**:city 标签命中已知参考框
   (`spatial-query.ts` `CITY_REFERENCE_BOXES`)但坐标落在框外(跨城串味行,
   DB 147 行/76 家,2026-08-19 数据修正记 deferred)→ 剔除,防「成都明明
   没岗位却有聚合徽章」类假聚合。参考框未收录城市 / 坐标缺失 → 放行。
   服务端 `cityBoundsConsistencySql` 只覆盖单城视野(bbox ≤ 6 sq.deg),
   全国/省际视野由聚合层补此缺口。
7. **计数口径(2026-08-20 修订,替代 w1 版)**:徽章 N = 该城市**全部**公司数
   (全量池行数),聚合区间(zoom ≤ 8)内与 zoom **无关**——不再按
   `tier <= floor(zoom)` 过滤(2026-08-20 修复:用户报告 zoom<8 继续缩小时
   聚合点数量随 tier 阈值漂移)。LOD(`tier <= zoom`)只作用于 zoom > 8 的
   个体 pin 显示密度,聚合区间不参与。计数 = 池内容:work 模式全量加载后
   池恒定(见 tech/16「2026-08-20:首点刷新」条目),徽章数与导航历史/缩放
   路径无关。分组键与徽章标签用裸城名(`bareCityName`,去省/市/区后缀):
   DB 中「杭州市」/「杭州」并存(102+50 站点),不归一会出现同一城市两个
   徽章。下钻 zoom 11 后按 LOD 显示 tier ≤ 11 的公司,数量多于徽章是 LOD
   设计(放大涌现),不是计数不一致。

## 3. 实现(一切皆插件)

| 模块 | 内容 | 测试 |
|---|---|---|
| `lib/city-cluster.ts`(新) | 纯函数:输入 POI[] + zoom,输出聚合组 `{city, count, lng, lat}[]`;`CLUSTER_MAX_ZOOM=8`、`CLUSTER_DRILL_ZOOM=11` 常量 | 单测:分组/计数/中心点/阈值切换/无 city 个体/输出顺序(见 §5) |
| `lib/map-markers.ts`(扩展) | `cityClusterBadgeHTML` + `createCityClusterMarker(amap, map, group, {color, size, onClick})`:圆形徽章 AMap.Marker(品牌蓝描边、白底、「城市名 N」、中心锚定、bubble:false) | 徽章 HTML/构造契约单测 |
| `map-shell.tsx`(接线) | work 模式 zoom 变化时在两种 marker 模式间切换;徽章点击 setZoomAndCenter(11, 中心) | Playwright 验收(可选) |

**插件缝**:聚合是 map-markers 的第二种渲染模式,不侵入 POI 数据流;
未来"按 category 聚合"(如全国视野按行业分组)可复用同一 controller。

## 4. 不做的事(本期)

- 不做 AMap MarkerClusterer(自动网格聚合)——样式与"城市"语义不符,
  无法点击下钻到城市;自定义徽章样式与品牌一致。
- 不做 DB 端聚合计数(百万级才需要;当前 668 家客户端聚合足够)。

## 5. 实现状态(2026-08-19)

用户批准布局图(阈值 zoom ≤ 7 → zoom ≤ 8 后)已实现:

- `server/src/lib/city-cluster.ts`(新):`clusterCities(pois, zoom)` 纯函数 +
  `poiCity(poi)`(取 sites[0].city)。zoom > 8 或非 work 上下文(列表无
  recruitment POI)→ null;按 city 分组计数、中心点取组内合法坐标均值;
  无 city 的 pin 不聚合(调用方保持个体渲染);输出按数量降序(同数按城市名升序)。
- `server/src/lib/map-markers.ts`:新增 `cityClusterBadgeHTML` /
  `createCityClusterMarker`(独立导出,未侵入 POIMarkerController 内部)。
  徽章 54px 圆形、白底、品牌蓝 #007AFF 描边 + 计数、「城市名 N」两行,
  hover 阴影增强,中心锚定,`bubble: false` 阻止点击冒泡到地图。
- `server/src/components/map-shell.tsx`:work 模式 zoom ≤ 8 时按 pipeline
  后的 mapPois 聚合渲染徽章(个体控制器只同步无 city 的 pin,两模式互斥);
  徽章点击 `setZoomAndCenter(CLUSTER_DRILL_ZOOM=11, 城市中心)`,仅下钻不弹卡片;
  聚合层不参与 LOD(2026-08-20 修订):work 模式池 = 全量加载结果(无 tier
  裁剪,见 tech/16),徽章 N 与 zoom 无关;个体层逻辑未动(渲染层第二种模式)。
- `server/tests/city-cluster.test.mjs`(新):12 项单测(分组/计数/中心点/
  阈值/无 city 个体/非 work 上下文/输出顺序/徽章 HTML 与构造契约)。

### 5.1 聚合防御与计数口径(w1,2026-08-20)

- `server/src/lib/spatial-query.ts`:新增 `cityLabelMatchesCoordinates(city, lng, lat)`
  纯函数(bare 归一标签 ↔ `CITY_REFERENCE_BOXES` 参考框判定;未收录/坐标缺失
  → 放行),与 `cityBoundsConsistencySql` 同源复用参考框,不动其查询语义。
- `server/src/lib/city-cluster.ts`:`clusterCities` 分组前防御——① 串味行
  剔除(规则 6);② ~~LOD 可见性过滤~~ 已移除(2026-08-20 修订:聚合区间计数
  与 tier 无关,`maxTierForZoom`/`lodVisibleAtZoom` 从 city-cluster 删除);
  ③ 裸城名分组/标签(`bareCityName`——「杭州市」/「杭州」归入同一徽章,
  与 cityCenter 锚点命中同口径)。均为纯函数内实现,map-shell 调用面不变。
- `server/tests/city-cluster.test.mjs` + `server/tests/spatial-query.test.mjs`:
  契约(串味剔除 6 城、未收录/坐标缺失放行、计数与 zoom 无关——聚合区间
  zoom 0/4/5/6/8 全同、未打标公司计入徽章(缺省 12 也计,2026-08-20 修订)、
  杭州市/杭州归一、贝达 zoom 0-8 全区间杭州徽章、`cityLabelMatchesCoordinates`
  正反例)。
- 验收映射:① 成都徽章消失(串味行被剔除);② 徽章 N 与 zoom 无关、导航
  历史无关(浏览器实测:zoom 6/4/2 恒定 上海26/北京3/杭州27);③ 贝达药业
  (tier 6,杭州临平 120.258/30.438)zoom ∈ [0,8] 出现于「杭州」徽章。
  DB 行过期与否由 boss 合并后验证:
  `SELECT c.name, s.city, s.lng, s.lat, c.tier FROM company_sites s JOIN companies c ON c.id=s.company_id WHERE c.slug='betta-hangzhou'`。
