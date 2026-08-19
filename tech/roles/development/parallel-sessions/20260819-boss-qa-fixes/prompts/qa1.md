# ws-qa1 — #1 geom_geog gist 索引接线(radius 路径免 cast)

## 背景

质量扫描(quality-scans/20260819-all/scan-report.md #1,High):`db/migrations/011_national_scope.sql:17-24` 已建 `company_sites.geom_geog geography STORED` 列 + `company_sites_geog_gist` gist 索引(注释明确「ST_DWithin(geom_geog, point, meters)」),但**查询从未使用**:`server/src/lib/spatial-query.ts:180-182` 的距离裁剪是
```sql
ST_DWithin(s.geom::geography, ST_SetSRID(ST_MakePoint($i,$i+1),4326)::geography, $i+2)
```
`s.geom::geography` 是 cast 表达式,PostgreSQL 无法命中 geom_geog 列上的 gist 索引 → 全国 1440 sites 规模下带 radius 的查询每次全表扫描 + 逐行 cast。

## 修复(worker 自选,保持契约)

把 radius 裁剪从 `s.geom::geography` 改为 `s.geom_geog`(STORED 列,免 cast,命中 gist 索引);bbox `&&` 裁剪**继续用 `s.geom`**(006:46 的 gist 已覆盖,不要动)。注意:
- 这是 migration 011 已建好列/索引的「接线」,**不新增迁移**。
- `s.geom_geog` 为 STORED 列,值来自 geom 转换,语义与 `s.geom::geography` 等价,契约不变(米制 ST_DWithin 结果一致)。
- 修后跑 `EXPLAIN ANALYZE`(或 `EXPLAIN`),验证 radius 查询走 index scan(条件:本地 DB 可达则跑;不可达则说明已通过 unit 测试逻辑覆盖并注明)。**DB 不可达 = 不阻塞**,EXPLAIN 属 Env 验证,可记入汇报即可。

## 测试(必做)

- `server/tests/spatial-query.test.mjs` 既有用例全绿(生成的 SQL 片段断言如有 `geom::geography` 字样需同步更新为 `geom_geog`)。
- 新增/更新:radius 路径 SQL 片段断言含 `s.geom_geog` 且 bbox 路径仍含 `s.geom &&`。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-qa1)

- 只动:`server/src/lib/spatial-query.ts`、`server/tests/*`(相关断言)
- **不碰**:`db/migrations/*`、`server/src/lib/recruitment-store.ts`(无必要)、`server/src/lib/account-store.ts`(ws-qa2)、`server/src/app/api/*`(ws-qa2/qa3)、`server/src/lib/modes.ts`/`api.ts`(ws-qa4)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-qa1/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-qa1 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-qa-fixes/reports/ws-qa1.md`:
改动文件 + 实现 + 测试 + EXPLAIN 结论(跑了/DB不可达注明)。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
