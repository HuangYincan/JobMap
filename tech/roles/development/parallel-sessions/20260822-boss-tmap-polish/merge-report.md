# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-a / ws-b / ws-c x 3
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| a | feature/tmap-poi | `--no-ff` 干净合并(12853db),无冲突 | npm test 1162(1162 pass/2 skip/0 fail)/typecheck 通过/docs-check 通过/diff --check 通过 | 无冲突 |
| b | feature/tmap-style-controls | `--no-ff` 合并(ccb04d0) | npm test 1170(1170 pass/2 skip/0 fail)/typecheck 通过/docs-check 通过/diff --check 通过 | tech/23-map-engines.md append 冲突,「保留双方段落」(ws-a 节 + ws-b 节) |
| c | feature/baidu-ready-signal | `--no-ff` 干净合并(4ee41ad),无冲突 | npm test 1171(1171 pass/2 skip/0 fail)/typecheck 通过/docs-check 通过/diff --check 通过 | 无冲突 |

注:merge 前三个分支 tip 与任务书一致(ws-a 729c55f / ws-b b9bbfe3 / ws-c cdb1918),
三分支均不在 `git branch --merged dev` 中(无重复合并),boss 已复核门禁绿。

## 冲突解决清单
- `tech/23-map-engines.md`(ws-b 合并时):ws-a 与 ws-b 均为追加文档节 →
  append-vs-append 冲突;按任务书「保留双方段落」解:保留 HEAD(ws-a 节)在前 +
  ws-b 节在后,去除三行冲突标记,无内容取舍。
- 其余全部自动合并:tencent-engine.ts(ws-a marker/MultiMarker/icon 段 vs
  ws-b style/scale/水印段按行自动合并,零冲突)、map-shell.tsx(zoom 段)、
  map-shell.module.css、map-markers.ts、baidu-engine.ts、各测试文件均干净合并。

## 遗留问题
1. **主树有 4 个其他批次/用户的未提交改动,本批次未触碰**(见「最终 dev 状态」):
   `server/data/recruitment/official-career/蔷薇.json`(user-run geocode apply
   Env-only 输出)、`server/next-env.d.ts`(Next 自动生成)、
   `tech/roles/development/parallel-sessions/20260822-boss-agent-navi/README.md`
   与 `merge-report.md`(navi 批次合并 worker 上次中断残留,内容完整,待其批次
   入库 commit;boss 可对账后处置)。
2. 各 ws 遗留(已记 tech/23 回填节):TMap 状态样式 zIndex 近似、远程 logoUrl
   CORS 待真机核实、徽章图标阴影、百度禁用 AK 回滚契约真机验证、水印隐藏 ToS
   权衡(用户决策优先)——均留给 boss 合并后 Playwright 冒烟回填(deferred)。
3. Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未执行,留给用户。

## 最终 dev 状态
- dev `05997e8` → `12853db`(ws-a)→ `ccb04d0`(ws-b)→ `4ee41ad`(ws-c),已 push
  origin/dev(`05997e8..4ee41ad`)。
- worktree `/Users/acccan/dm-wt-pa`、`/Users/acccan/dm-wt-pb`、`/Users/acccan/dm-wt-pc`
  已移除;分支 `feature/tmap-poi`、`feature/tmap-style-controls`、
  `feature/baidu-ready-signal` 已删除。
- 未 push main、未 force-push;无 Env-only 步骤执行。
- 批次目录入库 commit 已随本报告提交(见 git log)。

门禁: ALL_GREEN
结论: MERGED_ALL
