# 合并报告(2026-08-22)

## 结果总览

- 成功合并: ws-a / ws-b / ws-c / ws-d 共 4 个分支,按序 merge 回 dev,门禁全绿
- 失败/遗留: 无
- 最终 dev: 1296 pass / 0 fail / 2 skip,typecheck / docs-check / diff-check 全绿,已 push origin dev

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| a | fix/tmap-poi-interaction (e2e292f) | 干净 merge | 1272 pass / typecheck 绿 / docs 绿 / diff 绿 | 无冲突 |
| b | fix/tmap-wheel-switch (7478142) | 冲突 1 处 | 1276 pass / typecheck 绿 / docs 绿 / diff 绿 | tech/23-map-engines.md 追加段冲突,保留双方(ws-a + ws-b 节顺序排列);tencent-engine.ts 自动合并,ws-a marker 段 + ws-b 构造段均保留(verify: resolveTMapMarkerAnchor L128/711 + scrollable:true L1198) |
| c | fix/baidu-diagnostics (8d5cee4) | 冲突 1 处 | 1290 pass / typecheck 绿 / docs 绿 / diff 绿 | tech/23-map-engines.md 追加段冲突,保留双方(ws-a/b + ws-c 节顺序排列);use-map-engine.ts 自动合并(ws-b 核查结论零改动 + ws-c 错误路径段均在) |
| d | fix/geolocation-blue-dot (7c8032a) | 冲突 1 处 | 1296 pass / typecheck 绿 / docs 绿 / diff 绿 | tech/23-map-engines.md 追加段冲突,保留双方(ws-a/b/c + ws-d 节顺序排列);map-shell.tsx 自动合并(ws-d 蓝点段 USER_BLUE_DOT_ICON/syncUserBlueDot 在位) |

## 冲突解决清单

1. **tech/23-map-engines.md(ws-b)**:ws-a 与 ws-b 各自追加独立文档节 → 按序保留 ws-a 节 + ws-b 节,删除冲突标记。
2. **tech/23-map-engines.md(ws-c)**:在 ws-a/ws-b 节后追加 ws-c 节,删除冲突标记。
3. **tech/23-map-engines.md(ws-d)**:在 ws-a/b/c 节后追加 ws-d 节,删除冲突标记。

四次合并均无代码文件冲突:tencent-engine.ts(ws-a marker 段 vs ws-b 构造/相机段,段互不重叠,git 行合并自动通过)、use-map-engine.ts(ws-b 核查零改动,仅 ws-c 错误路径段)、map-shell.tsx(ws-d 蓝点段,自动合并)。均按指令「保留双方修改」为解。

## 遗留问题

- ws-b 报告的 work 模式 zoom ≤ 8 城市聚合徽章不重建疑点(map-shell.tsx cluster effect deps 缺 engineView)—— 不在本批 4 分支边界,已记入 tech/23 与 ws-b 汇报,需 boss 裁决后续批次。
- ws-a 遗留:TMap 状态样式 zIndex 层序近似、远程 logoUrl CORS 待真机核实(tech/23 已记录)。
- 各 ws 真机冒烟(Playwright 点击/视觉)因 headless worker 无浏览器 deferred,由 boss 合并后冒烟回填。

## 最终 dev 状态

- 4 个 merge commit(每个分支一个 --no-ff),外加 4 次冲突解决 commit(并入各 merge commit)
- `git push origin dev` 完成(db97861..56d0d4c)
- worktree ia/ib/ic/id 已 remove,4 个 fix 分支已 -d 删除
- 批次目录(README/prompts/reports/merge-report/boss-state/logs)随本轮 commit 入库

门禁: ALL_GREEN
结论: MERGED_ALL

---

# 轮2 合并报告(2026-08-22)— ws-e(fix/icon-cors-preflight)

## 结果总览

- 成功合并: ws-e(fix/icon-cors-preflight,tip 3124474,4 commits)
- 失败/遗留: 无
- 合并方式: `git merge --no-ff`,干净 merge 零冲突(基座 6b260c0;dev 其后仅多一个无关 data commit 05a2a85,与分支文件零重叠)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| e | fix/icon-cors-preflight (3124474) | 干净 merge | 1361 tests / 1359 pass / 0 fail / 2 skip;typecheck 绿;docs 绿;diff 绿 | 无冲突 |

## 门禁明细

- npm test: **1361 tests / 1359 pass / 0 fail / 2 skip**(基线 1344 + ws-e 新增 15,零漂移,与 ws-e 汇报一致)
- `npm run typecheck`: 通过
- `make docs-check`: Documentation policy check passed
- `git diff --check`: 干净(工作树 + merge commit HEAD^..HEAD)

## 收尾

- `git push origin dev` 完成
- worktree `/Users/acccan/dm-wt-icon` 已 remove,分支 `fix/icon-cors-preflight` 已 -d 删除
- 批次目录(merge-report 轮2 + reports/ws-e.md + boss-state/merge-instructions)随本轮 commit 入库

## 遗留问题

- 维持轮1 遗留:真机冒烟(Playwright)由 boss 合并后统一回填;TMap 远程 logoUrl CORS 真机核实 deferred。
- ws-e 自身无遗留(汇报结论 PASSED / OK)。

门禁: ALL_GREEN
结论: MERGED_ALL

---

# 轮3 合并报告(2026-08-22)— ws-f(fix/icon-preflight-silent)

## 结果总览

- 成功合并: ws-f(fix/icon-preflight-silent,tip 114cfee,3 commits)
- 失败/遗留: 无
- 合并方式: `git merge --no-ff`,干净 merge 零冲突(基座 740d4e4,分支文件与 dev 零重叠)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| f | fix/icon-preflight-silent (114cfee) | 干净 merge | 1366 tests / 1364 pass / 0 fail / 2 skip;typecheck 绿;docs 绿;diff 绿 | 无冲突 |

## 门禁明细

- npm test: **1366 tests / 1364 pass / 0 fail / 2 skip**(与 ws-f 汇报一致,零漂移)
- `npm run typecheck`: 通过
- `make docs-check`: Documentation policy check passed
- `git diff --check`: 干净(工作树 + merge commit)

## 收尾

- `git push origin dev` 完成(740d4e4..67b2907)
- worktree `/Users/acccan/dm-wt-icon2` 已 remove,分支 `fix/icon-preflight-silent` 已 -d 删除
- 批次目录(merge-report 轮3 + reports/ws-f.md + boss-state/merge-instructions)随本轮 commit 入库

## 遗留问题

- 维持轮1/轮2 遗留:真机冒烟(Playwright)由 boss 合并后统一回填;TMap 远程 logoUrl CORS 真机核实 deferred。
- ws-f 自身无遗留(汇报结论 PASSED / OK)。

门禁: ALL_GREEN
结论: MERGED_ALL
