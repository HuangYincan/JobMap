# Workstream w4-fix — 裁决附录(boss 授权更新过时快照计数)

## 你的身份

boss 派发的续作 worker。**同一 worktree `/Users/acccan/dm-wt-backfill-r2`、分支 `fix/address-backfill-r2`**
(boss 已裁决:数据回填有效,测试断言的是回填前旧计数,授权更新;与 w2-fix `24348c3` 同款先例)。

## 背景

w4 已回填 18 站(2 commit:`768adc4` 数据 + `09b9b5d` 文档)。门禁唯一失败:
`server/tests/embodied-jobs-drops.test.mjs:132-133` 快照计数断言旧值
「38 站带 address / 9 站为空」——本轮 7 个 embj 站回填后实际 **45 站带 address / 2 站为空**
(AIM、Grit 仍未查到,保持 null)。

## 任务

1. `git log --oneline -3` 确认分支状态;`git status` 干净。
2. 更新 `server/tests/embodied-jobs-drops.test.mjs` 的计数断言 38/9 → **45/2**;其余断言不动
   (location 形态契约等已通过)。以 worktree 内实际数据为准(先读文件确认计数)。
3. 重跑门禁:`cd /Users/acccan/dm-wt-backfill-r2/server && npm test`(全绿)、`npm run typecheck`;
   `cd /Users/acccan/dm-wt-backfill-r2 && make docs-check`、`git diff --check`。
4. Commit(如 `test(recruitment): update embodied snapshot counts to 45/2 after r2 backfill`)。

## 文件边界

- **只允许改**:`server/tests/embodied-jobs-drops.test.mjs`。
- **不碰**:数据文件、其他测试、src/、文档。

## 汇报

追加到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-address-first/reports/w4.md`
末尾(新段「## w4-fix 裁决更新」),并更新末两行:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

Conventional Commits。不 merge、不 push。
