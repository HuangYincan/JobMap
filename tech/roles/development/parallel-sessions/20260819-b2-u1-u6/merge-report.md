# 合并报告(2026-08-19)

> 批次:WS-B(B2.1)+ WS-U1~U6。无 manifest 目录(各分支回报由用户在 `/merge-agent` 参数内联提供),合并顺序按回报顺序:WS-B → U1 → U2 → U3 → U4 → U5 → U6。所有分支同基 `400f1e4`,逐个 `--no-ff` 串行合并。

## 结果总览

- **成功合并:7 / 7**(WS-B、U1、U2、U3、U4、U5、U6),门禁全部绿。
- 失败/遗留:0。无红停。
- 每步 merge 后均跑 `npm test` + `npm run typecheck` + `make docs-check` + `git diff --check`,全绿;每步后 `git push origin dev`。
- 基线测试(合并前):278 tests / 276 pass / 0 fail / 2 skip。合并后最终:**288 tests / 286 pass / 0 fail / 2 skip**。
  - U2 +1(U2 新增 1 条,279)、U3 +7(→286)、U6 +2(→288)。2 skip 为既有 DB 门(与合并无关)。

## 逐分支明细

| WS | 分支 | merge commit | 门禁(npm test / typecheck / docs-check / diff) | 冲突解决 |
|---|---|---|---|---|
| WS-B | `fix/b2-1-validation-fails` | `6be84b9` | 278·276p ✅ / ✅ / ✅ / ✅ | CHANGELOG(见下) |
| WS-U1 | `feature/sidebar-chrome` | `8c650aa` | 278·276p ✅ / ✅ / ✅ / ✅ | 无(干净合并) |
| WS-U2 | `feature/filter-refine` | `f1c3887` | 279·277p ✅ / ✅ / ✅ / ✅ | CHANGELOG |
| WS-U3 | `feature/suggest-fix` | `73b2155` | 286·284p ✅ / ✅ / ✅ / ✅ | CHANGELOG + secondary-sidebar.tsx |
| WS-U4 | `feature/profile-redesign` | `f0152cc` | 286·284p ✅ / ✅ / ✅ / ✅ | CHANGELOG |
| WS-U5 | `feature/mobile-drawer-physics` | `7afe414` | 286·284p ✅ / ✅ / ✅ / ✅ | CHANGELOG(amend 去重,见下) |
| WS-U6 | `fix/poi-mixing` | `490d388` | 288·286p ✅ / ✅ / ✅ / ✅ | CHANGELOG + map-shell.tsx |

## 冲突解决清单

1. **CHANGELOG.md**(WS-B/U2/U3/U4/U5/U6 每一步都冲突,共 6 次)。
   - 根因:每个分支都在 `## 2026-08-18` 节追加自己的条目,dev 上 24f361a(skills)+ 已合并分支的内容同步增长。
   - 解决方式:每次**合并保留双方全部条目**,按节内顺序组织 —— `### Added` → `### Changed` → `### Fixed`,U4(Profile 重构)、U5(抽屉跟手)条目归入 `### Changed`(语义为交互/UI 改动),U6 的「产品口径确认」保留为独立子节。全部 7 个分支的 changelog 内容都在最终文件里,无丢失、无重复。
2. **secondary-sidebar.tsx**(WS-U3 vs WS-U1) — import 行冲突。U1 删除了 `activeFilterChips/removeFilterChip` 导入(chips 移除),U3 增加 `formatDistance`。验证 U3 分支的 chips 用法已随 U1 的 chips 块删除被正确带走(合并后 `grep` 无残留引用)。解法:采用 U1 的删除 + U3 的 `formatDistance`。
3. **map-shell.tsx**(WS-U6 vs dev 已含 U1/U3/U4/U5) — 仅 import 块冲突。U3 引入 `fetchPOIDetail`/`formatDistance`,U6 引入 `batchMatchesCurrentMode`。解法:合并两套导入。合并后验证:`batchMatchesCurrentMode` 使用 4 处(4 个落库守卫)、`fetchPOIDetail` 1 处、`formatDistance` 1 处,均落位。
4. **account-panel.module.css**(WS-U4 整文件重写 vs WS-U1 `left:233px` 偏移)—— **自动合并成功**,无冲突。核验:`left: 233px; /* 215 + 12 + 6 */` 已正确保留在 U4 的新结构上(第 14 行)。
5. **WS-U5 合并提交曾出现 CHANGELOG 重复条目**:我第一次 resolve 时 sed 清标记不彻底,U5 条目残留副本(正确的一份在 `### Changed`,另一份误留在节尾)。已在 push 前 **`--amend` 去重**(`77de562` → `7afe414`),最终文件该条目仅 1 处。

## 遗留问题(未做,留给用户/后续)

1. **Env-only 步骤未执行**(按角色铁律):迁移 apply、`npm run import:seed:apply`、AMap geocode 均未跑 —— 是用户的。
2. **`feature/hz-poi-local` worktree 残留**:`/Users/acccan/domain-map-wt-hz-poi-local`(分支已于 2026-08-17 并入 dev)。属本批之前的遗留,非本批分支,未清理。
3. **WS-B 报告提示**:`portal-megvii-campus` 仍在(校园入口,warn 非 fail),与已移除的 `portal-megvii-social` 同属官网入口型 —— 是否一并处理由用户决定(本批未动)。
4. **WS-B 报告提示**:剩余 8 fail(网易/聂果基金/长亭/betta/deepseek 等「计划/专项/入口名」标题)与 1 error(腾讯 `radar-302c5ea36a84` LLM 空响应,下次全量自动覆盖)留待后续拆解/决策。
5. **测试计数口径**:CLAUDE.md 记「185 tests」是旧值;当前基线 278、合并后 288(均已含 DB 门 skip 2)。建议收尾时同步 CLAUDE.md 计数。
6. **WS-U1 报告提示**:`tech/09` 57/537 行(420px 基准)与 `tech/07` 268 行(work chips)是本次改动**之前**就已过期的描述,未动 —— 建议另行清理。
   - **(2026-08-20 补注 — 已核实关闭)** 本条目描述的是**批次当时**的过期状态,勿再按「420px」处置:
     `tech/09-secondary-sidebar.md` 现行 57/204/537 行均为 **380px**,与代码
     `server/src/components/secondary-sidebar.module.css:31`(`width: 380px`)一致;git 历史
     `8aa5be2`(420→恒 380)与 `d161e03`(2026-08-19,commit 明写 "sidebar width (420→380)")佐证
     **380px 才是正确基准**,tech/09 无需改动。tech/07 268 行 work-chips 部分亦已由 `d161e03`
     一并处理(commit 明写 "drop work-chip constraint")。
7. **WS-U5 worktree 清理**:丢弃了该 worktree 未提交的 `typescript 5.9.3→5.8.2` 降级(package.json/lockfile,env 噪音,不在分支提交内)。分支提交的 diff 不含 package 改动。
8. 各 worktree 的 `server/node_modules` symlink(指向主树 node_modules)在清理时已移除,主树 node_modules 不受影响。

## 最终 dev 状态

- `dev` HEAD:`490d388`(origin/dev 已同步)
- 7 个 merge commit:`6be84b9 → 8c650aa → f1c3887 → 73b2155 → f0152cc → 7afe414 → 490d388`
- 测试:288 tests / 286 pass / 0 fail / 2 skip;`npm run typecheck`、`make docs-check`、`git diff --check` 全绿。
- 本批 7 个 feature/fix 分支已全部删除;worktree 已全部移除(除遗留的 hz-poi-local)。
