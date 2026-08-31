# 合并报告(2026-08-20)

## 结果总览
- 成功合并: w5/w1/w3/w2/w4 × 5(首次运行,manifest 顺序)+ f1 × 1(第二批分支,resume 后合入)= **6 分支全部合入**
- 失败/遗留: 无
- dev 基线 `cc9fae1`(本地)已随首次 push 一并推送 origin(origin/dev `e1ace57` → `f13fbb6`)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w5 | feat/data-code-coverage | `da754ed`(1st,按 manifest 先合) | 455/453 pass·2 skip / 0 / pass / 干净 | 无冲突(ort 干净合并) |
| w1 | fix/cluster-consistency | `b178cb0`(2nd) | 464/462 pass·2 skip / 0 / pass / 干净 | 无冲突 |
| w3 | feat/logo-coverage | `3632fa3`(3rd) | 471/469 pass·2 skip / 0 / pass / 干净 | 无冲突 |
| w2 | fix/poi-first-locate | `fe2aee9`(4th) | 477/475 pass·2 skip / 0 / pass / 干净 | 无冲突 |
| w4 | docs/sync-20260820 | `98bd159`(5th) | 477/475 pass·2 skip / 0 / pass / 干净 | 无冲突 |
| f1 | fix/import-upsert-ambiguity | `f13fbb6`(6th,第二批 resume) | 477/475 pass·2 skip / 0 / pass / 干净 | 无冲突(ort 干净合并,基于 98bd159 直连) |

- 每分支合并后均重跑完整门禁:server `npm test` + `npm run typecheck`(exit 0)+ 根目录 `make docs-check`(pass)+ `git diff --check`(无输出)。
- 测试计数累计:基线 455/453+2 → w1 +9 → w3 +7 → w2 +6 = 477/475+2(f1 修改既有契约测试未增数,全量复跑 477/475/2 与 f1 自测一致),未见合并引入回归。
- crawler 单测(`66 tests OK`)由 w5 自测全绿;merger 沙箱禁 python 执行无法复跑,但 crawler 路径合并零冲突,合并后内容与 w5 测试内容一致。

## 冲突解决清单
- 无冲突:6 个分支均为干净 ort 合并,未进入任何手工冲突解决。

## 遗留问题(非 merger 职责,转 boss/用户)
1. **Env-only 步骤(README §Env,合并验证后由 boss 执行)**:① 串味 147 行 `plan-site-geocode` + `geocode-sites-apply` 有界修正;② `npm run import:seed:apply` + `audit:pins`(icon 存量导入 D-02;MODE_CACHE_VERSION 已由 f1 bump 13→14,客户端旧缓存失效);③ betta-hangzhou DB 行验证(w1 报告 SQL:`SELECT c.name, s.city, s.lng, s.lat, c.tier FROM company_sites s JOIN companies c ON c.id=s.company_id WHERE c.slug='betta-hangzhou';`,期望 city='杭州'/lng≈120.258/lat≈30.438/tier=6);④ 全国 radar drops geocode(630 公司/1194 无坐标站点)= deferred D-03。
2. **w4 遗留已闭环**:`server/src/lib/freshness.ts:7` 注释已由 f1 更新为 tech/18 §A1 决策(2026-08-17 已取代 tech/17 提案),原遗留项关闭。
3. **w3 映射表**:`DOMAIN_LOGO_MAP` 唯一条 `47.96.146.209 → zdpi.org.cn`(浙江省发展规划研究院),boss 已联网复核 ✓;onerror 兜底链保证即使域名偏差也只优雅降级 emoji。
4. 其他批次目录(20260819-\*/quality-scans/ 等)仍为 untracked 工作区材料,未入库(与仓库既有约定一致)。

## 最终 dev 状态
- `git log origin/dev -6`:`f13fbb6`(merge f1)→ `98bd159`(merge w4)→ `fe2aee9`(merge w2)→ `3632fa3`(merge w3)→ `b178cb0`(merge w1)→ `da754ed`(merge w5),底上为 `2da8a6e`(w5 基线 commit)
- 6 个 worktree 已全部 `git worktree remove`(含 f1,无残留;w5 的 4 个 scratch 脚本此前已由 boss 清理);6 个分支已 `git branch -d` 删除
- 主工作树 `dev` 干净(status 仅无关 untracked 批次目录);`git push origin dev` 每次门禁绿后已推送(末次 `98bd159..f13fbb6`);未 push main、未 force-push

门禁: ALL_GREEN
结论: MERGED_ALL
