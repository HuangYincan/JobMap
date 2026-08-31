# Workstream s-server-semantics — 缓存版本 bump + DB 裁剪空语义(fix 2/3)

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-s-server-semantics`,分支 `fix/server-catalog-semantics`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(boss 已验证,2026-08-25)

用户两个高优先级发现:

**发现 2 — MODE_CACHE_VERSION 未 bump。** `server/src/lib/mode-cache.ts:48-49`:`MODE_CACHE_PREFIX = 'domain-map:mode-cache:v1:'`、`MODE_CACHE_VERSION = 17`。但读路径语义已变(fix/hide-center-pins 已合入 dev,1c2f2a8):work 目录经 `isCityCenterPin` 过滤后条目数从 1046 → 617。旧 sessionStorage 里可能保存未过滤旧目录;用户走「刷新此处、切模式、切分类、重试」等清缓存路径时,会从旧目录切到新目录,表现为「点击某个东西后一批 POI 消失」。文件顶部 1-42 行有版本历史注释块,每个版本一段(`// v14(2026-08-20 全量加载修复):…`),本次需追加 v18 段。

**发现 3 — DB 空结果/裁剪语义被破坏。** `server/src/lib/recruitment-store.ts:141`:

```ts
if (located.length === 0) return null;
```

`:132` 已有 `if (clipped && sites.rows.length === 0) return [];`(SQL 级裁剪未命中 = 空),但 JS 侧过滤(SQL 命中但行全部被 `hasPlausibleCoord` / `isCityCenterPin` 过滤掉)→ `return null` → `server/src/lib/server-catalog.ts:78-87` 的 `loadServerCatalog`:

```ts
const imported = await loadWorkCatalogFromDb(clip);
// Clip miss must stay empty. An unclipped empty table still falls back to seed.
if (imported && (imported.length > 0 || clip)) return imported;
return loadOfflineWorkCatalog();
```

`null` 触发离线目录回退——对带 bounds/city/maxTier 的请求,「裁剪未命中应为空」变味:搜索/建议结果来自离线目录(种子/其他来源)而非当前 DB 的真实空结果。契约应为:**null = 无 DB/查询失败(仅 `!pool` 与 catch);`[]` = DB 健康但(裁剪或过滤后)为空**。

## 任务(仅本 WS 范围)

### 1. bump 缓存版本 — `server/src/lib/mode-cache.ts`

- `MODE_CACHE_VERSION` 17 → 18。
- 版本历史注释块追加 v18 段,说明引入失效的原因(可验证事实,参照既有风格):
  - 2026-08-25 读路径语义两连修:① 读路径排除城市中心钉(位置未知站点不再展示,目录 1046→617);② work 裁剪未命中语义修正(DB 健康 + 裁剪空 = 空结果,不再回退离线目录)。旧缓存(未过滤 1046 条目录 / 旧回退语义)→ bump 使其失效重拉。
- 检查 `server/tests/mode-cache.test.mjs` 是否有断言版本 = 17 / 特定 number 的用例,同步更新。

### 2. 裁剪空语义 — `server/src/lib/recruitment-store.ts`

- `:141` 改为:`if (located.length === 0) return clipped ? [] : null;`(变量名以实际为准——`clipped` 是 `hasSpatialClip(clip) || consistency.sql !== ''`)。
- 同步更新 `:134-137` 及附近注释,明确 null/[] 两种语义(参照 :132 注释风格)。
- **不要**改动 `!pool → null`、catch → null、`:170 companies.rows.length === 0 → return []` 等既有分支。
- 验证 `server/src/lib/server-catalog.ts:80-82` 契约:null → 离线回退(真失败);clip + [] → `imported && (…|| clip)` 返回 [](裁剪空)。若该文件逻辑无需改,只更新注释使契约精确(`null = 无 DB/失败;[] = DB 健康但裁剪空`);若发现其他把 null/[] 混同的路径,最小修复并汇报。
- 顺带确认引用方(`/api/pois` `loadServerCatalog(mode, clip)`、search/suggest 链路)不因语义收紧而出现新问题(不改路由逻辑,只读验证)。

### 3. 测试(风格跟随现有文件)

- `server/tests/server-catalog.test.mjs`:补用例——clip 存在 + DB 健康但 located 过滤后为空 → 返回 `[]` 而非离线目录;无 DB(pool=null)→ 仍离线回退。找到现有 mock 方式(该文件如何 fake `loadWorkCatalogFromDb` / pool)跟随之。
- `server/tests/mode-cache.test.mjs`:版本断言更新 + 补「version ≠ 17」的防回归断言(或直接断言 = 18)。
- 若 `server/tests/recruitment-api.test.mjs` 有旧「裁剪空 → 离线」断言(如有),更新为「裁剪空 → 0 结果」。
- `cd server && npm test` 全量必须绿。

### 4. 文档同步

- 检索描述该契约/读路径的文档(`tech/18-national-scale-plan.md` 读路径章节、`tech/` 下 clip/缓存语义相关 md、`agent.md` 若有读路径/缓存描述),按「文档必须反映可验证事实」更新(说清 null/[] 契约与缓存版本语义)。`make docs-check` 必须过。
- 若发现描述已经准确,零改动并在汇报中说明。

## 文件边界

**拥有**:`server/src/lib/mode-cache.ts`、`server/src/lib/recruitment-store.ts`、(如确有必要)`server/src/lib/server-catalog.ts`、`server/tests/{mode-cache,server-catalog,recruitment-api}.test.mjs`、相关 tech 文档。

**不碰**:`server/src/components/**`、`server/src/hooks/**`、`server/src/lib/{map-markers,site-geocode,viewport-search,search,city-centers,lod}.ts`、`scripts/**`、`server/.env*`、其他 route。主树的 `server/next-env.d.ts` 已脏是既有状态,与本批无关,不要碰。

## 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-s-server-semantics/server && npm test
cd /Users/acccan/dm-wt-s-server-semantics/server && npm run typecheck
cd /Users/acccan/dm-wt-s-server-semantics && make docs-check && git diff --check
```

## 提交

小步高频,Conventional Commits(`fix(cache): bump MODE_CACHE_VERSION to 18 — 中心钉排除后目录口径变化`、`fix(recruitment-store): 裁剪空返回 [] 而非 null — 不再回退离线目录`、`test(catalog): clip-miss empty contract cases`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-boss-hi-priority-fixes/reports/s-server-semantics.md`,含改动摘要、门禁结果、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
