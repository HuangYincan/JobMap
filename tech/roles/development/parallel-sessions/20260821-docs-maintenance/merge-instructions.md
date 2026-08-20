# Merge Instructions — 20260821-docs-maintenance (worktree 合并版)

> **重要：本批合并不在主工作树进行**。另一个 boss 会话（qqdoc-jobs 数据批）正占用主树
> （`git status --short` 有它的未提交文件）。合并统一在 boss 预建的 detached worktree
> `/Users/acccan/dm-dev-merge` 进行（HEAD 已 detach 在 786fc99 = 当时 origin/dev），
> 完成后 `git push origin HEAD:dev`。**绝不碰主工作树的 git 状态**（不 add/commit/merge 主树）。

## 执行注意（本会话铁律）

- **全程 cwd = /Users/acccan/dm-dev-merge**。每个命令都以 `cd /Users/acccan/dm-dev-merge && …` 开头，
  或先单独 `cd /Users/acccan/dm-dev-merge` 再跑相对命令（`git status` / `git merge` / `npm` / `make` 都在该目录执行）。
- **绝不 cd 到 /Users/acccan/domain-map 执行任何 git 写操作**（add/commit/merge/switch/push）；主树只可读
  （`git status --short` 确认占用即可，不要依赖它）。
- 不用 `git pull`（detached HEAD 无法 pull）；若 origin 前进：`git fetch origin && git merge origin/dev` 同步后继续。
- 本会话起于主树 cwd；第一条命令必须先 cd 进 dm-dev-merge。

## 材料
- manifest: `tech/roles/development/parallel-sessions/20260821-docs-maintenance/README.md`
- 汇报: `reports/ws1.md` `reports/ws2.md` `reports/ws3.md` — 均 `门禁: PASSED / 结论: OK`

## 合并顺序（全部在 /Users/acccan/dm-dev-merge 内执行）
1. `git merge --no-ff fix/contract-docs` → 2. `git merge --no-ff fix/tech-docs` → 3. `git merge --no-ff fix/roles-archive`
- 每步后跑门禁（见下）；任一红 → 停，写 merge-report 报告

## 冲突解决指导（boss 裁决）
1. **fix/contract-docs**（ws1 侧优先）：
   - CLAUDE.md / agent.md / README.md / CONTRIBUTING.md 测试计数行：dev 写 549、ws1 写 **568(566 pass / 2 skip)** → **取 ws1 侧**（549 已过时；dev 实测 = qqdoc merge-report 566 pass + qqdoc-official.test.mjs 19 项 = 568）
   - CHANGELOG.md 08-20/08-21 节：ws1 版本是超集 → **取 ws1 侧**，腾讯条目只保留一份
   - TENCENT_MAP_KEY 相关行：两侧相同，任取一侧
2. **fix/tech-docs**（两侧合并）：tech/15-deploy.md 保留两侧全部改动（dev 侧 .env.example 路径 + 腾讯兜底行；ws2 侧计数 688/1959/11602 + 迁移范围）。计数将在 ws4 合并后复测校准
3. **fix/roles-archive**（应干净合并）：dev 新增的 qqdoc 批次目录与 ws3 文件无交集

## 门禁（每分支合并后，在 dm-dev-merge 内）
```bash
cd server && npm test && npm run typecheck
cd .. && make docs-check && git diff --check
```
- 预期：合并全部完成后 npm test = **568(566 pass / 2 skip)**
- 若 qqdoc 会话中途 push 了新 commit：`git fetch origin && git merge origin/dev` 同步后再继续（文件无交集,应干净）

## push 与收尾
- 三分支全绿后：`git push origin HEAD:dev`（origin/dev 是 HEAD 祖先时直接 ff 成功）
- 若 push 被拒（origin 已前进）：`git fetch origin && git merge origin/dev` → 重跑门禁 → 再 push
- 清理（容忍失败；失败记录到 merge-report，boss 兜底）：
  ```bash
  git worktree remove /Users/acccan/dm-wt-ws1 2>/dev/null || true
  git worktree remove /Users/acccan/dm-wt-ws2 2>/dev/null || true
  git worktree remove /Users/acccan/dm-wt-ws3 2>/dev/null || true
  git branch -d fix/contract-docs 2>/dev/null || true
  git branch -d fix/tech-docs 2>/dev/null || true
  git branch -d fix/roles-archive 2>/dev/null || true
  ```
- **dm-dev-merge worktree 保留**（boss 复验用），不要删除

## 回报
写 `tech/roles/development/parallel-sessions/20260821-docs-maintenance/merge-report.md`（模板见下），末两行：
```
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
```

### merge-report 模板
```markdown
# 合并报告(<date>)

## 结果总览
- 成功合并: <ws> x N
- 失败/遗留: <ws> x M + 原因

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |

## 冲突解决清单
## 遗留问题
## 最终 dev 状态
```

## 完成后自查
- [ ] 全部分支按序 merge，门禁全绿（或明确红停 + 原因）
- [ ] `git push origin HEAD:dev` 完成（门禁绿时）
- [ ] worktree/分支已清理（容忍已清理/失败记录）
- [ ] merge-report.md 已写，末两行 token 正确
- [ ] 未 push main、未 force-push；Env-only 步骤留给用户
