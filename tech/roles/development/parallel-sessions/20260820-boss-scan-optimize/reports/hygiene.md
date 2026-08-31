# ws-hygiene 汇报(2026-08-20)

## 结论先行
**任务目标文件均不在本 worktree 内,无法执行删除/入库;任务派发前提与物理事实不符。** 详见「遇到的问题」。

## 实际改动
- 无代码改动、无 commit(见下:无可用目标文件)。

## 核实结果(逐项)

### 任务 1:根 Playwright 产物删除
- `git status`(chore/repo-hygiene,干净)+ `git ls-files --others --exclude-standard`(空)+ `find <worktree根> -maxdepth 1`(仅 `docker-compose.yml`,已跟踪)→ **本 worktree 内不存在 `page-loaded.yml` / `state-check.png`,也无其他未跟踪 yml/png/screenshot 类根产物**。
- `.gitignore` 第 82 行已有 `.playwright-mcp/`(✓ 约定已生效,无需改动)。
- 结论:这两个文件是**主工作树**(/Users/acccan/domain-map)的未跟踪文件;`git worktree add` 只复制已跟踪文件,未跟踪文件不进入新 worktree。scan #13 是在主树发现的它们。

### 任务 2:20260819 批次目录入库
- 本 worktree 的 `tech/roles/development/parallel-sessions/` 下仅有 **3 个 20260819-* 目录,且全部已在 dev 上入库**(`git ls-files` 确认文件完整):`20260819-b2-u1-u6`、`20260819-data-quality-shanghai-poi`、`20260819-more-real-data-job-filters`(提交见 9463f69 / 4ec1526 / 7c027e7 等)。
- **其余 9 个 20260819-* 批次目录 + `quality-scans/20260819-*` 2 个目录在本 worktree 不存在**(`quality-scans/` 目录整个不存在;`git log --all -- tech/roles/development/quality-scans/` 无任何历史)→ 它们只存在于主树未跟踪区。
- 因此 scan #13「12 个目录从未入库」表述不精确:实际是 **3 个已入库、9 个未入库 + 2 个 quality-scans 未入库**。
- 未发现需排除的敏感/大文件——因为目标目录不在本 worktree,无法检查内容(主树被权限拦截)。

## 遇到的问题
- **派发前提错误**:任务要求删除/入库的文件(根产物 2 个 + 9 个批次目录 + 2 个扫描目录)物理上只存在于主工作树 /Users/acccan/domain-map 的未跟踪区。本 worktree(dm-wt-hygiene,从 dev 05:12 检出)按 git 语义不可能包含它们;`git rm`(目标未跟踪,git rm 本身也对其无效)与 `git add <路径>`(pathspec 不存在)在本 worktree 均无对象可操作。
- **主树不可访问 + 铁律禁止**:主树对本会话只读权限被拦截(ls/find 均被拒),且铁律「绝不碰主工作树」禁止从 worker 侧操作主树。
- **建议 boss 处置**(二选一):
  1. 在主树直接执行:未跟踪产物用 `rm page-loaded.yml state-check.png`(无需 commit;若想留痕可先 git add 再删——不必要);批次目录 `git add tech/roles/development/parallel-sessions/20260819-*`(9 个)+ `git add tech/roles/development/quality-scans/20260819-*`(2 个)后 commit,或由 merger 在 merge 阶段一并处理。
  2. 如确需 worker 执行:需授权该 worker 访问主树并放宽「不碰主树」约束(非常规,不建议)。
- 本 WS 无 commit,worktree 留原地;boss 可复用或丢弃 chore/repo-hygiene 分支。

## 证据
- `git status` → `On branch chore/repo-hygiene, nothing to commit, working tree clean`
- `git ls-files --others --exclude-standard` → 空;`find . -maxdepth 1`(yml/png/screenshot)→ 仅 `docker-compose.yml`
- worktree 指针:`gitdir: /Users/acccan/domain-map/.git/worktrees/dm-wt-hygiene`(标准 linked worktree)
- 已入库 3 目录的 tracked 文件清单:`git ls-files tech/roles/development/parallel-sessions/`(见上文,共 34 文件)
- `git log --all -- tech/roles/development/quality-scans/` → 空(从未入库)

## 门禁结果
- npm test: 488 通过 / 0 失败(2 skip)——全绿
- typecheck: 通过
- docs-check: 通过(`Documentation policy check passed.`)
- git diff --check: 通过(无输出)
(门禁在未改动代码的基线上跑,全绿;与任务能否执行无关)

门禁: PASSED
结论: BLOCKED: 目标文件(根产物 2 + 9 批次目录 + 2 quality-scans 目录)只存在于主树未跟踪区,本 worktree 不含、主树不可访问——需 boss 在主树直接清理/入库
