# Workstream g-agg-sites — radar 聚合岗位按公司级信号 fan-out 到全部站点

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-g-agg-sites`,分支 `fix/aggregate-site-fanout`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(boss 已验证根因,用户发现:「深圳腾讯没有收录」)

链路(crawler → 数据 → 读路径):

1. `crawler/app/domain_map_importer/radar_jobs.py:276-281`:aggregate 标题(全国招聘大类,如「技术类 产品类…」,is_aggregate_title 判定,~87% 行)挂到 `main_site_id = sites[0]`(首城占位);仅标题明确单一城市时挂该城。
2. TS 读路径 POI 粒度 = 一站点一 POI,positions 按 siteId 精确分配:
   - **离线目录**:`server/src/lib/recruitment-source.ts` `poiFromSourceSite`(约 :240-270):`.filter((p) => p.siteId === site.id && (!opts.openOnly || isOpenPosition(p)))`;调用方 `sourceCompanyToCatalogPois`(:262-280)与 `sourceCompanyToPois`(:215-222)后 `.filter(poi.positions.length > 0)`。
   - **DB 目录**:`server/src/lib/recruitment-store.ts` :184-189 `positionsBySite` 按 `pos.site_id` 分桶,:234 `positionsBySite.get(site.id) ?? []`。
3. 后果:`腾讯:腾讯-site-beijing` 独占 3 个 aggregate 岗 → 腾讯深圳/上海/广州 POI positions=0 → 整条排除。量化:radar 594 家含 aggregate 行公司、1385 站中 696 站零岗位(字节/美团/百度/京东/小米同病)。数据文件本身没问题(`server/data/recruitment/radar/腾讯.json` 4 站坐标全真实,3 岗 externalId=radar-* 且 `aggregate: true`,全挂 `腾讯-site-beijing`)。

`aggregate` 标志的既有流转:SourcePosition.aggregate(recruitment-source.ts:33)→ import 带 flag 入库(recruitment-import.ts:356-362)→ DB PositionRow 经 taxonomy.aggregate 读回(recruitment-store.ts:255)→ i18n/llm-validate 有展示侧引用(只读,勿改其语义)。

## 任务

### 1. 核心修复 — aggregate 行公司级 fan-out

**离线路径 `recruitment-source.ts`:**
- `poiFromSourceSite` 的 positions 过滤改为:specific 行仍 `p.siteId === site.id`;**aggregate 行(`p.aggregate === true`)计入每个站点**(即 filter 条件 = `p.siteId === site.id || p.aggregate === true`,openOnly 语义保持)。
- 注意 `mergeCompanyOntoSeedPois`(seed 合并路径)如有同样的 per-site 分配逻辑,同步检查并一致处理(先读该函数再决定,汇报说明)。

**DB 路径 `recruitment-store.ts`:**
- `positionsBySite` 分桶后,:234 处取数改为「精确 site_id 命中 ∪ aggregate 行」。实现建议:分桶时额外维护一个 `aggregateRows`(taxonomy.aggregate === true 的 PositionRow 数组),站点取 `(positionsBySite.get(site.id) ?? [])` 与 aggregate 行合并;注意去重(某 aggregate 行 site_id 可能恰等于本站 id,不能双计)、排序稳定(跟随现有顺序约定)。

### 2. 语义守卫(防误伤)

- fan-out 仅限 `aggregate === true` 的行;specific 行绝不扩散。
- 单站点公司行为不变(fan-out 后仍只有一条 POI,无重复)。
- 「一 POI 一职场」粒度不变:不合并站点、不新增 POI,只是 positions 计入。
- 展示层(i18n aggregate 徽标等)零改动 —— 它们按 position.aggregate 渲染,fan-out 后自然随站点出现。

### 3. 测试(风格跟随现有)

- `server/tests/recruitment-source.test.mjs` 或相邻文件(先看现有覆盖在哪):
  - 多站点公司 + aggregate 行挂首站 → 每个 POI 都含该 aggregate 岗;specific 行只在归属站出现;
  - aggregate 行 siteId 恰等于某站 id → 该站不双计;
  - 单站点公司 → 零变化;
  - openOnly 过滤与 aggregate fan-out 叠加正确(closed aggregate 行不出现)。
- `server/tests/recruitment-api.test.mjs`(DB 读路径):aggregate 行 fan-out 到每站 + 去重用例(mock pool 风格跟现有)。
- 端到端锚点:离线目录加载后 `腾讯:腾讯-site-shenzhen`(及 guangzhou/shenzhen)POI 存在且 positions ≥ 1(可用 loadOfflineWorkCatalog 或 sourceCompanyToCatalogPois 直测 radar adapter 输出,风格跟 server-catalog.test.mjs 现有 mock 方式;若全量 catalog 加载过重则用构造 SourceCompany 直测)。

### 4. 文档

- `tech/18-national-scale-plan.md` 或 radar 数据流相关文档(tech/ 下 grep 'aggregate' 定位):补一段「aggregate 行 = 公司级在招信号,读路径 fan-out 到公司全部站点(2026-08-26,fix/aggregate-site-fanout);crawler 侧 site_id 占位约定不变」。
- 若 tech/21(聚合徽章计数)描述「徽章 N = 全部公司数」受 POI 数变化影响,检查措辞是否需要更新(计数口径没变,只是 POI 变多,预计无需改;确认即可)。

### 5. 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-g-agg-sites/server && npm test
cd /Users/acccan/dm-wt-g-agg-sites/server && npm run typecheck
cd /Users/acccan/dm-wt-g-agg-sites && make docs-check && git diff --check
```

> 附带验收(worktree 内可直接跑,汇报里给数字):离线目录腾讯 4 城 POI 是否齐、总 POI 数从 ~617 变化多少。命令参考:
> `node --experimental-strip-types -e "import {loadOfflineWorkCatalog} from './src/lib/server-catalog.ts'; const c = await loadOfflineWorkCatalog(); console.log('total', c.length); console.log(c.filter(p=>p.name==='腾讯').map(p=>p.id+':'+p.positions.length))"`

## 文件边界

**拥有**:`server/src/lib/recruitment-source.ts`、`server/src/lib/recruitment-store.ts`、`server/tests/{recruitment-source,recruitment-api,recruitment-store,server-catalog}.test.mjs`(按需)、tech 文档。

**不碰**:crawler/**、server/data/**、`src/lib/{mode-cache,server-catalog,city-centers,site-geocode}.ts` 逻辑(mode-cache 版本号**不需要**动 —— 目录内容变化走数据刷新,版本 bump 只留给语义变化;若你判断必须 bump,在汇报说明理由交 boss 裁决,先不要改)、components/hooks、scripts/**、`.env*`、主树。

## 提交

Conventional Commits(`fix(recruitment-source): aggregate 行公司级 fan-out 到全部站点 — 大厂多城 POI 恢复`、`fix(recruitment-store): DB 读路径 aggregate fan-out + 去重`、`test(recruitment): …`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260826-boss-agg-sites/reports/g-agg-sites.md`,含改动摘要、**fan-out 前后 POI 计数对比**、门禁结果、遇到的问题、结论。末两行:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
