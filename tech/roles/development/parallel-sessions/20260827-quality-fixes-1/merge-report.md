# 合并报告(2026-08-27)

## 结果总览

- 成功合并: q-db / q-recruit / q-auth / q-robots / q-agent / q-csp / q-read / q-front / q-docs = 9 个 workstream
- 失败/遗留: 无。全部按 manifest 顺序合并,门禁全绿。
- 冲突: 1 处(q-docs 与 q-db 在 `tech/02-data-model.md` 冲突),已解决。

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| q-db | fix/quality-position-site-fk | `17a4b0d` | 1690 pass/0 fail/3 skip + typecheck + docs-check + diff 全绿 | 无 |
| q-recruit | fix/quality-recruitment-integrity | `a0bfaa5` | 1696 pass/0 fail/3 skip + typecheck + docs-check + diff 全绿 | 无 |
| q-auth | fix/quality-auth-integrity | `90813cd` | 1703 pass/0 fail/3 skip + typecheck + docs-check + diff 全绿 | 无 |
| q-robots | fix/quality-robots-groups | `714d121` | 1703 pass/0 fail/3 skip;crawler 114/114 OK(boss 测试日志);typecheck + docs-check + diff 全绿 | 无 |
| q-agent | fix/quality-agent-boundaries | `eb4524e` | 1706 pass/0 fail/3 skip + typecheck + docs-check + diff 全绿 | 无 |
| q-csp | fix/quality-csp | `87f0f25` | 1708 pass/0 fail/3 skip + typecheck + docs-check + diff 全绿 | 无 |
| q-read | fix/quality-public-read | `08190f2` | 1716 pass/0 fail/3 skip + typecheck + docs-check + diff 全绿 | 无 |
| q-front | fix/quality-frontend-edges | `1fcda67` | 1720 pass/0 fail/3 skip + typecheck + docs-check + diff 全绿 | 无 |
| q-docs | fix/quality-docs-current | `250593f` | 1720 pass/0 fail/3 skip + typecheck + docs-check + diff 全绿 | `tech/02-data-model.md`(见下) |

> 说明: 各分支 merge 后跑完整门禁时 npm test 计数为当时的累计基线(后并入分支包含先前分支改动),均 0 fail。q-robots 仅改 crawler + 文档,沙箱禁止直接运行 python3,故 crawler 门禁以 worktree 内 boss 实测日志 `logs/q-robots-boss-test.log`(Ran 114 tests / OK,分支 tip `df7efeb` 与并入内容一致)为依据。

## 冲突解决清单

1. **`tech/02-data-model.md`**(q-docs vs 已并入的 q-db):
   - 两侧都是文档事实更新:q-db(HEAD)记录迁移 020 position/site/company ownership 不变量;q-docs(基于 d899b3f)把迁移集更新为 001–019 并补精确语义(017 avatar bytes / 018 user memories / 019 memory uniqueness)。
   - 解决:以 001–020 为权威范围,保留 q-db 的 020 语义、preflight 阻止/诊断、Env-only apply 说明;并入 q-docs 的 017/018/019 精确措辞与 checksum 记录说明。无任何代码/数据改动。
   - 未发现其它冲突(q-csp 与 q-docs 同改的 `tech/15-deploy.md` 自动合并成功,两段内容均保留)。

## 遗留问题

- **Env-only 步骤未执行**(留给用户/后续):迁移 020 apply、`import:seed:apply`、AMap geocode。
- **crawler 门禁复核方式**:本环境沙箱拒绝 `python3` 执行,q-robots 的 crawler 测试以 boss 事先在 worktree 写入的 `logs/q-robots-boss-test.log` 为证据;若需独立复核可在 dev 主树人工 `make test-unit`。
- **主工作树未跟踪产物**(非本批改动,未处理):`.agents/`、`AGENTS.md`、`server/tech/`、历次 `parallel-sessions/` 目录、`quality-scans/20260827-all/`。不影响合并结果。
- **`server/next-env.d.ts`**:为 Next.js 生成的构建产物,typecheck/构建时会反复改写,已在合并前后恢复为 dev 版本,未纳入任何提交。

## 最终 dev 状态

- HEAD: `250593f`(merge: fix/quality-docs-current),已 push `origin/dev`。
- 合并序列:`17a4b0d`(q-db)→ `a0bfaa5`(q-recruit)→ `90813cd`(q-auth)→ `714d121`(q-robots)→ `eb4524e`(q-agent)→ `87f0f25`(q-csp)→ `08190f2`(q-read)→ `1fcda67`(q-front)→ `250593f`(q-docs)。
- 门禁: 每个分支 merge 后 `npm test` / `npm run typecheck` / `make docs-check` / `git diff --check` 全绿;最终 dev 复跑全绿(1720 pass / 0 fail / 3 skip)。
- 所有分支 worktree 已 `git worktree remove`,分支已 `git branch -d`(9/9 全部清理)。

门禁: ALL_GREEN
结论: MERGED_ALL
