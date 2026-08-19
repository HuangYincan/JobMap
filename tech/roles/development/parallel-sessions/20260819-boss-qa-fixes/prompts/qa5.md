# ws-qa5 — #2 docs 扫描 27 条 + #3 测试计数 423/421/2 + #14 data-quality 口径 + #16 批次 manifest

## 背景

质量扫描(quality-scans/20260819-all/scan-report.md):

- **#2 (High, docs)**:先前 docs 扫描 `tech/roles/development/quality-scans/20260819-docs/scan-report.md`(27 条:High 7 / Medium 10 / Low 10)全部仍未修复(同一工作树,README「185 tests pass」「No external source acquisition」「001–010」、CONTRIBUTING「does not yet contain a runnable application」等仍为旧文本)。
- **#3 (Medium, docs)**:测试计数四处漂移(CLAUDE.md「288」、CHANGELOG「297」、tech/16-bug-fixes「297」、mobile-ux boss-state「299」)。
- **#14 (Low, docs)**:`tech/roles/data/data-quality.md:21-29 vs :44-50` 两段 geocode 口径无范围标注(全国 drops vs 杭州 pilot),读起来矛盾。
- **#16 (Low, docs)**:`tech/roles/development/parallel-sessions/20260819-b2-u1-u6/` 批次目录仅 merge-report.md,缺 README manifest(违反 CLAUDE.md 批次约定)。

## 修复

### #3 权威计数(2026-08-19 boss 实测,以此为准)

`cd server && npm test` → **423 tests / 421 pass / 2 skipped**。同步以下文件:
- `CLAUDE.md:43`(「288 测试(2026-08-19)」→「423 测试(2026-08-19)」)
- `CHANGELOG.md:18`、`tech/16-bug-fixes.md:632`、其他扫描点出的计数(README 的 185 一并改,若 docs 扫描 #2 也涉及 README 计数则以 423 为准)

### #2 执行 docs 扫描 27 条

读 `tech/roles/development/quality-scans/20260819-docs/scan-report.md` 全文,按其建议批次 A-D(README/CONTRIBUTING、agent/tech-README/Makefile、API/设计文档、批次目录与仓库卫生)逐条修复。注意:
- **纯文档修正**(改文本/补索引/修正路径)→ 全部做。
- **需用户决策项**(docs 扫描 #23 regression-fix 批次完成确认、#20 420px 侧控栏口径交叉确认)→ **不做,保持原状**,在汇报中注明。
- 修改只涉及 `tech/**`、根文档(README/CHANGELOG/CONTRIBUTING/agent.md/CLAUDE.md)、`.claude/skills/`(若扫描点出)。
- **不碰任何 server/src 代码**(文档数字与代码行为不符时,以代码为准写文档,不反向改码)。

### #14 data-quality.md 口径标注
两段分别加「范围:全国 drops」/「范围:杭州 pilot」前缀与时间线。

### #16 b2-u1-u6 批次目录
补 `README.md` manifest(目标/workstream 表/合并顺序简表,内容可从 merge-report.md:3 与 git log 推断,注明「补录」)或按约定注明豁免原因。

## 测试(必做)

- 无代码改动 → 跑 `make docs-check`(必绿)+ `git diff --check`。
- 计数一致性自查:`grep -rn "423\|421\|288\|297" CLAUDE.md CHANGELOG.md tech/16-bug-fixes.md` 等扫描点出的文件,确认统一。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-qa5)

- 只动:根文档 + `tech/**` + `.claude/skills/**`(扫描点出的)。**不碰 `server/**` 代码**。
- 先读 `tech/roles/development/quality-scans/20260819-docs/scan-report.md` 与 `tech/roles/development/quality-scans/20260819-all/scan-report.md` 的 #2/#3/#14/#16 段。

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-qa5 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-qa-fixes/reports/ws-qa5.md`:
修复清单(27 条逐条状态:done/skip+原因)+ 计数同步 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。

## 续作附录(boss 2026-08-19,预算超限中断后续作)

已 commit:`6477208`(README 状态/采集/测试数/迁移/布局/import plan 对齐)、`2007c7c`(CONTRIBUTING 状态与命令)、`47558b8`(tech/README 阶段声明+索引 01-22)。`agent.md` 有未提交编辑(阶段声明+命令清单,基本完整)。开工先 `git status` + `git log --oneline -4` 对账,不重做。剩余:
1. **先 commit agent.md**:`git add agent.md && git commit -m "docs(agent): 阶段声明与命令清单对齐可运行应用现状"`(若发现不完整先补完再提交)。
2. **核对 docs 扫描 27 条剩余项**:读 `tech/roles/development/quality-scans/20260819-docs/scan-report.md`,对每个建议项检查当前树是否已修复(前 3 个 commit 已覆盖的部分标 done),未覆盖的完成;#14 data-quality.md 范围标注、#16 b2-u1-u6 manifest 补录确认/完成。
3. **计数核对**:`grep -rn "423\|288\|297\|185" CLAUDE.md CHANGELOG.md tech/16-bug-fixes.md README.md` 确认已统一为 423/421/2(未统一则改)。
4. 门禁(`make docs-check` + `git diff --check`)+ 写汇报。
5. 预算纪律:先 commit 再验证。

## 续作附录 2(boss 2026-08-19,第二次预算超限后收尾)

已 commit(9 个,工作树 clean,经 boss 抽查计数同步全部正确):agent/README/CONTRIBUTING/tech-README/server-README/tech/16/CHANGELOG/CLAUDE 计数 423/421/2、data-quality 口径、b2-u1-u6 manifest。**不要重做任何已提交工作**。剩余(小,尽量省预算):
1. `git status` + `git log --oneline -8` 确认 clean。
2. 对照 docs 扫描报告 `tech/roles/development/quality-scans/20260819-docs/scan-report.md` 逐项核对是否已覆盖(已提交的 9 个 commit + 既有树),把 **done/skip+原因** 列成清单;发现遗漏的小项(纯文档)补上并 commit。
3. 门禁:`cd /Users/acccan/dm-wt-qa5 && make docs-check && git diff --check`。
4. 写汇报(修复清单逐项状态 + 计数同步 + 门禁),末两行 token。
5. 预算纪律:任何新改动先 commit。
