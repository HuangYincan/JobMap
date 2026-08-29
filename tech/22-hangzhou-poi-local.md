# 22 — 杭州 POI 本地化 + 高德省调用回退(Domain 模式)

> **Status:** 已落地(2026-08-17,`feature/hz-poi-local`,Stage 1–4 完成,Stage 5 文档 + 回归)
> **Owner:** product / data
> 来源审查:`tech/roles/data/etl/hangzhou-poi.md`;计划:`tech/20-development-plan.md`

## 背景与动机

Domain 主地图模式原本由浏览器直连 `AMap.PlaceSearch`(`extensions:'all'`),
一次视口刷新最多 9 分类 × 4 页 = **36 次**高德 API 调用(`viewport-search.ts` +
`amap-api.ts`)。2026-08-17 高德基础搜索服务(关键字/周边/多边形/ID/输入提示)
真实触发**日配额 10044**,方案必须把主要流量从高德 API 移走。

用户持有**全国数亿条高德 POI 数据**(已授权可入库,含高德图床 photos URL),
Demo 阶段先做杭州:全量数据入库,地图 POI 全量分层展示(取决于 zoom),
**杭州外回退高德但开销极小**。

## 数据源事实(实测)

来源:`/Users/acccan/Downloads/杭州市/杭州市POI.csv`(2026-08 导出)。

| 项 | 值 |
|---|---|
| 行数 | 1,006,185(入库唯一 1,006,158,27 个重复 poi_id 合并) |
| 体积 | 603MB,58 列,UTF-8 |
| id / name / address / 坐标 | 100%(GCJ-02 + WGS84 双套) |
| 分类 | `bigType/midType/smallType/typecode` 100% |
| `adname` | 13 区县全 |
| photos | 460,527 行(46%)有图,高德图床 URL |
| rating | 414,160 行(41%),0–5 |
| cost | 8% |
| **恒缺** | `reviewCount` / `reviews` / `website`;`biz_ext.open_time` 前 30 万行 0 命中 → `open_hours` 本数据源恒空(前端已对真 poiid 提供「查看评价」高德外链,见 2026-08-19 bug-fix 记录) |

**格式坑**(python-repr,非标准 JSON):

- `photos`:`[{'url':'http://...','url_mid':'...'}]` — 键和值都是单引号
- `location`:`"120.135,30.25"`(lng,lat 字符串)
- `biz_ext`:`{'rating':'4.4','cost':'50'}` — 单引号 dict,值带引号

解析正则必须容错 `['"]?` 前缀:`/['"]?url['"]?\s*:\s*'([^']+)'/g`。

坐标范围(GCJ-02):经度 118.36–120.70,纬度 29.20–30.56。

## 表设计(迁移 013)

`db/migrations/013_hangzhou_pois.sql` — 单表 `hz_pois`:

- 主键 `poi_id`(高德 poiid);`city_code` 默认 `'330100'` — 全国扩展分区预留
- `lng_gcj/lat_gcj` 为展示坐标,**零转换**(高德底图 GCJ-02,浏览器 bbox 也是
  GCJ-02,直接 `&&` 匹配;WGS84 会整体偏移 ~500m,仅留 `lon_wgs84/lat_wgs84` 参考列)
- `geom`:`GENERATED ALWAYS AS ST_SetSRID(ST_MakePoint(lng_gcj, lat_gcj), 4326) STORED`
- `photos jsonb`(提取的 URL 数组)、`tier smallint DEFAULT 12`
- 7 索引:geom gist、adname、name trgm gin、big_type、tier、rating DESC、city_code
- CHECK:坐标粗略域(100-130 / 25-35)、`rating 0–5`、`tier 0–21`(photos 无格式约束)

## Tier 映射(可见最小 zoom,tier ≤ floor(zoom) 显示)

| big_type | tier | 说明 |
|---|---|---|
| 风景名胜 / 科教文化 | 0 | 地标,任何 zoom 都显示 |
| 政府机构 | 2 | |
| 交通设施 | 3 | |
| 购物 / 公司企业 | 5 | |
| 住宿 / 体育 / 医疗 / 金融 | 8 | |
| 生活服务 | 9 | |
| 餐饮服务 | 10 | |
| 商务住宅 / 汽车 / 公共设施 | 11 | |
| 室内设施 | 12 | 默认 |
| 地名地址 / 通行设施 / 虚拟数据 / 道路附属 / 事件活动 | 21 | **永隐** |

