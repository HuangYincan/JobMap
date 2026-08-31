# WS-2: docs-check 自匹配既有红 — 排除 parallel-sessions 流水目录

## 背景
`make docs-check`(Makefile:56-58)是全库 grep 文档规范模式:
`grep -R -nE 'docs/roles/|docs/zh-cn/|预计发布时间.*2026-02-10|BOSS.*MVP.*爬|小红书.*MVP.*爬' --include='*.md' .`
20260821 批次的两个 merge-report(`tech/roles/development/parallel-sessions/20260821-boss-agent-thinkfix/merge-report.md:20`
与 `20260821-boss-tencent-geocode/merge-report.md:17`)为记录问题**复述了 grep 正则本身**,造成自匹配——早已并入 dev,
是 dev 既有红(20260821 两批均被其阻塞记录在案)。ws-1(同批)也已如实上报该红。

boss 已实测:对当前 dev 状态排除 `--exclude-dir=parallel-sessions` 后**零命中、全绿**。

## 任务(worktree /Users/acccan/dm-wt-docs-check 已预建,分支 fix/docs-check-exclude-sessions)
1. 修改 `/Users/acccan/dm-wt-docs-check/Makefile` 的 docs-check 规则,给 grep 加
   `--exclude-dir=parallel-sessions`(流水批次目录属开发记录,非正式文档,文档规范检查应排除)。
2. 顺带只读检查:同性质流水目录 `tech/roles/development/quality-scans/`(scan-report 可能复述正则)
   当前是否也有自匹配风险——若 grep 命中则一并排除,并在汇报说明;若未命中,保持不动,汇报说明。
3. 除 Makefile 外不做任何其他改动。

## 门禁(本任务只跑这三项;npm test/typecheck 不需要——纯 Makefile 规则改动,不影响 JS)
1. `cd /Users/acccan/dm-wt-docs-check && make docs-check` → 必须输出 'Documentation policy check passed.' 且 exit 0
2. `cd /Users/acccan/dm-wt-docs-check && git diff --check`
3. `git status` 确认仅 Makefile(可含 quality-scans 排除)被改;`git diff Makefile` 确认改动只加 exclude

## 提交
单条 Conventional Commit:`fix(ci): docs-check 排除 parallel-sessions 流水目录(终结 20260821 既有自匹配红)`
提交前 git status 干净。

## 回报
写 **/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-toggle/reports/ws-2.md**:
- 改动摘要(Makefile 1-2 行)
- quality-scans 检查结论(命中 or 未命中)
- 门禁实际输出(docs-check 输出原文)
- 遇到的问题(如无写「无」)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
