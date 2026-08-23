# ws-b — OSM Nominatim 海外站数据源(第四 provider)

## 背景(2026-08-23 boss 实测)
JSON drops 2410 站全部有 location,但 1330 站钉城市中心,其中 needsRerun 1076 站含**海外站**(如悉尼、以及 address-first 批次 deferred 记录的 ~41 个海外站点无坐标问题)。AMap / 百度 / 腾讯的 place 检索不支持海外地址——海外站永远无法落真实坐标。本 WS 引入 **OSM Nominatim** 作为海外站解析源(纯技术集成;实际联网执行是 Env-only,用户后续跑)。

## 任务(worktree:/Users/acccan/dm-wt-pds-b,分支 feat/poi-nominatim)
1. **海外站摸底(只读)**:统计 drops 中「城市非 CITY_CENTERS 覆盖 / 城市含海外地名(悉尼/新加坡/东京等)或英文」的站点,给出清单规模与城市分布(汇报中给出数字)。复用 `server/scripts/audit-city-center-pins.mjs` 与现有工具;海外判定以数据实测为准。
2. **Nominatim 集成**(`server/src/lib/site-geocode.ts`):
   - 新增 `nominatimSearchRest(query, target)` 与 `nominatimReverseRest(lng, lat)`(或与现有 REST helper 同风格),调用 `https://nominatim.openstreetmap.org/search`(format=json, limit=1~3, 可带 city 约束)。
   - **政策合规(硬性)**:User-Agent 必须带项目标识(如 `DomainMap/1.0 (job-map contact)`);限速 ≥1 次/秒;不并发轰炸;错误/超时(10s)优雅降级为 null 不崩溃。
   - 海外站判定接入:apply 脚本的 `placeTextSearchRest` 三级兜底(AMap→百度→腾讯)全部失败**且站点是海外站**(如城市不在三 provider 支持范围 / 三 provider 返回空)→ 尝试 Nominatim。海外站判定函数独立命名,不污染国内路径。
   - 若 ws-a 分支(`fix/poi-citylist-branch`,`/Users/acccan/dm-wt-pds-a`)已合并进 dev,复用其多城市列表串判定;未合并时基于 dev 现状自行兼容(提示:合并顺序 a→b,冲突由 merger 处理)。
3. **测试**:`server/tests/` 新增/更新 Nominatim 相关测试(用 mock/fixture 响应,不真调网络);覆盖:海外站路由、Nominatim 失败降级、限速不触发。
4. **来源审查记录**:`tech/roles/data/etl/` 新增或更新文档,记录 OSM Nominatim 数据源审查:数据来源、使用政策(1 req/s + UA 标识 + 不绕过登录/验证码/限流)、与 CLAUDE.md「外部数据采集必须有来源审查记录」合规。

## 文件边界
- 改:`server/src/lib/site-geocode.ts`(新增 Nominatim 函数,独立命名)、`server/scripts/geocode-sites-apply.mjs`(海外路由分支)、`server/tests/`、`tech/roles/data/etl/`(来源审查文档)。
- 不碰:其他源、UI、`tech/29-geocode-r5-status.md`(ws-d 负责)、city-centers.ts 的中心表扩展(数据口径问题,defer)。
- 不 merge / 不 push。

## 门禁
```bash
cd /Users/acccan/dm-wt-pds-b/server && npm run typecheck
cd /Users/acccan/dm-wt-pds-b/server && npm test
cd /Users/acccan/dm-wt-pds-b && make docs-check && git diff --check
```
每次小步 Conventional Commits(`feat(geocode): ...`)。

## 回报
写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-poi-datasource/reports/ws-b.md`:
1. 海外站摸底数字(数量/城市分布)
2. 改动摘要(Nominatim 函数/路由/政策合规点)
3. 「遇到的问题」段(如有)
4. 门禁逐项结果
末两行必须精确:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