`tierForCategory(bigType, midType, smallType)` 为纯函数(`lib/hz-poi-import.ts`)。

## 导入管线

`server/scripts/import-hz-pois.mjs`(npm script `import:hz:pois[:apply]`):

- csv-parse 流式读(不整文件入内存);`cleanCsvRow` 缺必填弃行
- 临时表 stage → 批量 multi-row `INSERT ... ON CONFLICT (poi_id) DO UPDATE`
  (**幂等可重跑**,已二次验证:重跑后 count 保持 1,006,158)
- 旗标:`--apply`(缺省 dry-run)、`--truncate`、`--limit N`
- DATABASE_URL 从 `server/.env.local` 读,不打印任何 key
- 实测:全量导入 ~数分钟;西湖区 bbox 查询 102ms

## 读路径 API

`GET /api/pois/domain-local?bounds=west,south,east,north&zoom=13&q=&categories=&limit=50&offset=0`

- bbox **必填且必须完全落在** `HANGZHOU_BBOX={west:118.3,south:29.1,east:120.8,north:30.7}` 内；缺失/格式非法/逆序 → API 400 `INVALID_BOUNDS`，越出导入范围 → 400 `BOUNDS_OUT_OF_RANGE`。SQL 使用 `p.city_code = $1`(缺省杭州 `330100`,全国按城扩表时换城码)再 `p.geom && ST_MakeEnvelope(...)`；store 层即使被其他调用方直接使用，也会把缺失 bbox 限制到该导入范围。
- `q`:`name ILIKE`;`categories`:`big_type = ANY(...)`
- common 过滤下推:`(rating > 0 OR jsonb_array_length(photos) > 0 OR tier <= 3)`
  (与 AMap 的 `isCommonPoi` 语义对齐:有评分/有图/地标才值得上卡)
- `ORDER BY rating DESC NULLS LAST, photos DESC, poi_id`(稳定性)。**不要**再写 `count(*) OVER()` 与 ORDER BY rating 同一层——规划器会走 `hz_pois_rating_idx` 把 gist 当成 Filter,百万行上超过 3s `statement_timeout`(2026-08-29 实测西湖小框 24s)。视口跨度 ≤ 0.35° 用 `WITH clipped AS MATERIALIZED` 先走 `hz_pois_geom_gist`;全市/城级包络(杭州导入范围 ~2.5°×1.6°,以及未来北上广整城框)不物化,靠 `city_code` + rating btree + `LIMIT` 早停。空页 count 带 `LIMIT 1001` 帽。
- `LIMIT` 钳 1..300,`OFFSET` 钳 0..1000；SQL 单次返回上限 300，公开读通过 `queryPublicRead` 设置 3s `statement_timeout`（注入池也有可测超时竞速）；非法数值(NaN)落回默认;
  `zoom` 钳 0..20(0 = 仅 tier-0 地标,20 封顶防止 tier-21 永隐类放出)
- public-cache 30s;**仅真实查库成功时缓存**——DB 故障/表缺失的空兜底响应
  带 `no-store`,避免把「走回退」伪装成成功 200 并缓存 30s
- HTTP 缺失 bounds 直接 400；store 直调缺失 bounds 时使用杭州导入范围作为防御性边界，不执行全表热门榜。
- 返回 `{ total, offset, limit, source:'local', results }`;无库/空 → 空数组
- 坐标 GCJ 零转换;photos 截 3;`category=big_type`、`subcategory=mid_type`

## 前端分叉(poi-service + map-shell)

`fetchDomainPOIs` 按 `inHangzhouBox(center)`(`HANGZHOU_BBOX`:
{west:118.3, south:29.1, east:120.8, north:30.7})分叉:

- **杭州内 + 关键词**:先 `GET /api/pois/domain-local?q=...`(视口 bbox 内
  `name ILIKE`);本地 0 命中(如搜「北京天安门」)才回退高德 1 次
