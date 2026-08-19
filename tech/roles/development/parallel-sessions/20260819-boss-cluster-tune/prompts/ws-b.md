# ws-b — Bug2 聚合徽章不在市中心

## 背景

用户「聚合点没有处在市中心」。Explore 已确认根因:

**`clusterCities` 把徽章锚点 = 组内 pin 坐标的算术均值**,而非该城市行政中心。
- `server/src/lib/city-cluster.ts:81-89`:`lng: mean(g.lngs), lat: mean(g.lats)`;
- `server/src/lib/map-markers.ts:303`:`createCityClusterMarker` 用 `[group.lng, group.lat]`
  作徽章位置;
- `map-shell.tsx:1385-1405` 建徽章、`:1398`(点击下钻 `setZoomAndCenter(11, [group.lng, group.lat])`)
  飞到同一均值点——所以**徽章位置和下钻落点都偏离市中心**。

对北京这种 20-40 个散落办公室的城市,pin 均值可能落在城郊,甚至跨城(若组内含 147 条
错误坐标会更糟,但那是 ws-a 处理;本 ws 只管「市中心锚点」)。

**仓库里没有任何城市中心静态表**:
- 唯一的城市坐标都是杭州(`public-search.ts:9` HANGZHOU、`map-constants.ts:20-23` DEFAULT_CENTER);
- DB 迁移无 city center 列(`006`/`011`);
- 唯一能拿真实市中心的是 AMap geocode/regeo(`amap-api.ts:633`,`site-geocode.ts:222`)——
  那是 **Env-only**(要 AMap_KEY 调 REST),不自动跑。

## 修复方向(纯静态,无 Env)

新增**纯静态城市中心表** `server/src/lib/city-centers.ts`:
```ts
export const CITY_CENTERS: Record<string, { lng: number; lat: number }> = {
  北京市: { lng: 116.40, lat: 39.90 },   // 天安门/市政府一带
  上海市: { lng: 121.47, lat: 31.23 },
  杭州市: { lng: 120.15, lat: 30.27 },
  深圳市: { lng: 114.06, lat: 22.55 },
  成都市: { lng: 104.07, lat: 30.66 },
  广州市: { lng: 113.26, lat: 23.13 },
  武汉市: { lng: 114.30, lat: 30.59 },
  // …可补 南京/苏州/西安/重庆/长沙 等主要城市(公司数据里出现过的城市)
};
```
- **key 归一**:`clusterCities` 经 `poiCity` 取 `site.city`(`city-cluster.ts:36-40`),可能带
  「市/省」后缀(`site-geocode.ts` 把 regeo cityname 存成「北京市」)。加一个 `bareCityName`
  归一(去 `[省市区]$` 后缀,参考 `spatial-query.ts:32-35`),用裸名查表;查不到 → 回退均值。
- **`clusterCities` 改造**(`city-cluster.ts:81-89`):城市命中静态中心时用中心值作 `lng/lat`;
  未命中 → 保留现有均值兜底(不破坏确定性/顺序)。
- 徽章位置与下钻落点同源(都读 `group.lng/lat`)→ 自动一起修正,无需动 map-markers/map-shell。

## 测试(必做)

- `server/tests/city-cluster.test.mjs`:新增「已知城市用静态中心、未知城市回退均值」用例;
  现有「锚点=均值」断言需改为「已知城市=中心」;保持 分组/计数/阈值/输出顺序/无 city 个体
  全绿。
- 新增 `city-centers` 的归一测试(「北京」/「北京市」命中同一键)。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-wsB)

- 只动:`server/src/lib/city-centers.ts`(新)、`server/src/lib/city-cluster.ts`(锚点取值)、
  `server/tests/city-cluster.test.mjs` / (新)`city-centers.test.mjs`
- **不碰**:`server/src/lib/map-markers.ts`、`server/src/components/map-shell.tsx`(ws-c 区域)、
  `server/src/lib/recruitment-store.ts`(ws-a)、`server/src/lib/spatial-query.ts`(ws-a)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsB/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsB && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-cluster-tune/reports/ws-b.md`:
改动文件 + 根因简述 + 实现 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。

## 续作附录(boss 2026-08-19,首次派发静默空跑 exit 0,零产出)

首次 spawn 空跑(1 字节 log、无 commit、无 report)。worktree 仍停在 dev `963700f`,
零改动——本附录只是幂等重派说明,无任何需接续的成果。
开工先 `git status` + `git log --oneline -1` 确认,然后按正文完整实现。

## 续作附录 2(boss 2026-08-19,重派后预算超限中断)

已做(未提交):`server/src/lib/city-centers.ts` 已写好(15 城静态中心 + `bareCityName`
归一 + `cityCenter(city)` 查询)。`city-cluster.ts` **尚未接线**。开工先 `git status`
确认,不重做。剩余任务:
1. **先 commit**:`git add server/src/lib/city-centers.ts && git commit -m "feat(cluster): 静态城市中心表(聚合锚点取行政中心,均值兜底)"`
2. **接线 `city-cluster.ts:81-89`**:`clusterCities` 的 lng/lat 取值改为
   `cityCenter(city) ?? 均值`(import cityCenter;裸名命中表);未命中 → 现有均值兜底。
   保持输出顺序/确定性不变。
3. **测试**(必做):`server/tests/city-cluster.test.mjs` 加「已知城市用静态中心、
   未知城市回退均值」;现有「锚点=均值」断言按需改为「已知城市=中心」。`city-centers`
   归一测试('北京'/'北京市' 同一键)。
4. 门禁全绿 + 写报告。
5. 预算纪律:先 commit 再验证。
