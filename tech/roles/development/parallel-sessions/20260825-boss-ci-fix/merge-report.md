# 合并报告(2026-08-25)

## 结果总览
- 成功合并: b-memo-bundle x 1(fix/geocode-memo-bundle-safe)
- 失败/遗留: 无分支红停;1 个环境性门禁红(非 merge 归因,见「遗留问题」#2)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm run build / npm test / typecheck / docs-check / diff) | 冲突解决 |
|---|---|---|---|---|
| b-memo-bundle | fix/geocode-memo-bundle-safe | ✅ `git merge --no-ff`,ort 策略,无冲突 | build ✅(Compiled successfully, static 29/29, 含 /api/agent/chat)/ test ⚠️ 1664 pass / 1 fail / 3 skip(唯一红为本地未提交 geocode 数据致 data 契约断言,非 merge 归因)/ typecheck ✅ / docs ✅ / diff ✅ | 无冲突 |

## 门禁执行细节
- **`npm run build`(Turbopack,CI 同款)真跑通过**——在**主仓**(实体 node_modules,非 worktree 的 symlink)对 merge 后 dev 执行:`✓ Compiled successfully in 1027ms`、static pages 29/29(含 `/api/agent/chat` route,即 CI 红根因的打包图入口),TypeScript 阶段 2.6s 通过。**CI 根因已消除**;worker 的 Turbopack symlink panic 属 worktree 环境问题,主仓无此问题。
- `npm test`: 1668 total,1664 pass,1 fail,3 skip。唯一失败 = `tests/city-center-pins.test.mjs:58`「中心钉点站应大量存在…实际 977」:该测试直接读主树磁盘 `server/data/recruitment/**` 数据文件,而主树有 **72 个未提交的 geocode 结果**(用户 Env-only,城市名地址+中心坐标 → 真实 geocode 地址,站点离开中心桶致计数 977 < 1000)。本 merge 不触碰任何数据文件(仅 site-geocode.ts memo 路径 + 新增测试);worker 在数据干净的 worktree 预跑 = 1665 pass / 0 fail(同 1668 total)。CI 干净 checkout(提交态数据)该测试将绿。
- `npm run typecheck` ✅ / `make docs-check` ✅("Documentation policy check passed")/ `git diff --check` ✅。

## 冲突解决清单
无。merge 前已核:`git merge-base dev fix/…..dev` 区间内 dev 未改动 `site-geocode.ts` / `geocode-place-memo.test.mjs`;`PLACE_SEARCH_MEMO_FILE` 全仓引用仅存在于被分支替换的 3 处(定义 + 2 默认参数),无其它使用面。

## 代码验证(信任但验证)
- 逐行核对两提交(`e7ad16a` fix / `5163838` test):顶层 `new URL('../../.geocode-memo.json', import.meta.url)` 已删,替换为惰性 `placeSearchMemoFile()`(`join(process.cwd(), '.geocode-memo.json')`),默认参数改为调用期求值;cwd 契约注释与汇报一致;回归测试断言 `join(process.cwd(), …)`。语义不变(geocode 脚本与 next dev/start 均以 server/ 为 cwd)。

## 遗留问题
1. **主树未提交 geocode 数据(用户 Env-only 产物)**:`server/data/recruitment/radar/*.json` 72 个文件已 geocode 改写,未提交;`git status` 另有一批未跟踪批次目录。合并全程未触碰(未 stash / 未 checkout -- / 未提交),保持原样。⚠️ 该数据若后续提交,`city-center-pins.test.mjs:58` 的 `>= 1000` 计数断言将红(977)——属既有数据契约测试的已知漂移点(test 头注释自述「apply 重跑后站点离开中心桶…不钉会漂移的计数」,但 58 行仍钉了数量级阈值),建议用户提交 geocode 产物时一并按新计数快照调整该断言。
2. **worktree 环境(已解决,仅供参考)**:boss 预建 worktree 的 `server/node_modules` 为指向主仓的 symlink,Turbopack 对 project-root 外 symlink fatal panic——worker 门禁 BLOCKED 根因;主仓实体 node_modules 无此问题,本次门禁在主仓完成。
3. Env-only 步骤未做:迁移 apply / import:seed:apply / AMap geocode(用户自有)。

## 最终 dev 状态
- `git push origin dev` 完成:`09de7c9..a7aa7e6`。合并提交 `a7aa7e6`(Merge branch 'fix/geocode-memo-bundle-safe')含 2 提交:+26 / -4(site-geocode.ts 15+/4-,新增测试 11+)。
- worktree `/Users/acccan/dm-wt-b-memo-bundle` 已 remove;分支 `fix/geocode-memo-bundle-safe` 已 `-d`(merged)。
- 主树未提交 geocode 数据保持原样(未动);未 push main、未 force-push。

门禁: PARTIAL_RED
结论: MERGED_ALL