- **杭州内 + 浏览**:本地分页,每批 `DOMAIN_BATCH_SIZE=50`,累计
  `DOMAIN_POI_HARD_CAP=1000`(`mergePoisById` 按 id 去重)
- **杭州内 + 浏览 + 已选分类**(2026-08-19 分类门控):`categories=big_type`
  下推 + **全量循环**——每页 `limit=300`(API 上限),offset 0→300→600→900,
  短页 / 服务端 total 取尽即停;offset 到 API 上限(1000)或累计
  `DOMAIN_POI_HARD_CAP`(1000)为止(尽力全量,受容量保护)
- **杭州外**:`searchViewportPOIsFallback` — `fallbackTaskWindow` 每轮只
  `full.slice(pageOffset, pageOffset + 1)` = **1 次 PlaceSearch(25 条)**;
  AMap 请求失败 → 返回 0 条,**不卡死进程**
- 本地库未导入 / 网络错 → 杭州内也自动回退高德,不白屏

## UI(Stage 4,2026-08-17 用户定稿)

- **无限滚动**:初始 50 条,IntersectionObserver 哨兵(viewport + 400px 提前量)
  到底自动 +50;依赖 `[pois.length]` 重新 observe(React 重建哨兵节点);
  loadingMore 期间不重复触发
- **上限 1000**:`catalog.length >= DOMAIN_POI_HARD_CAP` 后哨兵停止触发,
  显示「── 已达加载上限 ──」;顶部不显示计数(只有底部提示)
- **数据耗尽停止**(`8822a01`):main load 后数据未增长(且此前有数据)→
  标记 noMore,哨兵与 handleNeedMore 同时短路,显示「── 没有更多结果 ──」
  (与「已达加载上限」区分)。覆盖稀疏视野(<1000 匹配)、高德回退窗口耗尽、
  关键词无更多页——否则哨兵每轮发请求但 0 新增,无限空转;视口替换时重置;
  模式切换/会话缓存还原时同样复位(`e7323c7`)
  - **权衡**:杭州外回退窗口(36 任务)在「某轮 0 新增」时也会触发 noMore,
    剩余关键词页不再消费——预算只少花不超花(≤1 次/滚动),符合「开销极小」
    的优先目标;数据完整度让位于配额安全
- **价格档位**(`fd9608a`):`hz_pois.cost`(83,667 行,8.3%)此前入库未读出,
  本地卡 priceLevel 恒空。现 `SELECT p.cost` + 与 `normalizeAMapPOI` 同口径
  映射(`min(4, ceil(cost/100))`),休闲/健身/娱乐类目可显示 ¥ 档
- **视口变化刷新**:平移/缩放 → 800ms 防抖 → 按 live bounds 替换 + 淡入
  (`existing: []`,offset 归零;`VIEWPORT_DEBOUNCE_MS` 为 work/domain 共享,
  work 视口按需加载同样变为 800ms)
  - **work 分支同样为「替换」**(`fix/viewport-refresh`,2026-08-19):早期 work 视口
    刷新是**增量合并**(`loadWorkViewport` 传 `existing: catalogRef.current`),工作目录仅
    ~79 家公司,首屏+加载更多几乎全捕获 → 刷新返回 0–11 家全部被去重,列表冻结。
    现镜像 domain:`existing: []` 按 live bounds 替换、`viewportEpochRef += 1` 丢弃在飞
    主加载的旧视野追加批次、`setPageOffset(0)` + skipFetch 武装、视口替换时复位 noMore
    (与 w3 noMore 对接)。
  - **主加载在飞不吞视口刷新**:视口 loader 遇 `loadingRef.current` 不再静默 return,而是
    置 `viewportRefreshPendingRef` 标记;主加载 `finally` 释放 loadingRef 后补跑
    `viewportLoaderRef.schedule()`(防抖内合并,不重复加载)。
- **删除「加载更多」按钮**;刷新按钮**只在卡片总数为零**时显示(桌面 + 移动)
- 加载过渡:骨架屏 → 淡入 stagger(`--index: i % 8`),Apple 风格 18px spinner
  (`prefers-reduced-motion` 适配)

