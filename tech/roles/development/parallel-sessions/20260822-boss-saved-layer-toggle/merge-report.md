# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-1 x 1 + ws-2 x 1(全部 2 分支按 manifest 顺序合并,门禁全绿)
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-2 | fix/docs-check-exclude-sessions (b2079d5) | `5253726` merge --no-ff 干净 | npm test 0 fail / typecheck 通过 / docs-check 通过(排除规则生效,终结 20260821 既有自匹配红)/ diff-check 通过 | 无冲突 |
| ws-1 | fix/saved-layer-toggle (4c59191 + ccf932b) | `6bf2092` merge --no-ff 干净 | npm test 1113 pass / 0 fail / typecheck 通过 / docs-check 通过 / diff-check 通过 | 无冲突 |

> 合并顺序按 manifest:ws-2(docs-check 规则修复)先合使门禁转绿,再合 ws-1(代码修复)——顺序正确,ws-1 合并后 docs-check 全绿验证了依赖关系。

## 冲突解决清单
- 无冲突(两个分支改动文件零重叠:ws-2 仅 Makefile;ws-1 仅 server/ 下 hooks/lib/components/tests)。

## 遗留问题
- ws-1 根因 #3(dev 专属 StrictMode keepalive 链:Layers 面板 dynamic import → disconnect/reconnect → setView(null) → 控制器销毁摘 marker)经判定为 dev-only + 自愈,已记录不修(生产无此路径)。
- ws-2 扫描结论:quality-scans/ 目录当前无自匹配风险,保持不动;若未来 scan-report 复述正则导致自匹配,可仿照补 `--exclude-dir=quality-scans`。
- 主工作树遗留:未提交的 CLAUDE.md 一行注释改动(「测试数量以实际运行结果为准」)按幂等恢复规则还原为已提交版本,如需可重新应用。
- Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)按规则未执行,留给用户。

## 最终 dev 状态
- dev HEAD: `6bf2092`(merge fix/saved-layer-toggle),已 push origin dev(65c07ba → 6bf2092,两批提交)。
- 门禁: npm test 1113 pass / 0 fail(含新增 6 个 saved-layer-sync 回归测试)、typecheck 通过、make docs-check 通过、git diff --check 通过。
- 两个分支 worktree 已 remove,分支已 -d 删除;未触碰 main、未 force-push。

门禁: ALL_GREEN
结论: MERGED_ALL
