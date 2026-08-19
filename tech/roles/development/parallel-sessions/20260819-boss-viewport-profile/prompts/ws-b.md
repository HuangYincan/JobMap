# ws-b — Bug2 登出 reset savedOverlay pref(+ 移动抽屉覆盖说明)

## 背景

用户「切到 profile 界面后地图上所有 poi 消失」。Explore 根因(layout vs data):

1. **主因(视觉遮蔽,非数据)**:移动端头像(`openMobileAccount` map-shell.tsx:1681)→ `setDrawer("full")`(map-shell.tsx:1691),`.mobileDrawer`(map-shell.module.css:1119-1131)全屏 z-index:5 覆盖 `.mapCanvas`(module.css:41-46),POI pin 被全屏抽屉遮住。切回 explore 后 `drawer` 回落、marker 复用,poi 恢复——数据从未清空。**这是抽屉全屏设计,不是 bug**,但可改善:full 抽屉底部留一条地图可见区消歧义。
2. **次因(真实数据风险,值得修)**:登出(`handleAuthAction` map-shell.tsx:1706-1721)只 `setUser(null)` + 清 savedPlaces,**没 reset `savedOverlay` pref**(`readSavedOverlayPref` 保持 true)。若登出前开着收藏图层,登出后 `mapPois = mergeMapPois(pois, overlayPois,...)`(map-shell.tsx:1138-1141)因 user 为 null 失去 overlay 部分 → 收藏 pin 静默消失,而 pref 仍是 true,用户再登录也以为 layer 还开着但不显示。

## 修复(最小改动)

### 数据风险(主任务)
1. `handleAuthAction` 登出分支(map-shell.tsx:1706-1721):登出时 `setSavedOverlay(false)` + `writeSavedOverlayPref(false)`(与清 savedPlaces 并排),防止 overlay pin 静默消失、pref 与实际状态脱钩。
2. 若 `readSavedOverlayPref` 在未登录时本就该 false(检查现有逻辑),确保登出后 overlay 图层状态一致。

### 移动抽屉覆盖(说明/小改善,不改布局语义)
3. 移动端全开抽屉覆盖属设计(`setDrawer("full")` 全屏),**不强制改**;检查 .mobileDrawer 是否已从底部留一条地图露出(参考已有 drawer 的半透/顶部露出设计)。若全屏无任何露出,可加一行底部 padding 或顶部 handle 露出 60px 地图,消「poi 消失」误解——worker 判断,若改动只会破坏移动端布局则跳过并在汇报说明,记 deferred。

## 测试(必做)

- 契约/单元测试:登出路径 `setSavedOverlay(false)` + `writeSavedOverlayPref(false)`(component-contracts.test.mjs 或新用例,断言 handleAuthAction 登出分支调用重置)。typecheck 全绿。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-wsB)

- 只动:`server/src/components/map-shell.tsx`(handleAuthAction + 若做露出则 map-shell.module.css)、`server/tests/*`
- **不碰**:`server/src/hooks/*`(ws-v 区域)、`server/src/components/poi-list.tsx`/`account-panel.tsx`(ws-u)、`server/src/lib/viewport-search.ts`/`mode-cache.ts`(ws-v)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsB/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsB && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-viewport-profile/reports/ws-b.md`:
改动文件 + 根因(Layout vs Data 区分)+ 实现 + 测试 + 遇到问题(移动抽屉是否改)。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。

## 续作附录(boss 2026-08-19,预算超限中断后收尾)

已做(未提交):`server/src/components/map-shell.tsx`(+2)+ `server/tests/component-contracts.test.mjs`(+10)。开工 `git status` + `git diff` 对账,不重做。剩余:
1. **先 commit 未提交改动**(登出 reset savedOverlay 实现 + 契约测试),commit message 按 Bug2 语义。
2. 若发现实现不完整(登出分支 reset overlay pref 缺失)补完再 commit。
3. 完整门禁(npm test + typecheck + docs-check + diff-check)+ 写报告(含移动抽屉覆盖是否改的判断说明)。
4. 预算纪律:先 commit 再验证。
