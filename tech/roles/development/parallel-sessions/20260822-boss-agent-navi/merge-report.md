# 合并报告(2026-08-22)

## 结果总览
- 成功合并: navi x 1
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| navi | feature/agent-navi-links | `--no-ff` 干净合并,无冲突 | npm test 1141(1139 pass/2 skip/0 fail)/typecheck 通过/docs-check 通过/diff --check 通过 | 无冲突 |

## 冲突解决清单
- 无(merge 全程零冲突;navi 分支未触碰 `server/data/`)。

## 遗留问题
1. **主树 `server/data/recruitment/official-career/蔚来.json` 有用户未提交改动**(2 条职位补了 lng/lat 坐标,02:16 修改)——判为 address-first 批次 deferred 的 Env-only geocode apply 输出(用户自跑),**未动未提交**,留给用户自行处置。
2. **Playwright 视觉验证**(导航按钮/桌面点击跳转/移动端 UA 唤起)按 boss-state deferred_notes 留给 VERIFY 阶段(浏览器空闲时)。
3. **MCP 工具清单未离线复核**:amap/tencent/baidu 实际 navi 工具名需 boss 在有网环境 `tools/list` 确认;`navi|uri|url|link|scheme → directions` 规则已对 navi_uri/navi_link 类名全覆盖,与现有 route/direction 规则无重复。
4. 其他批次 worktree(`dm-wt-backfill` / `dm-wt-saved-mutex` / `domain-map-wt-nolod` / `dm-dev-merge`)属各自批次,未动。

## 最终 dev 状态
- dev `1dc6d38` → `c7e5625`(merge commit = navi 5 commits:ecf856d→bf821f3→551dfda→cc56c7d→e08bee1),已 push origin/dev。
- worktree `/Users/acccan/dm-wt-agent-navi` 已移除;分支 `feature/agent-navi-links` 已删除。
- 未 push main、未 force-push;无 Env-only 步骤执行(迁移/import:seed:apply/AMap geocode 均留给用户)。

门禁: ALL_GREEN
结论: MERGED_ALL
