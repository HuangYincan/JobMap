# WS: ws-hygiene — 仓库卫生:根 Playwright 产物 + 20260819 批次目录入库(scan #13)

## 背景
2026-08-20 全库扫描发现:
- 仓库根有 Playwright 产物 `page-loaded.yml` + `state-check.png`(未跟踪),违反 CLAUDE.md「截图与产物统一存 .playwright-mcp/」约定
- tech/roles/development/parallel-sessions/ 下 12 个 20260819-* 批次目录 + quality-scans/20260819-* 2 个目录从未入库(已完成批次的 merge-report 等历史无版本记录)

## 任务(绝对路径,worktree: /Users/acccan/dm-wt-hygiene)

1. **删除根 Playwright 产物**(git rm,提交):
   - /Users/acccan/dm-wt-hygiene/page-loaded.yml
   - /Users/acccan/dm-wt-hygiene/state-check.png
   - 顺带检查仓库根有无其他同类产物(git status 未跟踪文件里找 yml/png/screenshot 类),有则一并处理;确认 .playwright-mcp/ 已在 .gitignore。
2. **20260819 批次目录入库**(git add 明确路径 + commit):
   - `git add tech/roles/development/parallel-sessions/20260819-*`(12 个目录)
   - `git add tech/roles/development/quality-scans/20260819-*`(2 个目录)
   - 提交前检查:目录内有无不该入库的大文件/敏感文件(如 .env、密钥、截图大文件)→ 若有,加 .gitignore 条目或排除后提交,并在报告中说明
   - **不要动 20260820-* 目录**(本批进行中,boss 收尾统一入库)
3. git add 与 cwd 无关,用绝对路径安全;commit 用 Conventional Commits:`chore: 20260819 批次目录入库(12 批 + 2 扫描)` / `chore: 清理根 Playwright 产物`。

## 文件边界
仓库根产物 + tech/roles/development/** 下 20260819-* 目录。**不碰 server/src、tech/*.md 单篇文档**。

## 门禁(必须全绿)
```bash
cd /Users/acccan/dm-wt-hygiene && make docs-check
cd /Users/acccan/dm-wt-hygiene/server && npm test
cd /Users/acccan/dm-wt-hygiene && git diff --check
```

## 回报
写 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-scan-optimize/reports/hygiene.md:
- 删除的根产物清单
- 入库目录清单 + commit 摘要
- 是否发现需排除的文件(敏感/大文件)
- 遇到的问题(如有)
末两行必须精确:
```
门禁: PASSED
结论: OK
```
