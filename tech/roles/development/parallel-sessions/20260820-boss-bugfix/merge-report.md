# 合并报告(2026-08-20)

## 结果总览

- 成功合并: b1/b2/b3/b1f × 4(b1f 为 b1 的后续修复,2026-08-20 boss 实测 import 失败后派发)
- 失败/遗留: 无(0 红停);遗留 Env 步骤归用户(见下)

批次目标:3 个 BUG 修复——①positions 重复行导致 poi-card 重复 key 警告(import 自愈去重 + 组件防御)
②公司 POI 屏闪(marker 只增不删 + setVisiblePOIs)③Next 版本陈旧警告(升 16.3.1 + React 19.2.8)。
b1f:修复 b1 自愈块顺序错误(先迁移后去重会在 UPDATE 语句内撞唯一索引
`positions_source_id_external_id_key`,事务回滚)→ 交换为先去重(保 MIN(id))再迁移再 upsert。

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| b1 | fix/positions-dedup | `85ecceb`(no-ff,4 文件 +105/−1,clean) | ✅ 480 tests / 0 fail / 2 skip;tsc 0 错误;docs-check ✅;diff-check 无输出 | 无冲突 |
| b2 | fix/marker-stability | `8837fe9`(no-ff,6 文件 +429/−47,clean) | ✅ 488 tests / 0 fail / 2 skip;tsc 0 错误;docs-check ✅;diff-check 无输出 | 无冲突 |
| b3 | chore/next-16 | `2e43886`(no-ff,9 文件 +284/−203,clean) | ✅ 488 tests / 0 fail / 2 skip;tsc 0 错误;docs-check ✅;diff-check 无输出;b3 worktree 内已验 `npm run build` ✓(16.3.1) | 无冲突 |
| b1f | fix/positions-dedup-order | `788e9c6`(no-ff,2 文件 +28/−18,clean) | ✅ 488 tests / 0 fail / 2 skip;tsc 0 错误;docs-check ✅;diff-check 无输出 | 无冲突 |

注:测试数 477 基线 → b1 +3 → b2 +8 = 488;b1f 未新增测试(改 2 个既有 positions-dedup 契约,
断言 dedup < migrate < upsert 顺序不变量),仍 488,无减少。

## 冲突解决清单

- 4 个 merge 均无冲突(ort 策略自动合并,无手动解决项)。各分支「不碰」边界
  (b1/b1f: recruitment-import 自愈块 + 契约测试;b2: map 三件套;b3: package.json/升级)
  天然无文件重叠,无需取舍。b1f 仅改 b1 已落地的自愈块顺序与注释,文件完全由 b1f 独占,
  无跨分支改动。

## 遗留问题

1. **主树 node_modules 未同步 16.3.1**(merger 沙箱 `npm install` 被拒):主树仍装 next 15.5.23 / react 19.0.8,
   而 `server/package.json`/`package-lock.json` 已声明 16.3.1 / 19.2.8。按 boss-state「合并后 Env:主树 npm install
   同步 16.3.1」归 boss/user 执行;b3 升级的正确性已由 b3 worktree 内真实安装的门禁验证(test 477/475/2 + build ✓)。
2. **Env-only 步骤留给用户**(未做):`import:seed:apply` 重跑验证去重(boss 实测失败已由 b1f 修复,
   需重跑确认不再撞唯一键)、清理 SQL 兜底(如需要)、build/smoke 冒烟。
3. b1 worktree 遗留探针文件 `.b1-reporter.mjs` 已随 `git worktree remove --force` 一并清除。

## 最终 dev 状态

- 本地/远端 `dev` 均指向 `788e9c6`(4 个 merge commit,按序 b1→b2→b3→b1f),已 push origin。
- 4 个 worktree(`dm-wt-b1/b2/b3/b1f`)已移除,4 个分支(`fix/positions-dedup`、`fix/marker-stability`、
  `chore/next-16`、`fix/positions-dedup-order`)已删除。
- 未动 main、无 force-push;主树仅剩历史遗留的未跟踪批次目录(既有状态,非本次产物)。

门禁: ALL_GREEN
结论: MERGED_ALL
