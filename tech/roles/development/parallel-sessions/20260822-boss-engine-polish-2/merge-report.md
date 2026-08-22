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

---

# 轮2 合并(ws-e fix/baidu-round2,2026-08-22)

## 结果总览
- 成功合并: ws-e(fix/baidu-round2,tip 230ff5c,3 commits)1 分支并入 dev。
- 失败/遗留: 无分支级失败。轮1 遗留的 2 个 dev 基线数据域失败(蔚来-site-绍兴 drop site、qqj split-city)已被后续 geofix 批次(fix/geocode-r4-tests)修复,本轮门禁 **0 失败**。

## 逐分支明细
| WS | 分支 | merge commit | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-e | fix/baidu-round2 (230ff5c) | 4275bb7 | 1419 pass/0 fail/2 skip;typecheck 过;docs 过;diff 干净 | baidu-engine.ts 双实现冲突 → 保留双方机制(见下) |

- 合并后全量:1421 tests / 1419 pass / 0 fail / 2 skip(轮1 基线 2 失败已随 geofix 批次消失);`npm run typecheck` 零错误;`make docs-check` passed;`git diff --check` 干净。

## 冲突解决清单(baidu-engine.ts,唯一冲突文件)
ws-e 与 dev 既有 ws-pinfix2 各自独立修复同一根因(BMapGL v1.0 `Marker.setContent` 为空操作),两套实现语义互补,统一解法 = **保留双方机制**:
1. `createContentMarker`(content 标记主路径):保留 dev/pinfix2 的**自定义 Overlay DOM 渲染**(SDK 有 Overlay 能力时走此路径,dev 已验证行为零改动)。
2. `createContentFallbackMarker`(SDK 无 Overlay/DOM 的兜底路径):主体保留 ws-e 的**厂商 marker DOM 注入**实现(`markerContentDom.set` + `scheduleMarkerContentInjection` 有界重试 + 透明 1×1 图标扛锚点 anchor=-offset),并补回 ws-e 的 wrapper `setContent` 重入更新(注入 DOM 内容刷新,选中/高亮状态切换)——首轮合并漏取该 wrapper,被 ws-e 重入测试(1419 全量 0 fail 前)当场拦下,amend 修正。
3. icon 路径 CORS 防御:保留 dev 既有 `resolveIconUsable` 守卫(与 ws-e 内联版语义逐位一致),ws-e 的 CORS 说明注释保留;ws-e 内联重复实现删除(死代码)。
- 测试文件 map-engine-baidu.test.mjs 自动合并(ws-e 第 8 节 +4 与 pinfix2 overlay 断言并存);tech/23-map-engines.md 追加节无冲突。

## 遗留问题
- **主工作树非合并残留(未动、未提交)**:8 个 radar JSON 数据文件(中华商务/京东方/兆易创新/公牛集团/国轩高科/安克创新/强生/快手等)有未提交改动——8 家互不相关公司 drop-site 被改成同一坐标(深圳百度国际大厦,113.94264,22.524633),疑似 geocode 批次误写残留(`.address-work/` 目录亦在场)。与本次合并零交集,按「不 clobber 他人工作」未清理未提交,已原样保留;建议 boss 核验该残留归属后处置(勿直接入库)。
- 各 ws 遗留项见 reports/ws-e.md 与 tech/23 回填节。

## 最终 dev 状态
- dev HEAD: `4275bb7`(merge: fix/baidu-round2),已 push origin dev(`dbf9c91..4275bb7`)。
- worktree `/Users/acccan/dm-wt-br2` 已 remove;分支 `fix/baidu-round2` 已 `git branch -d` 删除。
- 批次目录入库 commit: `chore: 20260822 boss engine-polish-2 轮2入库(ws-e baidu-round2 merge-report + 汇报)`。

门禁: ALL_GREEN
结论: MERGED_ALL

---

# 轮3 合并(ws-f fix/baidu-r3,2026-08-22)

## 结果总览
- 成功合并: ws-f(fix/baidu-r3,tip 712ea4d,3 commits)1 分支并入 dev。
- 失败/遗留: 无。门禁 0 失败(1423 pass / 0 fail / 2 skip),typecheck / docs-check / diff-check 全绿。

## 逐分支明细
| WS | 分支 | merge commit | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-f | fix/baidu-r3 (712ea4d) | 218b6eb | 1423 pass/0 fail/2 skip;typecheck 过;docs 过;diff 干净 | 无冲突(自动合并) |

- 合并后全量:1425 tests / 1423 pass / 0 fail / 2 skip;`npm run typecheck` 零错误;`make docs-check` passed;`git diff --check` 干净。
- 合并内容核验:baidu-engine.ts 删除自定义 Overlay 主路径(真机坐实 `addOverlay` 只调 `_i` 不挂 pane,1049 个 addOverlay 静默失效 + DOM/img 泄漏)→ 厂商 Marker + 点击目标 DOM 注入主路径,注入零定时器(同步 + 微任务 4 轮 + rAF 5 帧有界重试);测试重写 6 用例;tech/23 追加 ws-f r3 回填节(52 行)。真机验收:z13 单点级 1048 `.dm-badge` 全可见可点击,z≤8 聚合走 GL dataURL icon 纹理(135 聚合 marker),截图 3.5-4.5s → 0.1-0.5s。