### 会话缓存交互(踩坑记录)

`MODE_CACHE_VERSION 4→5`(旧高德行失效重拉)。缓存早退守卫必须同时比对
`query`:原实现只比 `pageOffset` + `refreshToken`,换关键词时命中缓存早退,
**永远不发请求**——UI 上表现为搜索任何新词都是 0 结果且无网络请求
(已被 `query === cached.query` 修复,`d127ec2`)。

`loadingRef` 释放坑:取消中的 load 其 `finally` 原本跳过 `loadingRef.current =
false`,被取消后该 ref 永久卡 true → 后续所有 load() 直接短路、不再发任何
请求。修复:`finally` 无条件释放 ref,状态更新仍以 `signal.cancelled` 守卫
(同一提交)。

## 搜索建议(Stage 5,2026-08-18 WS-U3)

`GET /api/suggest?mode=domain&q=...&center=lng,lat` 本地优先:

- **domain 分支查 `hz_pois`**:`city_code`(缺省 `330100`) + `name ILIKE 'q%'` 前缀匹配(带 common 过滤下推、
  rating 排序),`adname` 作 subtitle,返回 `location`(GCJ 零转换)+ 可选
  `distance`(米,`center` 提供时服务端用 haversine 算好;公司行用 site 坐标)。
  全国扩表后建议必须带城码,禁止对全国做前缀热门榜。
  本地 0 命中 / 无库 → 空列表(客户端回退高德 AutoComplete 一次,回退失败
  返回空不卡死)。
- **空结果不缓存**:客户端 suggest LRU 与 `/api/suggest` 公共缓存都只写入
  非空响应——首次空结果不再「死」5 分钟挡回退信号。
- **suggest effect 依赖收窄为 `[query, mode]`**:`zoom`/`catalog` 改经 ref
  读取,平移/分页不再重置 200ms 防抖(旧 `[query, mode, zoom, catalog]` 在
  hz-poi 批量加载时候选永远不落地)。
- **work 分支**不加载全目录：公司名/岗位匹配由 `loadWorkSuggestionsFromDb` 下推 SQL，按前缀与现有岗位 trigram 可用的 contains 条件筛选，公司/岗位各自 `LIMIT 10`；标签计数走聚合 count。
- 点击建议:work 公司未加载时经 `/api/pois/[id]?mode=work` 拉详情打开;
  domain 行优先打开已加载富卡,否则用 `location` upsert 会话卡。

## 验证记录

| 项 | 结果 |
|---|---|
| 导入幂等 | ✅ 重跑 count 保持 1,006,158 |
| 本地首屏 | ✅ 1 次 `/api/pois/domain-local`(替代 36 次 AMap),50 条 |
| 无限滚动 | ✅ 50→100→…→1000(offset +50 链),到顶停止 + 已达上限提示 |
| 视口刷新 | ✅ zoom out 1000→100,offset 归零,替换 + 淡入 |
| 关键词链 | ✅ 杭州内先本地 q=(0 命中)→ 回退 AMap 1 次;失败返回 0 不卡死 |
| 详情照片 | ✅ 本地库渲染(3 张,含地址/电话/评分) |
| 测试 | ✅ 271 个(`node --test tests/*.test.mjs`)、typecheck、build |

## 已知缺口与后续

- **AMap 日配额**(10044,2026-08-17):杭州外 fallback 代码已就位,换新 key 即可用
- `reviewCount/website` 本数据源恒缺(前端已对真 poiid 提供「查看评价」高德外链);`open_hours` 空
- 关键词搜索仍按当前视口 bbox 约束(与旧 AMap searchNearBy 半径语义一致);
  点搜索建议(本地 hz 前缀 / AMap AutoComplete 回退)会飞过去再刷视口
- 全国扩展:表已带 `city_code` + 分区注释;读路径/建议已按城码等值裁剪(当前恒
  `330100`)。后续城市导入同管线,调用方传入目标 `cityCode`,前端把
  `inHangzhouBox` 换成「该城市已导入」判定。工作模式全国站点走
  `company_sites` gist + `city_code`,与 Domain 本地表分轨,不把全国 POI 扫进
  杭州 gist 查询。
