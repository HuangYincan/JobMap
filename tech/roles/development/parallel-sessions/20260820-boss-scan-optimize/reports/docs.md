# ws-docs 汇报(2026-08-20)

分支 `fix/docs-sync-20260820`(worktree /Users/acccan/dm-wt-docs),3 个 commit,全部门禁绿。

## 实际改动

- **CLAUDE.md** → 「Next.js 15」→「Next.js 16」;`npm test` 注释 423(421/2,2026-08-19)→ **488(486 pass / 2 skip,2026-08-20)**
- **agent.md** → `npm test`(423,2026-08-19)→(488,2026-08-20);:115/:185/:210/:246 四处 `tech/roles/development/implementation/<phase>.md` 引用改指实际位置(:185 → `tech/16-bug-fixes.md`;其余 → 现有 `implementation/` 目录,标注现有 phase-1.md / phase-2.md、新 phase 按需建立)
- **CONTRIBUTING.md** → `npm test`(423,2026-08-19)→(488,2026-08-20)
- **README.md** → 477 tests(475/2)→ **488(486/2)**;Repository Layout「Next.js 15 app」→「Next.js 16.3.1 app」
- **CHANGELOG.md** → ① 2026-08-20 Next-16 条目内 `npm test` 477(475/2)→ 488(486/2);② 新增 `### Fixed` 两条合入条目:
  - `933f972` work 全量加载(首点刷新/聚合计数漂移/死代码清理):全量加载 10_000 页、去 geolocation 门控、聚合计数去 LOD 过滤 + 杭州市/杭州归一、净删 566 行、MODE_CACHE_VERSION 14→15、14 文件;Docs: tech/16 §2026-08-20、tech/21
  - `788e9c6` positions import 自愈去重(b1f):先按 external_id 保 MIN(id) 删重再迁移(先迁移会触发唯一索引 `_bt_check_unique` 整事务回滚;保留最早 id 避免 applications.position_id 悬空),契约测试断言 dedup-before-migration 顺序
- **tech/05-milestones.md** → 文件头 Last reviewed 2026-08-16 → 2026-08-20;Frontend status 423 tests(421/2,2026-08-19)→ **488(486/2,2026-08-20)**(状态日期同步 2026-08-20);P1 版本号 Next 15.5.23 / React 19.0.8 → **Next 16.3.1 / React 19.2.8 / TS 5.9.3**(附注「2026-08-20 由 15.5.23/19.0.8 升级」保留历史)

## Commit 摘要

- `f4ba34a` `docs: 统一测试计数(实测 488)与 Next 16 版本号` — CLAUDE.md / CONTRIBUTING.md / README.md / tech/05-milestones.md
- `7f19532` `docs: CHANGELOG 补 2026-08-20 两条合入` — CHANGELOG.md(含该日 Next-16 条目内计数 477→488)
- `2280b89` `docs: agent.md 实施路径标注规划态` — agent.md(4 处路径标注 + 计数 423→488;文件级提交故计数同入此 commit)

## 门禁结果

- npm test:**488 通过 / 0 失败 / 2 skip**(实测两次一致,2026-08-20)
- typecheck:0 错误(通过)
- make docs-check:通过
- git diff --check:通过(无空白错误;`git status` 干净)

## 遇到的问题

1. **扫描结论「implementation 目录不存在」与实际不符**:`tech/roles/development/implementation/` 实际存在且被 git 跟踪(phase-1.md / phase-2.md)。故 agent.md 四处未采用「规划,目录尚未建立」标注,而按任务给的另一选项「改指实际位置」处理(:185 指向 tech/16-bug-fixes.md,其余指向现有目录)。→ 需 boss 知悉扫描口径与实际偏差;若 boss 坚持标注「规划」可再改。
2. **tech/16「2026-08-20」区只覆盖 933f972**(work 全量加载),**无 788e9c6(positions-dedup)条目**。788e9c6 的 CHANGELOG 条目改由 commit 全文(382fe43)与代码 diff 编写,内容与 boss 预期一致。
3. **CHANGELOG 两处历史计数按语义保留**:CHANGELOG:24(2026-08-19 条目「全量基线 423」)是当日真实基线,不在任务 6 处清单内,未改;Next-16 条目原 477 已按 boss 指示统一为 488(该 chore 实测时确为 477,测试增长来自其后两条 merge,报告注明)。
4. **tech/05-milestones.md:35(P1 交付记录)版本号**按 boss 指示改为当前实测值,并附升级来源注记避免伪造 P1 历史;:90「Next.js 15.5」位于 Phase 2 明确标注「实施期记录」的历史段,不在任务范围,未改。

## 证据

- 实测:`cd /Users/acccan/dm-wt-docs/server && npm test` → `ℹ tests 488 / pass 486 / fail 0 / skipped 2`(与 tech/16-bug-fixes.md:50 一致)
- 提交链:`2280b89` → `7f19532` → `f4ba34a`,基点 `933f972`(dev 2026-08-20 两 merge 之后)

门禁: PASSED
结论: OK
