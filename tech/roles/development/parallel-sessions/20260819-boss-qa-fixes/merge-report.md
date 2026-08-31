# 合并报告(2026-08-19)

## 结果总览

- 成功合并: ws-qa1/qa2/qa3/qa4/qa5 × 5
- 失败/遗留: 0(全部分支按 manifest 顺序 merge 成功,门禁全绿)
- 无冲突(全部 merge 由 ort 策略干净完成,无冲突标记;文件面互不重叠)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test / typecheck / docs-check / diff) | 冲突解决 |
|---|---|---|---|---|
| ws-qa1 | fix/qa-geom-index | ✅ cef4fa3(无冲突) | 421 pass / 0 fail / 2 skip ✅ / 0 err ✅ / clean ✅ / OK ✅ | 无 |
| ws-qa2 | fix/qa-otp-account | ✅ 49efa96(无冲突) | 429 pass / 0 fail / 2 skip ✅ / 0 err ✅ / clean ✅ / OK ✅ | 无 |
| ws-qa3 | fix/qa-api-hardening | ✅ fc072ec(无冲突) | 436 pass / 0 fail / 2 skip ✅ / 0 err ✅ / clean ✅ / OK ✅ | 无 |
| ws-qa4 | fix/qa-deadcode | ✅ 4952032(无冲突) | 441 pass / 0 fail / 2 skip ✅ / 0 err ✅ / clean ✅ / OK ✅ | 无 |
| ws-qa5 | fix/qa-docs | ✅ 77ea603(无冲突) | 441 pass / 0 fail / 2 skip ✅ / 0 err ✅ / clean ✅ / OK ✅ | 无 |

## 冲突解决清单

无冲突,无需取舍(各分支文件面互不重叠;qa5 文档批未触碰代码)。

## 遗留问题

1. **qa1 EXPLAIN 未跑(Env-only / DB 不可达,不阻塞)**:ws-qa1 汇报提供补跑 SQL
   (`EXPLAIN SELECT ... ST_DWithin(s.geom_geog, ...)`),预期 `Bitmap Index Scan on
   company_sites_geog_gist`。留给后续 VERIFY 里程碑(boss 侧有 DB 环境时补跑)。
2. **docs 扫描 #20(09-secondary-sidebar 420px 口径)/ #23(regression-fix 批次状态)**:
   qa5 按 prompt 指示 skip,需用户决策,保持原状。
3. 本批次目录文件本身未 commit 入树(batch 目录惯例),merge-report 亦不入库。

## 最终 dev 状态

- `dev` @ `77ea603`(5 个 merge commit:cef4fa3 → 49efa96 → fc072ec → 4952032 → 77ea603),
  已 `git push origin dev` 同步远端。
- 测试基线:`cd server && npm test` → 443 tests / 441 pass / 0 fail / 2 skipped;
  `npm run typecheck` 0 错误;`make docs-check` passed;`git diff --check` 无输出。
- 全部 5 个 worktree(/Users/acccan/dm-wt-qa1..qa5)已移除,5 个 fix/qa-* 分支已删除;
  主工作树仅剩 dev。
- 未 push main、未 force-push;Env-only 步骤(迁移 apply / import:seed:apply / AMap
  geocode / EXPLAIN 验证)均未做,留给用户。

门禁: ALL_GREEN
结论: MERGED_ALL
