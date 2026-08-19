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
5. 与现有交互零冲突:视口增量加载、选中高亮、LOD 过滤全部在聚合层之上工作。

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
  视口加载/选中高亮/LOD 逻辑未动(渲染层第二种模式)。
- `server/tests/city-cluster.test.mjs`(新):12 项单测(分组/计数/中心点/
  阈值/无 city 个体/非 work 上下文/输出顺序/徽章 HTML 与构造契约)。
