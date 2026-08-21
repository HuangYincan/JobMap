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

---

# 轮2: ws-d(feature/tmap-satellite,tip d46fff7)—— 卫星底图修正

## 结果总览
- 成功合并: ws-d x 1
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| d | feature/tmap-satellite | `--no-ff` 干净合并(63caa8f),无冲突 | npm test 1212(1212 pass/2 skip/0 fail)/typecheck 通过/docs-check 通过/diff --check 通过 | 无冲突 |

## 冲突解决清单
- 无冲突,4 文件自动合并:tencent-engine.ts(setStyle 段 `'raster'` → `'satellite'`)、
  map-engine-tencent-style.test.mjs(卫星断言 + setBaseMap 回归)、
  map-engine-tencent.test.mjs(ws-b 遗留 setStyle 用例断言同步,ws-d 汇报已明示)、
  tech/23-map-engines.md(追加 ws-d 回填节,修正 ws-b 节记录错误)。
- merge 前 branch 不在 `git branch --merged dev`(无重复合并),tip 与任务书一致 d46fff7。

## 遗留问题
1. **主树仍有其他批次/用户的未提交改动,本批次未触碰**:agent-memory 批次 staged
   文件(server/src/lib/memory-store.ts、db/migrations/018_user_memories.sql、
   tech/26-agent-memory.md 等,疑为该批次入库 commit 中断残留)、qqdoc/radar/
   official-career JSON 数据、server/next-env.d.ts、navi 批次残留、多个批次目录
   未入库(untracked)。留给 boss 对账处置,本批次未动。
2. ws-d 真机冒烟(切「卫星」应出现影像+道路注记、console 有瓦片请求)待 boss
   Playwright 回填 —— ws-d 为 headless worker,以 SDK v1.8.0.2 实包源码核实为准
   (证据串见 reports/ws-d.md,SDK 包 /tmp/tmap-gljs.js)。

## 最终 dev 状态
- dev `a34da06` → `63caa8f`(ws-d merge commit),已 push origin/dev(a34da06..63caa8f)。
- worktree `/Users/acccan/dm-wt-pd` 已移除;分支 `feature/tmap-satellite` 已删除。
- 未 push main、未 force-push;无 Env-only 步骤执行。
- 批次目录入库 commit 已随本报告提交(见 git log)。

门禁: ALL_GREEN
结论: MERGED_ALL
