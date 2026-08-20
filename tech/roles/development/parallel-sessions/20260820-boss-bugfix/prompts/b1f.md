# Workstream b1f — 修复 positions 自愈顺序(先删重后迁移)

## 背景(boss 2026-08-20 实测失败,根因已定位)

b1 的 import 自愈逻辑(dev `2e43886` 已合并,`server/src/lib/recruitment-import.ts:458-484`)
顺序错误:

```
1) UPDATE positions SET source_id=$2 WHERE external_id=ANY(...)   ← 先迁移
2) DELETE 保 MIN(id)                                              ← 后去重
3) upsert
```

**缺陷**:步骤 1 的 UPDATE 会把同 external_id 的旧 seed 行与新增行都改成新 source_id →
两条行共享 `(source_id, external_id)` → **唯一索引 `positions_source_id_external_id_key` 在
UPDATE 语句内立即冲突**(nbtinsert `_bt_check_unique`),步骤 2 永远轮不到,事务回滚。
boss 实测确认:重跑 import:seed:apply 报唯一键冲突,DB 未变(21111 行,10533 重复行仍在)。

**正确顺序(不可颠倒)**:
1) 先去重:`DELETE FROM positions p USING (SELECT external_id, MIN(id) keep_id FROM positions WHERE external_id = ANY($1) GROUP BY external_id) keep WHERE p.external_id = keep.external_id AND p.id <> keep.keep_id`(每 external_id 保 MIN(id),即最早行——applications 表 position_id 引用多指向旧行,保留旧 id 避免悬空);
2) 再迁移:`UPDATE positions SET source_id = $2 WHERE external_id = ANY($1::text[]) AND source_id IS DISTINCT FROM $2`(此时每 external_id 仅一行,无冲突);
3) 照常 `ON CONFLICT (source_id, external_id) DO UPDATE` upsert(刷新内容)。

## 任务(worktree:`/Users/acccan/dm-wt-b1f`,分支 `fix/positions-dedup-order`)

1. 交换 `recruitment-import.ts:470-483` 两个语句块的顺序(去重在前,迁移在后),修正上方注释
   (现在注释把错误顺序写成「不可颠倒」,必须改)。
2. 检查 b1 的契约测试(`server/tests/` 内 positions-dedup 相关):若测试断言/模拟了旧顺序,
   同步更新;补充一条「迁移不得先于去重」(顺序不变量)的断言(如 SQL 模板顺序断言或调用序断言)。
3. 门禁全绿:server npm test / typecheck / make docs-check / git diff --check。

## 文件边界(拥有)

- `server/src/lib/recruitment-import.ts`(仅 458-484 区)、`server/tests/`(仅 positions-dedup 契约)

**不碰**:其余文件。**不要**跑 import/psql(工具已禁;boss 合并后重跑验证)。

## 门禁(全部须绿)

- `cd /Users/acccan/dm-wt-b1f/server && npm test`(基线 485 tests / 483 pass / 2 skip,不得减少)
- `cd /Users/acccan/dm-wt-b1f/server && npm run typecheck`(0 错误)
- `make docs-check`(worktree 根)、`git diff --check` 无输出

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-bugfix/reports/b1f.md`:
改动(顺序交换)、注释修正、测试更新、遇到的问题。小步 commit(Conventional Commits)。**不要 merge/push**。
末两行必须精确:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
