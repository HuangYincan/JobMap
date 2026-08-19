# 18 — 全国规模工作模式 + 并行开发计划

**文档版本:** 1.0
**创建日期:** 2026-08-17
**状态:** 当前开发计划（planned）
**相关:** `tech/11-phase2-plan.md`（Phase 2）、`tech/04-workflow.md`（worktree 并行）、`.claude/skills/parallel-development/`

---

## 1. 决策记录（用户定，2026-08-17）

### D1 — 不做高德 → PostgreSQL 导入；Domain 模式直接调 API

- 这是**全国/全球范围项目**，用户来自各地。普通 POI 点太多，全部入库并做好项目适配成本高。
- 高德不提供 POI 原始数据；自找 POI 来源五花八门、质量差，适配更难。
- 结论：**Domain 模式不落库，直接调高德 API**。主地图只在用户刷新时更新（API 负载/余额限制）。
- 但**找工作不同**：知名企业数量少，全国覆盖相对容易 → 工作模式做**全国范围、入库、按用户位置按需加载**。

### A1 — 只展示「活着在招」的真实岗位

- 所有读路径只保留：**真实岗位**（`radar-*` / `portal-*`）+ **在招**（`status='open'` 且 `deadline` 为空或 `>= 今天`）。
- 不做复杂新鲜度徽标；呈现上只突出「在招中」信号。过期岗位自动隐藏。

### B1 — 工作模式真实数据扩展（当前最高优先级）

- **公司 ↔ 位置 ↔ 岗位**三者真实性必须匹配。
- 岗位必须真实；警惕「**多个岗位合到一条**」的聚合行（如「技术、设计、数据、运营、产品等七大类」）——需标记 + 拆解。
- 脚本校验效果有限 → 开发 **LLM 并发验证脚本**（用户提供 API，几千 QPS，一次可验证一批岗位；地址/位置验证同思路）。

### D2 — 全国数据源：预爬入库，先试验几个主要城市

- 推荐**预爬好源数据入 DB**（非实时爬取）。
- 首批城市：**北京、上海、广州、深圳、成都、武汉**（+ 已覆盖的杭州）。
- 来源：`xiaozhao-radar` jobs.json（本就带全国城市文本）+ 官网招聘页（`crawl-official`）+ 后续审查通过的聚合源。

---

## 2. 架构：全国范围工作模式

### 2.1 数据模型（national）

现状（`006_recruitment_sites.sql`）：`companies` 1—N `company_sites`（`city`、`lng/lat`、`geom` + gist）1—N `positions`。杭州为中心。

全国化新增（WS1 已落库 `011_national_scope.sql`，2026-08-17）：

```sql
-- 已实现。⚠️ 草案里的复合 (city_code, tier) 无法建在单表上（tier 在 companies），
-- 改为 company_sites_city_company_idx (city_code, company_id) + companies_tier_idx 联合覆盖。
ALTER TABLE companies ADD COLUMN tier smallint NOT NULL DEFAULT 3;   -- 旧语义:1=名企 2=大厂 3=中厂/其他(2026-08-17 修订为 0..21 可见 zoom,见 tech/19;迁移 012 改缺省 12)
ALTER TABLE company_sites ADD COLUMN province text;                  -- '浙江省'
ALTER TABLE company_sites ADD COLUMN city_code text;                 -- '330100'
ALTER TABLE company_sites ADD COLUMN geom_geog geography(Point,4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography) STORED;
CREATE INDEX company_sites_geog_gist ON company_sites USING gist (geom_geog);
CREATE INDEX company_sites_city_code_idx ON company_sites (city_code);
CREATE INDEX companies_tier_idx ON companies (tier);
-- 在招岗位部分索引（alive 过滤加速）
CREATE INDEX positions_open_site_idx ON positions (site_id) WHERE status='open';
```

- `tier` 打标来源：名企（大厂/独角兽/500 强，已知清单 + LLM 校验辅助）。
- 城市字段来源：雷达快照城市文本 + 官网 office 城市。

> **2026-08-17 修订**:tier 从「1-3 档位分组」改为「0..21 可见最小 zoom」
> (`tier <= zoom` 过滤,SQL 下推不变;`lod.ts` 恒等映射;缺省 12;语义表见
> `tech/19` §1)。`companies.category`(国标大类 code)见 `tech/19` §2(迁移 012)。

### 2.2 Q1 — 按层级展示（LOD）

- 用户按位置按需加载 DB 中的 POI：空间查询（`bounds` + `ST_DWithin`）+ **层级过滤**。
- **模型（2026-08-17 修订）**：公司 `tier` = 可见最小 zoom，`tier <= 当前 zoom` 才展示。
  缩放连续变化 → 公司逐步涌现/消退；zoom 取整传 `filters.maxTier`（`lib/lod.ts:maxTierForZoom`）。

