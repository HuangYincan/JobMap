# 合并报告(2026-08-21 · round 1)

## 结果总览
- 成功合并: ws1/ws2/ws3 x 3
- 失败/遗留: 无。headless merger(boss-merger)首次派发未执行任何合并(输出仅「等待子进程」,exit 0),由 boss 在独立合并 worktree 手工按序完成(同裁决指导,流程与报告格式不变)

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws1 | fix/contract-docs (131b952) | fcde78f --no-ff | 568 tests / 566 pass / 2 skip ✅ typecheck ✅ docs-check ✅ diff ✅ | CLAUDE.md/agent.md 计数行取 ws1 侧(568,dev 549 过时);CHANGELOG 取 ws1 超集(腾讯条目逐字保留一份 + geocode 三批 + qqdoc 条) |
| ws2 | fix/tech-docs (06fb400) | 2d4ed91 --no-ff | 同上 ✅ | 无冲突(15-deploy 两侧改动自动并:dev 侧 .env.example 路径 + 腾讯兜底行;ws2 侧 688/1959/11602 + 迁移 016) |
| ws3 | fix/roles-archive (ba23fda) | ca962da --no-ff | 同上 ✅ | 无冲突 |

## 冲突解决清单
1. CLAUDE.md:43「npm test 计数」549(dev) vs 568(ws1) → **568**(dev 549 为 qqdoc 合并前快照;合并后实测 568 = 566 pass / 2 skip)
2. agent.md:360 同上 → **568**
3. CHANGELOG.md 08-21 节:HEAD 侧空 + ws1 侧 4 条 → 去标记保留 ws1 侧;腾讯条目(两侧逐字相同)保留一份

## 遗留问题
- ws2 的 15-deploy 计数 688/1959/11602 基于不含 qqdoc 源的基线 → **ws4 复测校准**(round 2)
- ws3 索引 qqdoc-official 行 in-flight 已过时(实际已合并) → **ws4 修正**(round 2)
- 主树被另一 boss 会话(qqdoc-jobs 数据批)占用,本次合并全程在独立 worktree /Users/acccan/dm-dev-merge 进行,未触碰主树 git 状态

## 最终 dev 状态
- origin/dev: `ca962da`(786fc99 + 3 个 merge commit)
- 合并后实测:`cd server && npm test` = 568 tests / 566 pass / 0 fail / 2 skip;typecheck 0 错误;docs-check + diff --check 通过
- round 2(ws4)待派

门禁: ALL_GREEN
结论: MERGED_ALL
