# 合并报告(2026-08-21,轮3 milestone)

> 批次 `20260821-boss-map-engine`;本轮为 **轮3(f)合并**。轮1(a、b)与轮2(c、d、e)已由此前 milestone 合并入库;轮4(g)尚未派发完成,由 boss 在后续 milestone 继续,非失败分支。

## 结果总览
- 成功合并: f 共 1 个(轮3,`--no-ff`);累计 a–f 共 **6 个已入库**(a/b 轮1、c/d/e 轮2、f 轮3)
- 失败/遗留: 0 红停;g 共 1 个为 PENDING(轮4 未派发,等待 boss 派发)

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| a | feature/map-engine-backend | ✅(轮1,73c3f0b) | 轮1 全绿 | 无冲突 |
| b | feature/map-engine-core | ✅(轮1,5fcb8a6) | 轮1 全绿 | 无冲突 |
| c | feature/map-engine-amap | ✅(轮2,8d9338c) | 轮2 全绿 | 无冲突 |
| d | feature/map-engine-tencent | ✅(轮2,f96ed95) | 轮2 全绿 | 无冲突 |
| e | feature/map-engine-baidu | ✅(轮2,80d45d0) | 轮2 全绿 | 无冲突 |
| f | feature/map-engine-ui | ✅ 3e06a6b | 825 tests / 823 pass / 0 fail / 2 skip(基线 skip);typecheck ✅;docs-check(跟踪文件 git grep 零匹配)✅;git diff --check ✅ | 无冲突(ort 自动合并) |
| g | feature/map-engine-docs | —(未派发) | — | — |

## 冲突解决清单
无冲突,无人工取舍。唯一文件重叠为 `server/tests/component-contracts.test.mjs`:dev 侧(agent-batch / candcat-list)修改中部 candidate-category 用例(hunk 在 ~L586-660),ws-f 仅在文件末尾追加 2 个新契约用例(地图源 section 接线 + map-shell 迁移完成断言),hunk 不重叠,ort 策略自动合并。

dev 自 ws-f 基线(782d2ca,轮2 合并 + avatar-account-label)以来新增 15 个 commit(agent-backend-core / agent-docs / city-centers 入库 / candcat-list),与 ws-f 文件边界(`map-engine/*`、`hooks/use-map-engine.ts`、`layers-panel.tsx`、`recent-panel.module.css`、`i18n.ts`、`map-shell.tsx` +2 行)零重叠。

## 遗留问题
- **g(轮4)未派发**:ws-g 需按 adjudication 完成 —— 扩展 `BasePOI.source` 联合加 'tencent'/'baidu' + tencent/baidu 引擎改用之 + 删 map-adapter.ts + 文档收尾(仅零重叠项)。未完成 → 非红停,待 boss 从 `3e06a6b` 派发。
- **docs-check 全树扫描仍被未跟踪批次目录误伤**:`reports/e.md` L106(轮2 遗留)与 `20260821-candcat-list/merge-report.md`(该批次自身 milestone 处理)自匹配 docs-check 正则字面量。跟踪文件经 `git grep` 验证零匹配 → 代码门禁有效。里程碑 4 批次目录 commit 前改写 e.md 措辞;本报告正文刻意不含该正则字面量。
- deferred-notes.md 各项继续有效:#1/#2 Env-only key、#3 重叠文档 defer(docs-maintenance 批次)、#4 真实 key 冒烟、#5/#6 切换后 style 快照与 geolocation 蓝点行为。
- 三引擎 vendor API 的 [冒烟待验] 项(沙箱禁网)仍需真实 key 冒烟核对,结果回填 tech/23。
- ws-f 汇报建议:合并后统一截图复核移动端抽屉(≤767px)地图源 section 视觉效果(本 WS headless)。
- Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未执行,留给用户。

## 最终 dev 状态
- dev HEAD:`3e06a6b`(merge f)← `7da6fdd`(f tip)← `a257fcf`(candcat-list)← `9b4cd8f`(agent-docs)← … ← `80d45d0`(轮2 merge e);轮1 `73c3f0b` / `5fcb8a6`、轮2 `8d9338c` / `f96ed95` / `80d45d0` 均已在历史中
- `git push origin dev` 已完成:3e06a6b 已入库(origin/dev = 3e06a6b)
- worktree dm-wt-eng-f 已移除;分支 feature/map-engine-ui 已删除(已并入 dev)
- 未 push main、未 force-push;其他批次 worktree(dm-wt-agent-b / dm-wt-agent-c / dm-dev-merge)未触碰
- 本批次目录自身 commit 入库按 boss-state milestone 4(轮4 后)执行,本轮未提交

门禁: ALL_GREEN
结论: MERGED_ALL(轮3 f 已合入;a–f 累计 6 分支入库;轮4 g PENDING 待派发,非红停)
