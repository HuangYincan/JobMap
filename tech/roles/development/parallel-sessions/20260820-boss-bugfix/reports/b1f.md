# b1f 汇报(2026-08-20)

## 实际改动

- `server/src/lib/recruitment-import.ts`(仅自愈块)→ 交换两语句顺序:先去重
  (`DELETE ... USING (SELECT external_id, MIN(id) AS keep_id ...)`),再迁移
  (`UPDATE positions SET source_id = $2 ...`)。同步重写块注释:顺序不可颠倒的
  原因改为「先迁移会让同 external_id 的旧行与新增行共享 (source_id, external_id),
  UPDATE 语句内即触发唯一索引 `positions_source_id_external_id_key` 冲突
  (_bt_check_unique),事务回滚(2026-08-20 boss 实测)」;并注明去重保 MIN(id)=
  最早行,applications.position_id 引用不悬空。SQL 本身未改,仅顺序与注释。
- `server/tests/recruitment-import.test.mjs`(positions-dedup 契约)→
  测试改名「apply dedups first (keep MIN(id)) then migrates old-source rows,
  before the upsert」;注释同步为正确顺序及失败模式;顺序断言从
  `migrateAt < dedupAt` 翻转为 `dedupAt < migrateAt < upsertAt`(顺序不变量);
  authentic 过滤锚点改为 `authenticAt < dedupAt`(去重现为块内第一条语句)。
  `plan scope` 契约测试未改仍通过(`external_id = ANY($1::text[])` 两处匹配不变)。

## 门禁结果

- npm test: 488 tests / 486 pass / 2 skip / 0 fail(基线 485/483/2,未减少)
- typecheck: 通过(0 错误)
- docs-check: 通过
- git diff --check: 无输出(工作树干净)

## 遇到的问题

- 无。本地实测 suite 为 488 tests(比 boss 基线多 3),未新增任何测试,仅改两个
  既有测试体;可能为 boss 测量时点差异,不影响「不得减少」约束。

## 证据

- 两测试通过输出:
  `✔ positions dedup: apply dedups first (keep MIN(id)) then migrates old-source rows, before the upsert`
  `✔ positions dedup plan scope: migrate/dedup use the plan external ids, not the whole table`
- commits: `382fe43 fix(b1f): positions import self-heal dedups before source migration`、
  `2c97ab2 test(b1f): positions-dedup contract asserts dedup-before-migration order`

门禁: PASSED
结论: OK
