# WS-1: 收藏图层互斥语义(开=只留收藏,关=恢复)

## 背景
用户反馈收藏图层开关「没区别」;Explore 判定现状为叠加语义且实现正常(收藏 pin 按 id 去重并集、同样式,
典型场景 pin 级零差异)。**用户当面决策:地图+列表都切的互斥语义**。这是数据流语义变更,非 UI 设计变更
(视觉样式/布局/交互细节一律不动)。

## 任务
在 **/Users/acccan/dm-wt-saved-mutex** 内完成(worktree 已预建,分支 `fix/saved-layer-mutex`,基于 dev)。
**不要 merge / 不要 push**,boss 统一合并。

## 目标语义(用户决策,硬性)
- **开**(savedOverlay=true):地图**只**显示收藏点 pin(普通 POI pin 全部隐藏/排除)+ Explore 列表切换为收藏列表
- **关**(savedOverlay=false):恢复 toggle 前的正常模式——搜索管线 catalog pin 显示 + Explore 列表恢复搜索管线
- 未登录:保持现有门控(toggle 弹登录窗,use-saved-layer.ts:78-81)
- 已登录无收藏:允许开(互斥语义下=空地图+列表空态);有收藏时保留现有相机 fit 收藏外接框
- 搜索词/视口联动:互斥开启期间 pipeline 刷新结果不应显示(被互斥);关闭后恢复显示,不额外重查(复用 6bf2092 的「空批次不置空 catalog」保证,marker 池只增不删)

## 现状证据(Explore,2026-08-22,详见 README.md)
- toggle `use-saved-layer.ts:77-109`;overlayPois `:67-70`;markerPois 并集 `map-shell.tsx:1273-1308`(domain/work 两分支)
- 去重合并 `saved-overlay.ts:67-75`(头注释 4-6 声明「搜索列表仍只走 catalog 管线」——**需更新此契约**)
- 可见性 `map-shell.tsx:1377-1390`;savedPlates `map-shell.tsx:307`,refreshSaved `:414-422`(fetch /api/me/saved)
- 列表/详情/Explore 组件树自行定位(catalog → 列表的数据流;收藏列表用 savedPlaces state)

## 实现方向(boss 裁决,实现细节由你定,需自证正确)
1. **地图互斥**:markerPois 在 savedOverlay 开时 = 收藏点(overlay),不做 catalog 并集;关时恢复原 pipeline。
   优先考虑用「可见性/排除」实现而非清空 catalog——保证关时秒恢复、不触发重查。
2. **列表互斥**:Explore 列表在开时显示收藏列表(收藏点数据),关时恢复搜索管线列表。
   列表项点击/详情行为保持与收藏点一致(收藏点本身可点开详情——沿用现有 saved pin 点击行为)。
3. **契约更新**:saved-overlay.ts 头注释、「Explore list stays the pipeline」相关 tech/ 文档与
   component-contracts / hooks-contracts 断言如有描述叠加语义,同步更新为互斥语义(仅追加/修正,不改历史记录)。
4. 视觉样式一律不动。

## 文件边界(优先只碰这些;改其他文件需在汇报列理由)
- `server/src/hooks/use-saved-layer.ts`
- `server/src/components/map-shell.tsx`(markerPois / 列表数据流相关段落)
- `server/src/components/map/saved-overlay.ts`(合并策略+契约注释)
- Explore 列表组件(定位后最小改动)
- 对应单测文件(新增回归测试)+ tech/ 契约文档(如命中)

## 不做
- 不 merge / 不 push;不改视觉样式/布局/交互细节;不跑 Env-only 步骤;不 npm install

## 门禁(全部通过才写 OK)
1. `cd /Users/acccan/dm-wt-saved-mutex/server && npm run typecheck`
2. `cd /Users/acccan/dm-wt-saved-mutex/server && npm test`(全绿;测试数以实际运行结果为准)
3. `cd /Users/acccan/dm-wt-saved-mutex && make docs-check`(本批修复后应为全绿)
4. `git diff --check`
5. **新增回归测试**:覆盖「savedOverlay 开 → 地图只含收藏点 + 列表为收藏;关 → 恢复 catalog 管线」的合并/派生逻辑(jsdom 可测层)

## 提交
小步 Conventional Commits(`fix: ...` / `test: ...` / `docs: ...`);提交前 git status 干净。

## 回报
写 **/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-mutex/reports/ws-1.md**:
- 改动摘要(每文件 1-2 行)
- 地图互斥实现方式 + 关时恢复机制(为何不触发重查)
- 列表互斥实现方式(组件 + 数据流)
- 契约文档更新清单
- 遇到的问题
- 门禁实际输出摘要(测试总数 pass/skip)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
