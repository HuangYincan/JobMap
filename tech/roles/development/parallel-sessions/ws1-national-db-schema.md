# Session Prompt — WS1: 国家级 DB schema + 工作模式读路径

> 这是 Domain Map 并行开发的一个独立 Agent 会话。先读 `CLAUDE.md`、`agent.md`、`tech/18-national-scale-plan.md`、`tech/04-workflow.md`,再开工。

## 背景

- 项目正从杭州本地扩展到**全国范围工作模式**。`dev` 已同步全部 Phase 1/2 工作(2026-08-17),主工作树在 `dev`。
- 你负责**地基**:国家级 schema + 工作模式读路径(tier 层级、城市过滤、只在招、`maxTier` API)。其他会话并行改数据管线(WS2)、LLM 验证(WS3)、前端(WS4)。
- 现状:`006_recruitment_sites.sql` 已有 `companies` 1—N `company_sites`(city/lng/lat/geom+gist)1—N `positions`。读路径 `loadWorkCatalogFromDb`(recruitment-store.ts) + `loadOfflineWorkCatalog`(server-catalog.ts) + `spatial-query.ts`(gist && + ST_DWithin)。

## 任务

1. **迁移** `db/migrations/011_national_scope.sql`:
   - `companies.tier smallint NOT NULL DEFAULT 3`(1=名企 2=大厂 3=中厂/其他)
   - `company_sites.province text`、`company_sites.city_code text`(行政区划码)
   - `company_sites.geom_geog geography(Point,4326)` STORED(generated from lng/lat)+ gist 索引
   - 复合索引 `(city_code, tier)`、部分索引 `positions (site_id) WHERE status='open'`
   - 幂等(IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),符合 `db/scripts/apply.sh` ledger 约定
2. **类型** `src/lib/types.ts`: `CompanySite` 加 `province`/`cityCode`;`SourceCompany`/`RecruitmentPOI` 加 `tier`(默认 3)。
3. **读路径**:
   - `loadServerCatalog` / `loadWorkCatalogFromDb` / 离线 catalog 支持 `filters.maxTier`、`filters.city`(city 走 `ILIKE` 或 `city_code`)、**alive 过滤**(`status='open'` 且 `deadline IS NULL OR deadline >= today`)。
   - `/api/pois` + `/api/search` 透传 `filters.maxTier` / `city`。
4. **导入映射** `recruitment-import.ts`:消费 drop 里的 `tier` / site `city`(从 WS2 定义的 drop 形状读,缺省 `tier=3`、city 从地址/城市字段解析)。
5. **测试**:为 maxTier / city / alive 过滤写单元 + 集成测试(`tests/recruitment-*.test.mjs`)。

## 文件边界

**拥有**:`db/migrations/011_*`、`src/lib/types.ts`、`src/lib/recruitment-store.ts`、`src/lib/spatial-query.ts`、`src/lib/server-catalog.ts`、`src/lib/recruitment-import.ts`、`src/lib/freshness.ts`(alive 逻辑)、`src/app/api/pois/route.ts`、`src/app/api/search/route.ts`、对应 tests。
**不碰**:`crawler/`、`server/data/recruitment/`(drops)、`scripts/geocode-sites-apply.mjs`、`map-shell.tsx` 及任何前端组件。

## 与 WS2 的契约

- WS2 产出的 drop 形状:`SourceCompany` 增加 `tier`(可选),site 增加 `province`/`city`。你按「字段存在则消费,缺省 `tier=3`」实现,不要假设 WS2 已 merge。
- drop 里 site 的 `location.address` 可能是城市文本(`"北京/上海"`)——保持现状即可,城市字段单独提供。

## 门槛

- `cd server && npm test && npm run typecheck` 全绿;`make docs-check` + `git diff --check`。
- Conventional Commits(`feat(national-db): ...`)。
- 工作模式仍**只展示真实在招岗位**(不回归 `isAuthenticPositionId` / alive)。

## 回报格式

完成后返回:改了哪些文件、测试结果、`/api/pois?filters={maxTier:1}` 等验收样例输出、遇到的问题。不要倾倒文件内容。
