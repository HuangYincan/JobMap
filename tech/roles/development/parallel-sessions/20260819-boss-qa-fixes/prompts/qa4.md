# ws-qa4 — #8 MODES.internship 死代码 + #9 api.ts 死导出/过时注释

## 背景

质量扫描(quality-scans/20260819-all/scan-report.md):

- **#8 (Low, frontend)**:`server/src/lib/modes.ts:190-203` — `MODES.internship` 死代码:canonicalMode(:297) 恒把 internship→work,getMode 永不读 MODES.internship;grep 无任何引用,与 work 定义完全重复。
- **#9 (Low, frontend)**:`server/src/lib/api.ts:12,90,125` — `fetchPOIs`/`fetchModes` 导出无任何调用方(src+tests);头部注释「Phase 2 使用 seed/AMap 数据,DB 就绪后无缝切换」「GET /api/search」均过时(已在用 DB;search 是 POST)。

## 修复

### #8
删除 `MODES.internship` 条目(类型兼容由 canonicalMode 保证)。删除前先 grep 确认零引用(worker 自查);若发现引用(如建议/趋势等读 MODES 数组的地方),把该处改为显式 work 或按 canonicalMode 语义处理并说明。**删除后 `MODES` 数组/对象其余条目与顺序保持**。

### #9
- 删除 `fetchPOIs`/`fetchModes` 死导出(先 grep 确认无调用方,含 `server/tests/`)。
- 更新 `api.ts` 头部注释为当前契约(work/domain 读路径、POST /api/search 等真实形状)。
- 若 `api.ts` 删除后空壳(无存活导出),整文件可删则删,否则保留剩余工具并说明。

## 测试(必做)

- 现有 tests 全绿;新增:modes 无 internship(或 canonicalMode 后无 internship);api.ts 无死导出(若删文件则更新引用测试)。
- 运行 `grep -rn "MODES.internship\|fetchPOIs\|fetchModes" server/src server/tests` 确认零残留(汇报附命令输出)。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-qa4)

- 只动:`server/src/lib/modes.ts`、`server/src/lib/api.ts`、`server/tests/*`(相关)
- **不碰**:`server/src/lib/account-store.ts`(ws-qa2)、`server/src/app/api/*`(ws-qa2/qa3)、`server/src/lib/spatial-query.ts`(ws-qa1)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-qa4/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-qa4 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-qa-fixes/reports/ws-qa4.md`:
改动文件 + 实现 + 测试 + grep 零残留证据。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
