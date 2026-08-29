# 合并报告(2026-08-26)

## 结果总览
- 成功合并: l-logo × 1
- 失败/遗留: 无 × 0

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| l-logo | fix/brand-logo-landmark | ✅ merge --no-ff(2b6d539) | 1686 pass / 0 fail / 3 skip(typecheck ✅ / docs-check ✅ / diff ✅) | 无冲突 |

## 冲突解决清单
- 无冲突。合并 auto-merge 通过(6 文件,+204/-3),未触碰「不碰」文件(city-cluster / spatial-query / server-catalog / mode-cache / crawler / components / hooks / 其它数据文件)。

## 遗留问题
- **腾讯深圳「滨海大厦」改动选 `name` 而非 `address`**:改动目标是**展示识别**(站点名显示在卡片/地图点),`name` 不参与 work 模式关键词搜索(`search.ts poiMatchesQuery` 匹配 company.name/行业/岗位标题)。若期望「滨海大厦」作为搜索词命中,需把该词并入 company.name(超出本 ws 边界,未越权,供 boss 后续裁决)。
- **智元/智元机器人未收录品牌映射**:careerUrl 落在 `agirobot.jobs.feishu.cn`,品牌官网域不确定(agirobot vs agibot),遵守「只收录域名确定」未映射。
- **测试数微小差异**:开发汇报记 1687 pass / 1690 total;本 merger 实跑 1686 pass / 1689 total(branch 内临时验收用例已回退为 noop,少 1 条)。0 fail,门禁绿。
- **Env-only 步骤留给用户**:`npm run import:seed:apply` / AMap geocode(不在本批次代码范围)。
- **worktree 已清理**:残留的两个未跟踪 noop 文件(`server/.tmp-list-names.mjs`、`server/tests/tmp-enumerate-names.test.mjs`)未 stage、未并入任何提交;worktree `/Users/acccan/dm-wt-l-logo` 已移除。

## 最终 dev 状态
- HEAD: `2b6d539`(merge commit:fix/brand-logo-landmark)已 push 至 `origin/dev`(4e947bd..2b6d539)。
- 分支 `fix/brand-logo-landmark` 已删除;worktree 已移除;主树未被污染(非本批的环境产物 `server/next-env.d.ts`、`server/tech/`、其它 parallel-sessions 批次目录保持原状)。

门禁: ALL_GREEN
结论: MERGED_ALL