| 视角 | 展示 |
|---|---|
| 缩到全国（zoom < 4） | 只显示国际化名企（`tier <= 0`）——最顶层稀疏视野 |
| 全国（zoom 4–5） | 国家级名企加入（`tier <= 5`） |
| 省级（zoom 6–7） | 省级龙头 + 城市名企加入（`tier <= 7`） |
| 城市及以下（zoom ≥ 8） | 中厂/小厂逐步加入（`tier <= zoom`）——密度随缩放提升 |

- 客户端从 zoom 计算 `maxTier`，随 `bounds` 一起传给 `/api/pois`。
- 语义按用户原话实现，阈值做成常量便于日后调。

### 2.3 Q2 — 工作模式随视角按需加载（高性能）

- **工作模式**：地图 `moveend` / `zoomend` → 防抖（~300ms）→ 请求 `/api/pois`（当前 `bounds` + `maxTier`）→ **增量合并**进现有 catalog（不整体替换）→ 复用 marker。主地图（Domain）**保持刷新才更新**（AMap 负载/余额），不实现此功能。
- 性能手段：请求合并（同刻只有一个 in-flight）、旧请求取消、增量 merge、marker 复用。
- 服务端：`loadServerCatalog` / `loadWorkCatalogFromDb` 支持 `bounds` + `filters.maxTier` + `filters.city`，走 PostGIS（gist `&&` + `ST_DWithin`；距离用 `geom_geog` geography 更准）。

### 2.4 Q3 — 全国数据源（预爬入库）

- 工作模式数据**预爬入 DB**，不做实时爬取（实时爬对站点负载大、不稳定）。
- 首批城市：北上广深、成都、武汉（+ 杭州）。
- 管线：`radar_jobs.py` 按目标城市保留 → 公司按城市拆 site（`cities` 文本 → per-city sites）→ `geocode:sites:apply` 按城市逐 site 落真实办公点 → 导入 DB。
- 后续：官网 curation 扩展、Moka/hotjob 等 ATS JSON 审查后接入（复用 `RecruitmentAdapter` 插件缝）。

### 2.5 Q4 — DB 性能

- **表设计**：`companies(tier)`、`company_sites(province, city_code, lng, lat, geom, geom_geog)`、`positions(status, deadline)`。全国百万级公司 → 按城市/区域分片查询优先。
- **索引**：gist(geom) 已有；新增 gist(geom_geog)、b-tree(city_code)、b-tree(tier)、部分索引 `positions WHERE status='open'`。
- **空间算法**：视野裁剪用 `geom && ST_MakeEnvelope(...)` + `ST_DWithin`；用户位置半径用 `ST_DWithin(geom_geog, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, :radius_m)`。区域聚合/计数预留（**2026-08-20 修订**：聚合计数与 tier 无关——聚合区间计数须与 zoom 恒定，见 tech/21 规则 7；只有百万级才需要 DB 端计数）。
- 说明：距离用 geography（米），避免 4326 度数误差；百万级时考虑按 province/city 表分区或预留分区策略。

### 2.6 LLM 并发真实性验证（WS3，2026-08-17）

- 脚本 `server/scripts/validate-positions-llm.mjs`（逻辑库 `src/lib/llm-validate.ts`）。批量读 `server/data/recruitment/{radar,official-career}` 全部 drop，每条公司/岗位调用一次 OpenAI 兼容 chat completions，按确定性 JSON schema 返回判定。
- **维度**：title 真实性 / 聚合行检测（附拆解建议）/ 公司↔岗位一致性 / 公司↔站点↔城市一致性 / applyUrl 域名↔公司（官网或可信 ATS）。
- **env**：`LLM_API_KEY`、`LLM_BASE_URL`（默认 OpenAI v1）、`LLM_MODEL`（从 process.env 与 `server/.env.local` 读取，**绝不打印 key**）。无 key/model 时自动 dry-run：打印条数与示例输入，不 crash。
- **并发**：Promise 池 `--concurrency`（默认 512，上限 5000）；429/5xx/网络错误按指数退避（1s×2ⁿ+抖动）重试 3 次；单条失败记为 error，不中断整体。
- **CLI**：`--only slug1,slug2`、`--sample N`（随机）、`--limit N`、`--concurrency N`、`--dry-run`。每次请求只含单条岗位文本，LLM 返回只当 JSON 解析。
- **输出**：`tech/roles/data/validation-report-<YYYYMMDD>.json`（每条 pass/warn/fail/error + 理由 + 聚合拆解建议）+ 控制台汇总。用途与 env 配置见 `tech/roles/data/data-quality.md`。

---

## 3. 并行开发工作流

