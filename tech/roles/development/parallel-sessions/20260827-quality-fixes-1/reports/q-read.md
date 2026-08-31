# q-read 汇报(2026-08-27)

## 实际改动

**已提交(含上一轮 `919c709`,本续作补完提交 4 个)**

- `server/src/lib/db.ts` → 新增 `PUBLIC_READ_QUERY_TIMEOUT_MS=3_000` 与
  `queryPublicRead(db, sql, params, timeoutMs)`:真实 pg Pool 走
  `statement_timeout` 配置 + 客户端超时竞速;注入池保留 `(sql, params)` 调用形状,
  由客户端超时兜底。可测、fail-closed,不靠注释。
- `server/src/app/api/pois/domain-local/route.ts` → bounds 缺失/非法 → 400
  `INVALID_BOUNDS`;超出杭州导入范围 → 400 `BOUNDS_OUT_OF_RANGE`。两处均在
  `loadHangzhouPoisFromDb` 调用之前拦截,合法 bbox 行为不变。
- `server/src/lib/hz-poi-store.ts` → 新增 `isAllowedHangzhouBounds`(对照
  `HANGZHOU_BBOX`)与 `HZ_POI_RESULT_LIMIT=300`;store 直调缺 bounds 时钳到杭州
  导入范围,防御性防全表热门榜;`loadHangzhouPoisFromDb`/`loadHzPoiSuggestions`
  改走 `queryPublicRead`。
- `server/src/lib/recruitment-store.ts` → 抽出 `buildRecruitmentPois`(全量路径与
  定向路径共用,保证 API shape 完全一致);新增:
  - `loadWorkCatalogByIdFromDb(id)`:按 `companies.slug` 参数化定位公司 → 读该公司
    站点 → 读目标站点 + 本公司聚合行的在招岗位 → `buildRecruitmentPois` 后
    `find(id)`;未知/畸形 id 返回 `undefined`(= 404),DB 失败返回 `null`。
  - `loadWorkSuggestionsFromDb(query, limit=10)`:公司/岗位匹配下推 SQL,
    `suggestSearchGroups` 别名分组 + 前缀 ILIKE(≥3 字符加 `%term%` contains,
    复用现有 `positions_title_trgm` 索引),公司/岗位各自 `LIMIT 10`;
    无全量 loader。
  - `countWorkTagMatchesFromDb(tag)`:聚合 `count(DISTINCT s.id)`,覆盖
    scale / jobTaxonomy(intern 双路径 internKind|conversion)/ education /
    roleFamily(对齐 `positionMatchesRole` 关键词集含 skills);providesHousing /
    providesShuttle 恒 0(benefits 未持久化,与旧 JS 对 DB catalog 行为一致)。
- `server/src/lib/server-catalog.ts` → `loadServerCatalogById` 不再
  `loadServerCatalog(mode).find(...)`,非 recruitment 模式直接 `undefined`,
  work 模式走 `loadWorkCatalogByIdFromDb`。
- `server/src/app/api/suggest/route.ts` → work 分支消费 SQL 建议:公司行按
  `site_count` 还原 `slug`/`slug:site_id` 的 poi id,岗位行保留公开 `poiId` 字段;
  标签数字走聚合 count;响应 shape / 去重语义 / `slice(0,10)` / 空 q trending /
  domain 分支均不变。
- `server/src/app/api/search/route.ts` → `page` 必须 1..10000 整数、`pageSize`
  必须 1..100 整数(与 GET `/api/pois` 契约一致);缺失/null 用默认值,其他非法值
  400 `INVALID_PAGE` / `INVALID_PAGE_SIZE`,且校验先于缓存 key 构造;不再静默
  floor/NaN。
- 测试:
  - `server/tests/db.test.mjs`(新增)→ `queryPublicRead` 超时竞速失败。
  - `server/tests/hz-poi-store.test.mjs` → `isAllowedHangzhouBounds` 缺失/非法/
    越界拒绝,合法 bbox 放行。
  - `server/tests/api-hardening.test.mjs` → `#19` 断言 search 分页整数校验先于缓存
    key;domain-local bounds 校验先于 store 调用。
  - `server/tests/server-catalog.test.mjs` → by-id 走 3 条定向 SQL 且不含全量
    `FROM companies ORDER BY slug`;未知/畸形 id 404 语义;建议 SQL 每族
    `LIMIT $n` 且不触全量;标签聚合 count SQL。
