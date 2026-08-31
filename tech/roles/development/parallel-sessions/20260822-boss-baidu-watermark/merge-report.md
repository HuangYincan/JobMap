# 合并报告(2026-08-22)

## 结果总览
- 成功合并: w1 x 1
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | fix/baidu-watermark | `dbf9c91` merge --no-ff,无冲突(2 文件 +6 行,足迹与 worker 汇报一致) | npm test 1417 / 1415 pass / 0 fail / 2 skip;typecheck pass;docs-check pass;git diff --check OK — 全绿 | 无冲突,auto-merge |

## 冲突解决清单
- 无。`map-shell.module.css`(L91-94 追加百度 logo_hd 隐藏规则)与 `component-contracts.test.mjs`(L1347 追加断言)均 auto-merge 成功,未触碰高德/腾讯样式与引擎核心逻辑(w1「不碰」满足)。

## 遗留问题
- **主树残留清理(已完成,非本批引入)**:merge 前主树有 2 处未提交残留,按幂等恢复铁律 `git checkout --` 恢复:
  - `server/next-env.d.ts`:typecheck 再生成的噪音(dev/prod types 路径差异),已恢复。
  - `tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/boss-state.md`:并行批次陈旧 checkpoint(ws-e 行标 RUNNING,但其分支 `fix/baidu-round2` 已并入 dev、worktree 仍在),已恢复到已提交版本;该批次后续如有 resume 需自行核对状态。
- **预存数据漂移已随基线修复**:w1 汇报中 2 个 `split-city-sites.test.mjs` 失败(boss 裁决放行)已确认修复——本批 merge 后 npm test 全绿(1415 pass / 0 fail),与 boss-state 中「engine-polish-2 merge f808fd0 顺带修复」一致。
- **合规提示(不阻塞,已记 deferred-notes)**:隐藏百度 logo 水印违反百度地图 ToS;项目对高德/腾讯已有同款先例,生产上线前可评估是否保留厂商标识。

## 最终 dev 状态
- HEAD `dbf9c91`(merge: fix/baidu-watermark),已 `git push origin dev`(9ef8106..dbf9c91)。
- worktree `/Users/acccan/dm-wt-baidu-watermark` 已移除,分支 `fix/baidu-watermark` 已删除。
- Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未执行,留给用户。

门禁: ALL_GREEN
结论: MERGED_ALL
