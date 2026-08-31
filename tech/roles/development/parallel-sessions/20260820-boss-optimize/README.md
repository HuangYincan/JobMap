# 20260820-boss-optimize — Boss 优化批次(无人值守)

> **创建**:2026-08-20(boss-agent,目标「完成优化任务」)
> **dev 基线**:`cc9fae1`(455 tests / 453 pass / 2 skip;typecheck 0 错误)
> **授权**:用户明示无人值守、24h、无 token 上限、AMap/Baidu API 限额内合理使用(有界 Env 步骤可执行;全国 geocode 仍 deferred)

## 目标(用户 5 项)

1. bug:B3 聚合假数据(成都无岗位却有聚合徽章)+ 贝达药业未聚合
2. bug:首次点击公司 POI 后视角切回杭州
3. favicon.im IP 域名覆盖不足
4. 文档维护(docs 扫描 #20/#23 + 17 文档命运等)
5. 数据爬取/完善多城真实公司、岗位信息(代码侧 + 有界 Env 数据修正)

## 根因摘要(boss 已探明,详见 prompts)

- **聚合**:`city-cluster.ts` 纯前端按 `sites[0].city` 标签分组;唯一坐标↔标签防御 `cityBoundsConsistencySql` 仅单城市视野(bbox≤6 sq.deg)生效,zoom≤8 全国视野失效 → 147 条串味行漏入「成都」徽章;计数受 tier 过滤+池只增不减影响不稳定。
- **favicon**:`company-logo.ts` 无 IP 识别/映射表,favicon.im 对裸 IP 404 → emoji;49 处 seed logoUrl 为 Google s2 死链。
- **视角**:地图加载后 ~2.5s 被重建(Explore 调查中,见 prompts/w2.md)。
- **数据**:串味根因(geocode override 无 city 门控)已于 8/19 代码修复;剩 drops source 缺失、CITY_CENTERS 16 城不全、radar 占位站点名、CITY_TARGETS 7 城。

## Workstream 表

| WS | 分支 | 主题 | prompt | 汇报 | 拥有 | 不碰 |
|---|---|---|---|---|---|---|
| w1 | fix/cluster-consistency | 聚合坐标↔标签防御+计数口径+贝达用例 | prompts/w1.md | reports/w1.md | city-cluster.ts、spatial-query.ts(参考框)、map-shell.tsx 仅 clusterState 区、对应测试 | city-centers.ts(w5)、POI 定位链(w2)、company-logo(w3)、crawler/data(w5) |
| w2 | fix/poi-first-locate | 首次点击 POI 视角切回杭州 | prompts/w2.md | reports/w2.md | 地图重建/定位链/map-shell 点击区、对应测试 | clusterState 区(w1)、company-logo(w3)、crawler/data(w5) |
| w3 | feat/logo-coverage | IP 识别+DOMAIN_LOGO_MAP+icon.horse 兜底+清 s2 死链 | prompts/w3.md | reports/w3.md | company-logo.ts、poi-card/poi-detail/map-markers logo 区、seed-data logoUrl、company-logo.test | city-cluster/map-shell 核心(w1/w2)、crawler/data(w5) |
| w4 | docs/sync-20260820 | #20 380px 注记、#23 regression-fix 完成、17 命运、data-quality 范围、b2-u1-u6 manifest | prompts/w4.md | reports/w4.md | 上述文档文件 | server/ 代码、crawler、data 文件 |
| w5 | feat/data-code-coverage | drops source 补齐+import 尊重 source、CITY_CENTERS 扩展、radar 站点名归一、CITY_TARGETS 扩城、city_site_id | prompts/w5.md | reports/w5.md | crawler/app/domain_map_importer、server/data/recruitment/**、recruitment-import.ts、city-centers.ts | geocode 脚本(Env,boss 跑)、w1/w2/w3/w4 文件 |

## 合并顺序

1. w5(data 基础:city-centers 扩展/数据文件;w1 徽章锚点依赖)→ 2. w1(聚合)→ 3. w3(logo)→ 4. w2(视角)→ 5. w4(docs,最后)
实际顺序 merger 按冲突情况微调;每分支合并后跑完整门禁,红则停。

## Env 步骤(boss 在合并验证后统一执行,用户已授权合理使用;日志与配额记录进 merge-report 与 deferred-notes)

1. `make db-up`(如 PG 未起)
2. 串味 147 行修正:`plan-site-geocode` + `geocode-sites-apply --dry-run` → apply(有界)
3. `npm run import:seed:apply` + bump MODE_CACHE_VERSION + `audit:pins`(icon 存量导入 D-02)
4. 按城市派生 radar 站点名已由 w5 代码侧处理;全国 radar drops geocode(630 公司/1194 无坐标站点)= deferred D-03(大额配额)
5. 贝达药业 DB 行验证(boss 用 psql 核对 tier/岗位)

## 角色

- 开发:`boss-worker`(headless,spawn-worker.sh;w5 加 `Bash(python3*)`/`make test-unit` 授权,自定义 spawn)
- 收尾:`boss-merger`(headless,spawn-merger.sh)
- 验证:boss(门禁 token + 测试计数 + git log + 有界 Env 执行)