- 文档:
  - `tech/13-db-query-notes.md` → public read guardrails(queryPublicRead 3s 超时,
    by-id/suggest SQL、LIMIT 上限、不物化全 catalog)。
  - `tech/14-api-contract.md` → domain-local bounds 400 契约、定向 by-id 详情、
    POST `/api/search` 分页整数契约、suggest SQL 候选。
  - `tech/22-hangzhou-poi-local.md` → bbox 必须落杭州导入范围;缺 bounds 不再全表
    热门榜;work suggest 分支 SQL 化(每族 LIMIT 10)。

**本续作提交序列(在 `919c709` 之上):**

- `6af91a7` feat(q-read): targeted by-id detail + SQL-backed work suggest/count reads
- `15841f5` refactor(q-read): work suggest route uses SQL-backed candidates
- `1411440` fix(q-read): POST /api/search pagination matches GET integer contract
- `fbb0866` docs(q-read): public read guardrails, domain-local bounds, SQL suggest

## 每个旧全量路径被替换的证据

1. **单 POI 详情**:旧 `loadServerCatalogById` → `loadServerCatalog(mode)` 全量再
   `catalog.find`。现 by-id 仅 3 条定向 SQL(`companies WHERE slug=$1`,
   `company_sites WHERE company_id=$1`, `positions WHERE company_id=$2 AND
   (site_id=ANY($1) OR aggregate)`)。测试断言 `queries.length === 3` 且
   `queries.every(q => !q.sql.includes('FROM companies ORDER BY slug'))`。
2. **Work suggest**:旧 `loadServerCatalog(mode)` 全量后在 JS 用 `matchKeyword`
   扫公司/岗位。现 `loadWorkSuggestionsFromDb` 公司/岗位各 `LIMIT $n`,
   测试断言 `queries.every(q => q.sql.includes('LIMIT $'))` 且不含全量 loader。
3. **标签计数**:旧 `countPoisMatchingTag` 对全量 catalog 数组 `applyFilters`。
   现聚合 `count(DISTINCT s.id)` 单条 SQL,测试断言 `/count\(DISTINCT s\.id\)/`。
4. **domain-local 无界读**:旧缺失 bounds → 全表热门榜。现 HTTP 400 拦截
   (测试断言 400 分支先于 `loadHangzhouPoisFromDb`);store 直调钳到杭州范围。

## API 兼容性

- `/api/pois/:id` 响应 shape 不变(复用 `buildRecruitmentPois`),未知 id 仍 404。
- `/api/suggest` work 响应:poi 行 `id/title/subtitle/icon/location/distance`,
  岗位行含 `poiId`;标签行 `'N 个公司'`;空 q trending 与 domain 分支不变。
- `/api/pois/domain-local`:合法 bbox 行为不变;仅新增缺失/越界 400。
- POST `/api/search`:合法请求行为不变;仅非法分页从「静默 floor」变为 400。

## 门禁结果

- npm test: **1694 通过 / 0 失败**(3 skip,no-DB gate 通过)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- 续作对账:上一轮已提交 `919c709`(task 1),其余未提交改动在范围内且正确,已保留
  并补完;未重做已核对项。
- `countWorkTagMatchesFromDb` 初稿对 providesHousing/Shuttle 落 `TRUE` 全量计数,
  与旧 JS(DB catalog 无 benefits → 0)不一致 → 已修正为恒 0,并补 roleFamily 关键词
  集对齐(含 skills)与 intern conversion 双路径测试。
- 遗留:沙箱限制无法删除临时校验文件 `server/tests/q-read-count-check.mjs`
  (untracked,不匹配 `tests/*.test.mjs`,不影响门禁/提交);boss 可在 merge 时忽略。

## 证据

- 提交序列:`git log --oneline -5` → 919c709 → 6af91a7 → 15841f5 → 1411440 → fbb0866。
- 测试输出摘要:npm test → `ℹ tests 1697 / pass 1694 / fail 0 / skipped 3`。
- 回归断言:server-catalog.test.mjs by-id 3 条查询 + 404 语义、suggest 每族 LIMIT、
  聚合 count SQL;api-hardening.test.mjs #19 校验先于缓存 key。

门禁: PASSED
结论: OK