## 冲突解决清单
- 无冲突。三个文件(baidu-engine.ts / map-engine-baidu.test.mjs / tech/23-map-engines.md)均自动合并成功。

## 遗留问题
- **并发协调提示**:本批合并期间,另一并行批次(20260822-boss-agent-inputbar)的 merge(bed7082)由并发进程并入同一主工作树并随本批 push 上行。本批门禁在 218b6eb 树全绿;bed7082 引入的 agent-inputbar 改动由该批自己的 merger 负责门禁。已在最终 HEAD(1de6e78)复核全量门禁,见下。
- ws-f 建议:若 boss 仍可复现「截图持续超时」卡死,建议在长会话/多引擎切换场景复测(本 WS 修复已消除两个嫌疑:Overlay 无主 div + img 泄漏、ws-e 版 setInterval 轮询注入)。
- worktree dev server 基建(硬链接 node_modules、.env.local)为本地未跟踪改动,git 零影响。
- 主工作树其他未跟踪内容(`.address-work/`、其他批次目录)与本次合并零交集,未动。

## 最终 dev 状态
- ws-f merge commit: `218b6eb`(merge: fix/baidu-r3,parents ef20c09 + 712ea4d)。
- 合并期间另一并行批次(agent-inputbar)的 merge `bed7082`(parents 218b6eb + 9eaa0eb)由并发进程并入同一主树,随本批 push 一并上行;dev HEAD = `1de6e78`(本批 入库 commit)。已 push origin dev(`ef20c09..bed7082` 首推,`bed7082..1de6e78` 入库后二推),未 force-push。
- worktree `/Users/acccan/dm-wt-br3` 已 remove;分支 `fix/baidu-r3` 已 `git branch -d` 删除。
- 批次目录入库 commit: `chore: 20260822 boss engine-polish-2 轮3入库(ws-f baidu-r3 merge-report + 汇报)`(1de6e78)。

门禁: ALL_GREEN
结论: MERGED_ALL

---

# 轮4 合并(ws-f fix/baidu-r4,2026-08-22)

## 结果总览
- 成功合并: ws-f(fix/baidu-r4,tip bf1dd7c,3 commits,基于 dev HEAD 692324a)1 分支并入 dev。
- 失败/遗留: 无。门禁 0 失败(1427 pass / 0 fail / 2 skip),typecheck / docs-check / diff-check 全绿。

## 逐分支明细
| WS | 分支 | merge commit | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-f | fix/baidu-r4 (bf1dd7c) | 4583425 | 1427 pass/0 fail/2 skip;typecheck 过;docs 过;diff 干净 | 无冲突(自动合并) |

- 合并后全量:1429 tests / 1427 pass / 0 fail / 2 skip;`npm run typecheck` 零错误;`make docs-check` passed;`git diff --check` 干净。
- 合并内容核验:baidu-engine.ts 注入链 = 同步 + 微任务 4 轮 + rAF 3 帧快路径 + **定时器兜底**(首 tick 100ms 后 250ms 步进,80 tick ≈ 20s 自终止)——修复主树复验的「重负载下 domElement 迟到 1-10s + rAF 帧回调停摆 → 5 帧窗口耗尽后徽章永久缺失(136 条注入超时警告 + 0 徽章)」根因;新增 `pendingContentInjection` 登记表(先查登记再注入,修掉已摘除 marker 仍被写入的顺序缺陷);超时警告降为 20s 全失败后一次性输出。测试 +3 用例(定时器兜底无 rAF 依赖/rAF 快路径/remove 终止注入链);tech/23 追加 ws-f r4 回填节(42 行)。

## 冲突解决清单
- 无冲突。三个文件(baidu-engine.ts / map-engine-baidu.test.mjs / tech/23-map-engines.md)均自动合并成功。

## 遗留问题
- 主树复验 136 警告场景未 100% 复现(需「缓存数据快 + 渲染慢 + 无状态变化」三条件同时成立),但 rAF 停摆 + domElement 迟到的机制已被真机 8× 节流坐实,定时器兜底为该机制的直接修复,单元测试在无 rAF 环境确定性验证注入成功。若 boss 长会话重负载场景仍异常,建议复测。
- 主工作树其他未跟踪内容(`.address-work/`、其他批次目录)与本次合并零交集,未动。
- `server/next-env.d.ts` 自动生成文件残留(dev/build 路径差异)已按半成品规则 `git checkout --` 清理,不影响任何分支内容。

## 最终 dev 状态
- ws-f r4 merge commit: `4583425`(merge: fix/baidu-r4,parents 692324a + bf1dd7c),已 push origin dev(`692324a..4583425`)。
- worktree `/Users/acccan/dm-wt-br4` 已 remove;分支 `fix/baidu-r4` 已 `git branch -d` 删除。
- 批次目录入库 commit: `chore: 20260822 boss engine-polish-2 轮4入库(ws-f r4 merge-report + 汇报)`。

