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
