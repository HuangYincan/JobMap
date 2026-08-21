# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-a / ws-b / ws-c / ws-d 共 4 分支,按序全部并入 dev。
- 失败/遗留: 无分支级失败。dev 基线存在 **2 个既有数据状态测试失败**(与本次 4 分支无关,boss 已确认以「零新增失败」为绿判定标准):
  - `tests/drops-coordinate-consistency.test.mjs:64` —— 蔚来-site-绍兴(绍兴市)坐标落在杭州参考框内(报错提示需重跑 `fix-sweep-accident-coords.mjs`);
  - `tests/split-city-sites.test.mjs:284` —— qqj 临界点(上海/深圳/北京)拆分后主站点补点用例。
  - 已在合并前于 df4b26d(合并前 dev HEAD)基线复现完全相同的 2 失败(22 pass/2 fail 同两文件),证明为 dev 既有状态,非本批引入。

## 逐分支明细
| WS | 分支 | merge commit | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-a | fix/baidu-style (262b49d) | db35b7c | 1378 pass/2 fail(基线同款 2 失败)/typecheck 过/docs 过/diff 干净 | 无冲突 |
| ws-b | fix/baidu-poi-locate (f77cad0) | 6408b42 | 1384 pass/2 fail(基线同款)/typecheck 过/docs 过/diff 干净 | tech/23 尾部追加段冲突 → 保留双方(ws-a + ws-b 两节并存) |
| ws-c | fix/tencent-poi-icon (171c544) | cb42e99 | 1393 pass/2 fail(基线同款)/typecheck 过/docs 过/diff 干净 | tech/23 尾部追加段冲突 → 保留双方(ws-c 节并入) |
| ws-d | fix/tencent-locate (2545985) | 7c16766 | 1393 pass/2 fail(基线同款)/typecheck 过/docs 过/diff 干净 | tech/23 尾部追加段冲突 → 保留双方(ws-d 节并入) |

- 合并后全量:1397 tests / 1393 pass / 2 fail(仅基线 2 项)/ 2 skip;`npm run typecheck` 零错误;`make docs-check` passed;`git diff --check` 干净。
- 引擎双改段落核验:tencent-engine.ts 含 ws-c `resolveTMapMarkerAnchor`(anchor = -offset,0-x 防 -0)与 ws-d `browserPosition` 高精度参数(L1132 `{ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }`);baidu-engine.ts 含 ws-a BAIDU_DARK_STYLE_JSON 与 ws-b 浏览器定位(L1032 同款高精度参数)。段落互不重叠,双方修改均保留。

## 冲突解决清单
- 三处冲突(merge 2/3/4)全部为 `tech/23-map-engines.md` 文件尾「回填」追加节位置冲突(ws-a/ws-b/ws-c/ws-d 各追加一节,append-only):统一解法 = 保留双方段落,按合并顺序 ws-a → ws-b → ws-c → ws-d 依次拼接,删除冲突标记;无任何代码行取舍(各 ws 追加节内容互不重叠)。
- 未发生代码文件冲突(baidu-engine.ts / tencent-engine.ts / 两个测试文件均自动合并成功)。

## 遗留问题
- dev 基线 2 个数据状态测试失败(蔚来-site-绍兴 drop site 坐标落杭州框 + qqj split-city),与本次 4 分支无关;建议 boss 安排数据清扫批次(`fix-sweep-accident-coords.mjs` 重跑 + qqj 拆分数据核修)后恢复 ALL_GREEN。
- 各 ws 遗留项(真机冒烟、TMap 状态视觉 zIndex、距离圈手柄等)见各自 reports/<ws>.md 与 tech/23 对应回填节,均已记录,非本次合并范围。

## 最终 dev 状态
- dev HEAD: `7c16766`(merge: fix/tencent-locate),已 push origin dev(`a6f2f63..7c16766`)。
- 4 个 worktree(bs/bp/ti/tl)已 remove;4 个分支已 `git branch -d` 删除。
- 批次目录入库 commit: `chore: 20260822 boss engine-polish-2 轮1入库(ws-a/b/c/d merge-report + 汇报)`(merge-report + 各汇报 + manifest)。

门禁: PARTIAL_RED
结论: MERGED_ALL