门禁: ALL_GREEN
结论: MERGED_ALL

---

# 轮5 合并(ws-g fix/baidu-r5,2026-08-22)

## 结果总览
- 成功合并: ws-g(fix/baidu-r5,tip 385155e,3 commits)1 分支并入 dev。
- 失败/遗留: 无。门禁 0 失败(1446 pass / 0 fail / 2 skip),typecheck / docs-check / diff-check 全绿。

## 逐分支明细
| WS | 分支 | merge commit | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-g | fix/baidu-r5 (385155e) | d8f2e8a | 1446 pass/0 fail/2 skip;typecheck 过;docs 过;diff 干净 | 无冲突(自动合并) |

- 合并后全量:1448 tests / 1446 pass / 0 fail / 2 skip;`npm run typecheck` 零错误;`make docs-check` passed;`git diff --check` 干净。
- 合并内容核验:baidu-engine.ts SDK `fixPosition` 反绕把视口外徽章抛到 ±worldSize 的根因 —— 实例遮蔽 `fixPosition: false` + 相机事件定位校准(r5);测试 +5 用例(注入即校准/相机事件重算/remove 注销/destroy 解绑/旧 SDK 静默跳过,85→90);tech/23 追加 ws-g r5 回填节(54 行)。

## 冲突解决清单
- 无冲突。三个文件(baidu-engine.ts / map-engine-baidu.test.mjs / tech/23-map-engines.md)均自动合并成功。

## 遗留问题
- 主工作树其他未跟踪内容(`.address-work/`、其他批次目录)与本次合并零交集,未动。
- merge-instructions.md 已由 boss 更新为轮5 版本(随本轮批次目录入库)。

## 最终 dev 状态
- ws-g r5 merge commit: `d8f2e8a`(merge: fix/baidu-r5,parents 5165904 + 385155e),已 push origin dev(`5165904..d8f2e8a`)。
- worktree `/Users/acccan/dm-wt-br5` 已 remove;分支 `fix/baidu-r5` 已 `git branch -d` 删除。
- 批次目录入库 commit: `chore: 20260822 boss engine-polish-2 轮5入库(ws-g baidu-r5 merge-report + 汇报)`。

门禁: ALL_GREEN
结论: MERGED_ALL

---

# 轮6 合并(ws-h fix/tmap-content-scope,2026-08-22)

## 结果总览
- 成功合并: ws-h(fix/tmap-content-scope,tip d28dfa5,2 commits)1 分支并入 dev。
- 失败/遗留: 无。门禁 0 失败(1460 pass / 0 fail / 2 skip),typecheck / docs-check / diff-check 全绿。

## 逐分支明细
| WS | 分支 | merge commit | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-h | fix/tmap-content-scope (d28dfa5) | 8b92772 | 1460 pass/0 fail/2 skip;typecheck 过;docs 过;diff 干净 | 无冲突(自动合并) |

- 合并后全量:1462 tests / 1460 pass / 0 fail / 2 skip;`npm run typecheck` 零错误;`make docs-check` passed;`git diff --check` 干净。
- 合并内容核验:tencent-engine.ts `createMarker` 分派收窄(content 无 icon → DOM overlay;content+icon / 仅 icon → icon 主机制,content 不写 geometry 避免 HTML/纹理双渲染叠印)+ DOM overlay 定位 API 双路径(`lngLatToContainerPoint` 优先 → `projectToContainer` 兜底,双缺失一次性 warn);测试 73→74(重写 icon 主机制语义 + projectToContainer 兜底 4 用例);tech/23 追加 ws-h 回填节。根因:真实 TMap GL SDK(v1.8.0.2)`lngLatToContainerPoint` 不存在 + DOM overlay 分派过宽双因叠加导致 100 徽章堆叠(0,900)。

## 冲突解决清单
- 无冲突。三个文件(tencent-engine.ts / map-engine-tencent.test.mjs / tech/23-map-engines.md)均自动合并成功。

## 遗留问题
- 主工作树其他未跟踪内容(`.address-work/`、其他批次目录)与本次合并零交集,未动。
- merge-instructions.md 已由 boss 更新为轮6 版本(随本轮批次目录入库)。
- ws-h 遗留(agent 蓝点 DOM overlay 活体端到端验证据链而非真机直测)见 reports/ws-h.md 与 tech/23 回填节。

## 最终 dev 状态
- ws-h merge commit: `8b92772`(merge: fix/tmap-content-scope,parents 245039d + d28dfa5),已 push origin dev(`245039d..8b92772`)。
- worktree `/Users/acccan/dm-wt-tc` 已 remove;分支 `fix/tmap-content-scope` 已 `git branch -d` 删除。
- 批次目录入库 commit: `chore: 20260822 boss engine-polish-2 轮6入库(ws-h tmap-content-scope merge-report + 汇报)`。

门禁: ALL_GREEN
结论: MERGED_ALL
