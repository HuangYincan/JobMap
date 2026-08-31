# 合并报告(2026-08-23)

## 结果总览

- 成功合并: ws-a / ws-b / ws-c 共 3 分支(按 manifest 顺序 a → b → c,全部 `--no-ff`)
- 失败/遗留: 无
- 全部 push 至 `origin/dev`;3 个 worktree 与分支已清理
- 最终 dev:`e091382`(含 3 个 merge commit + 1 个计数刷新 chore commit)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| a | feature/scan-auth-hardening | `e82850c` | 1483 / 1481 / 0 fail / 2 skip;typecheck 过;docs 过;diff 干净 | 无冲突 |
| b | feature/scan-api-boundaries | `81692a5` | 1487 / 1485 / 0 fail / 2 skip;typecheck 过;docs 过;diff 干净 | 无冲突 |
| c | feature/scan-docs-factsync | `1c87afa` | 1487 / 1485 / 0 fail / 2 skip;typecheck 过;docs 过;diff 干净 | 无冲突 |
| — | chore(docs) 计数刷新 | `e091382` | 1487 / 1485 / 0 fail / 2 skip;typecheck 过;docs 过;diff 干净 | — |

每次 merge 后均 `git push origin dev`(三次 push,无冲突、无 force)。合并基线:合并前 `git pull --ff-only origin dev`;本地 dev 原领先 origin 2 个 engine-polish-2 终态 commit(f8a2fd7/5c6666a,前一批次入库),随本次 push 一并发布。

## 合并编排修正(需 boss 知晓)

- **测试计数刷新 1470 → 1487**:ws-c 按 prompt 以其 worktree 实测 1470/1468/2 写回 6 处文档;但 ws-a(+13)与 ws-b(+4)先于 ws-c 合入,dev 终态实测为 **1487/1485/2**(本 merger 实跑 3 轮验证)。文档批次最后合并的意义即反映终态,故以 `e091382` 将现行计数声明(README.md / CLAUDE.md / CONTRIBUTING.md / agent.md / tech/05-milestones.md / server/README.md ×2 / CHANGELOG.md 08-23 条目)统一刷新为 1487/1485/2(2026-08-23),并重跑完整门禁全绿。
- 保留不动:CHANGELOG.md:13 历史计数(2026-08-21 并入时快照,ws-c 已记录例外)、engine-polish-2 批次 merge-report 与各 ws 汇报中的 1470(历史记录)。

## 冲突解决清单

无 merge 冲突(三个分支改动面互不重叠:server 认证/API 边界/文档)。

## 遗留问题

- ws-a:#2 全局每日 OTP 发送预算未做(数值需用户拍板,记 deferred);XFF 信任假设(生产需代理清洗转发头)deferred。
- ws-c:CHANGELOG.md:13 历史计数按证据保留(非错误)。
- 批次外:数据/口径类(#9 #19 #16 #2 全局预算)按 boss 裁决入 `deferred-notes.md`;追踪项 #10 #15 未动。
- ws-a worktree 2 个 `.bak` 备份文件(.bak-account-store.ts / .bak-session-store.ts,汇报注明与已提交版本逐字节一致)已随 `git worktree remove --force` 清理。
- 遗留 worktree(非本批):`dm-dev-merge` / `dm-wt-card-addr` / `domain-map-wt-nolod`,未触碰。

## 最终 dev 状态

- `e091382` = 原 dev(f8a2fd7 + 本地 2 个 engine-polish-2 终态 commit)+ merge ws-a + merge ws-b + merge ws-c + chore 计数刷新
- 门禁(终态实跑):`npm test` 1487 tests / 1485 pass / 0 fail / 2 skip;`npm run typecheck` 零错误;docs 策略 grep 无匹配;`git diff --check` 干净
- `origin/dev` = `e091382`(已 push);未 push main、未 force-push;Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未做,留给用户。

门禁: ALL_GREEN
结论: MERGED_ALL
