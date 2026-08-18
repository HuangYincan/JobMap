# 合并报告(2026-08-19)

## 结果总览
- 成功合并: w4/w5/w2/w3/w1 × 5(按 manifest 顺序 w4 → w5 → w2 → w3 → w1)
- 失败/遗留: 无

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w4 | feat/auth-auto-register-hint | 4ab573c(no-ff,干净) | pass 331/fail 0 · ✓ · ✓ · ✓ | 无 |
| w5 | fix/saved-overlay-wipe | 0932215(no-ff,自动合并) | pass 331/fail 0 · ✓ · ✓ · ✓ | 无(component-contracts 自动合并) |
| w2 | feat/official-ats-adapters | d7e6ecc(no-ff,干净) | pass 331/fail 0 · ✓ · ✓ · ✓ + crawler 58 测试(见遗留) | 无 |
| w3 | feat/shanghai-pilot-data | ff52d59(no-ff,干净) | pass 331/fail 0 · ✓ · ✓ · ✓(shanghai-pilot.test 4/4) | 无 |
| w1 | feat/poi-category-loading | 36672d1(no-ff,自动合并×4) | pass 334/fail 0 · ✓ · ✓ · ✓ | 无(map-shell/i18n/component-contracts/tech16 全部自动合并) |

- 每个分支合并后均 `git push origin dev` 成功(dev: 5fa67e2 → 36672d1)
- 每个分支收尾:`git worktree remove` + `git branch -d` 全部完成

## 冲突解决清单
- **无冲突**。w1/w5 同文件分区约定(map-shell.tsx 749-1039/2128 vs 1376-1398 + 1029 抑制钩子)得到 git 3-way 自动合并验证,双改全部保留;最终门禁全绿佐证语义正确。

## 遗留问题
1. **crawler pytest 未能重跑**(w2 merge 后):本环境沙箱禁 python3 pytest(普通/unsandboxed 均需审批)。已用字节级等价验证代替:`git diff HEAD feat/official-ats-adapters -- crawler/` 为空 + w4/w5 未触碰 crawler → dev 中 crawler 与 worker 实测通过(58/58)的分支 tip 完全一致。
2. **w2 残留 debug_fetch.py**:按 w2 汇报授权,随 `git worktree remove --force /Users/acccan/dm-wt-w2` 一并删除。
3. **Env-only 步骤未做**(留给用户/boss,见 README Post-merge 清单):`make crawl-official --write`、`node scripts/validate-positions-llm.mjs`、`npm run geocode:sites:apply`、`npm run import:seed:apply`。
4. **w3 管线发现(需 boss 裁决)**:`geocode-sites-apply.mjs` 的 already-pinned 跳过为公司级,试点跑法下得物/商汤/禾赛的 -shanghai 站点不会被解析;需站点级(siteId)小修 — 不在本批合并范围,见 `tech/roles/data/shanghai-pilot.md`。
5. 非试点公司杭州坐标(快手/芯迈/云鲸/兴业等 30 家)按口径未动(deferred)。

## 最终 dev 状态
- dev HEAD: `36672d1`(含 5 个 merge commit,顺序 w4→w5→w2→w3→w1)
- 主工作树干净(仅未跟踪的 session 目录);5 个 worktree 与 5 个分支已全部清理
- 门禁在最终 HEAD(36672d1)上整体重验: pass 334 / fail 0 / skipped 2 · typecheck ✓ · docs-check ✓ · diff-check ✓

门禁: ALL_GREEN
结论: MERGED_ALL
