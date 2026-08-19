# WS: ws-docs — 文档数字与事实同步(scan #1 #2 #9 #10 #12 #15)

## 背景
2026-08-20 全库扫描(quality-scans/20260820-all)发现文档多处数字漂移与事实过时:
- 测试计数三处漂移:4 文件写「423(421 pass/2 skip)」、2 文件写「477(475/2)」、HEAD 实测「488(486 pass/0 fail/2 skip)」(tech/16-bug-fixes.md:50 为最新)
- CHANGELOG 缺 2026-08-20 两个已合入 dev 的条目
- Next.js 版本号过时/自相矛盾

## 任务(绝对路径,worktree: /Users/acccan/dm-wt-docs)

1. **取权威测试计数**:`cd /Users/acccan/dm-wt-docs/server && npm test`,以实测 pass/fail/skip 为准(预期 488/486/2)。
2. **统一计数到 6 处**(全部写实测值):
   - /Users/acccan/dm-wt-docs/CLAUDE.md(「423 tests」处,含日期改为 2026-08-20)
   - /Users/acccan/dm-wt-docs/agent.md(423 处)
   - /Users/acccan/dm-wt-docs/CONTRIBUTING.md(423 处)
   - /Users/acccan/dm-wt-docs/tech/05-milestones.md(423 处)
   - /Users/acccan/dm-wt-docs/README.md(477 处)
   - /Users/acccan/dm-wt-docs/CHANGELOG.md(477 处)
3. **CHANGELOG 补 2026-08-20 两条合入条目**(引用 tech/16-bug-fixes.md 对应段):
   - `788e9c6` positions-dedup(b1f):positions import self-heal dedup + 契约测试(参考 tech/16「2026-08-20」区与 git log 1 行摘要)
   - `933f972` work 全量加载:首点刷新/聚合计数漂移/死代码清理(参考 tech/16-bug-fixes.md:5-55 的 2026-08-20 条目)
4. **版本号统一**:CLAUDE.md「Next.js 15」→「Next.js 16」;README.md Repository Layout「Next.js 15 app」→「Next.js 16.3.1」。
5. **tech/05-milestones.md**:版本号「Next 15.5.23, React 19.0.8」→ 实测 package.json(预期 16.3.1 / 19.2.8 / TS 5.9.3);文件头 Last reviewed → 2026-08-20。
6. **agent.md 路径标注**::115/:185/:210/:246 引用 `tech/roles/development/implementation/<phase>.md`(目录不存在)——仿照 :108/:245 的惯例标注「规划,目录未建立」或改指实际位置(如 tech/16)。

## 文件边界
只改上述文档文件(CLAUDE.md/agent.md/CONTRIBUTING.md/README.md/CHANGELOG.md/tech/05-milestones.md)。
**不碰 server/src 任何代码**;不改 tech/16 的 488 记录(它是对的)。

## 门禁(必须全绿)
```bash
cd /Users/acccan/dm-wt-docs && make docs-check
cd /Users/acccan/dm-wt-docs/server && npm test
cd /Users/acccan/dm-wt-docs && git diff --check
```
(若 server/node_modules 缺失:已由 boss 符号链接,无需 npm install)

## 提交
小步 commit,Conventional Commits:`docs: 统一测试计数(实测 488)与 Next 16 版本号` / `docs: CHANGELOG 补 2026-08-20 两条合入` / `docs: agent.md 实施路径标注规划态`。

## 回报
写 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-scan-optimize/reports/docs.md:
- 改动文件清单 + 每个 commit 摘要
- 实测测试计数(数字)
- 遇到的问题(如有)
末两行必须精确:
```
门禁: PASSED
结论: OK
```