按 `tech/04-workflow.md` + `parallel-development` skill：每个 workstream 一个 worktree + 分支，从 `dev` 切，完成 merge 回 `dev`。

### 3.1 Workstream 划分（文件边界）

| WS | 分支 | 主题 | 拥有文件 | 不碰 |
|---|---|---|---|---|
| **WS1** | `feature/national-db-schema` | 国家级 schema + 读路径（tier/city/alive 过滤 + maxTier API） | `db/migrations/011_*`、`src/lib/types.ts`、`recruitment-store.ts`、`spatial-query.ts`、`server-catalog.ts`、`recruitment-import.ts`、`api/pois/route.ts`、`api/search/route.ts` | `crawler/`、`server/data/recruitment/`、`geocode-sites-apply.mjs`、`map-shell.tsx` |
| **WS2** | `feature/multi-city-data` | 多城市数据管线（城市拆分 + 聚合岗位标记 + 多城市 geocode） | `crawler/app/domain_map_importer/*`、`server/data/recruitment/radar/*`、`scripts/geocode-sites-apply.mjs`、`site-geocode.ts` | `db/migrations/`、`types.ts`、`map-shell.tsx` |
| **WS3** | `feature/llm-validation` | LLM 并发岗位真实性验证脚本 | `server/scripts/validate-positions-llm.mjs`(新)、`src/lib/llm-validate.ts`(新)、`tests/` | `crawler/`、`db/`、`map-shell.tsx` |
| **WS4** | `feature/work-viewport-lod` | 工作模式视口按需加载 + LOD + 在招呈现 | `map-shell.tsx`、marker/卡片组件、`lib/viewport-search.ts`、客户端 `mode-cache.ts`、CSS | `db/`、`crawler/`、服务端读路径 lib |

**依赖**：WS4 前端依赖 WS1 的 `filters.maxTier` API 参数（客户端先发，未知参数服务端忽略，集成时生效）；WS2 的 drop 形状（`tier`/`city`）依赖 WS1 的 `types.ts` 落地（Python 侧不阻塞）。merge 顺序解决集成。

### 3.2 Merge 顺序与冲突策略

- **顺序**：WS1（schema/读路径地基）→ WS2（数据，消费新 schema）→ WS3（独立，任意时刻）→ WS4（前端，最后，依赖 maxTier API）。
- **每个分支收尾**：在 worktree 内 `git fetch origin && git merge origin/dev` → 冲突在各自 worktree 里解决 → 跑门槛（`npm test` + `typecheck` + `docs-check` + `git diff --check`）→ 合回 `dev`。
- **冲突预防**：文件边界基本不相交；若两分支都改了同一文件（如违规碰 `types.ts`），后合并方在 worktree 内解决，运行完整测试后提交。
- **合回 dev**（逐个、串行）：
  ```bash
  git switch dev && git pull --ff-only origin dev
  git merge --no-ff feature/<ws>
  # 跑完整测试套件
  git push origin dev
  git branch -d feature/<ws> && git worktree remove ../domain-map-wt-<ws>
  ```
- **编排执行**：上述顺序的完整执行流程（前置检查 → 按序逐个 merge + 门禁复跑 → 红则停 → 清理 → push）由 `parallel-development` skill 的「Merge orchestration」节承载；新会话加载该 skill 即可执行，无需长 prompt。本节是契约记录，skill 是执行指令。

---

## 4. Agent Prompts

见 `tech/roles/development/parallel-sessions/`：
- `ws1-national-db-schema.md`
- `ws2-multi-city-data.md`
- `ws3-llm-validation.md`
- `ws4-work-viewport-lod.md`

每个 prompt 自包含：背景、任务、文件边界、门槛、依赖、回报格式。启动方式见 `tech/04-workflow.md`（先建 worktree 再开发）。

---

## 5. 里程碑

- [x] WS1 落库：tier/city/alive 读路径 + maxTier API（迁移 + 测试）—— **2026-08-17 完成**
- [x] WS2 多城市 mapper + 首批城市 drops（北上广深成都武汉）—— **2026-08-17 完成（630 公司 / 761 岗位，geocode 待配额）**
- [x] WS3 LLM 验证脚本（报告 + 用户配 key 后跑批）—— **2026-08-17 完成（817 条全量：82 pass / 724 warn / 10 fail / 1 error；10 条 fail 待 B2.1 决策）**
- [x] WS4 视口按需加载 + LOD + 在招呈现
- [x] 公司打标（tech/19）：tier 0..21 + category 国标大类，668 家全量 QA 通过—— **2026-08-17 完成**
- [ ] 全国工作模式验收：非杭州城市按位置加载、LOD 正常、真实性校验通过（**等待 AMap geocode 配额重置 → geocode:sites:apply → import:seed:apply**）
