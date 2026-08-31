# WS-1: 收藏模式列表复用 POICard + 历史点击冲突门控

## 背景
用户指示(2026-08-22):① 收藏图层下(互斥模式)Explore 列表 item 用原先的卡片样式(普通模式 POICard);
② 注意「收藏模式探索功能 vs 历史记录点击历史查询点」的冲突。Explore 已定位两处机制(见 README.md 与下方证据)。

## 任务
在 **/Users/acccan/dm-wt-saved-card** 内完成(worktree 已预建,分支 `fix/saved-layer-card`,基于 dev——已含前批 nofly)。
**不要 merge / 不要 push**,boss 统一合并。**视觉遵循 liquid glass 设计系统(见下布局图),主交互色 #007AFF,绿仅薪资/工时。**

## ① 收藏模式列表复用 POICard

### 布局图(现状 vs 目标——收藏模式 Explore 列表)

```
现状(SavedList 简单行,透明/12px/无玻璃):          目标(POICard 玻璃卡片,与普通模式完全一致):
┌──────────────────────────────────┐             ┌──────────────────────────────────────────┐
│ [◯] 阿里巴巴·杭州滨江          ✕ │             │ [logo] 阿里巴巴                      [🗑] │ ← header 右上:移除收藏 icon 按钮
│     工作 · 滨江区               │             │        工作 · 滨江区 · 11 个岗位         │     (aria-label="取消收藏",hover 高亮)
└──────────────────────────────────┘             │  ⭐ 4.8 · 2.3km   💰 25-40K·14薪        │ ← RecruitmentCardContent 完整字段
                                                  │  [chip] 五险一金  [chip] 双休            │     (domain 为 DomainCardContent)
                                                  └──────────────────────────────────────────┘
```

### 实现要点(boss 裁决,细节由你定,需自证正确)
1. **数据桥接**:收藏模式列表 pois = `savedItems.map(p => resolveSavedPoi(p, savedCatalog) ?? savedPlaceToOverlayPoi(p, savedCatalog))`
   ——活数据优先(compare-saved.ts:83-85),快照兜底(saved-overlay.ts:21-50)。若需微调桥接保证字段完整(如 distance/origin),在 `saved-overlay.ts` 内小改并注明。
2. **渲染**:桌面 secondary-sidebar.tsx:512-523 savedMode 分支改渲染 `POIList`(与 580-601 普通分支相同用法;收藏模式关闭无限滚动/对比表);移动 map-shell.tsx:2763-2777 drawer 同步换 POIList(onPick 保持原 `setMobileSheet("explore")` 语义)。卡片 onClick 沿用 `onPickSaved`。
3. **移除按钮**:`POICard` 新增可选 `onRemove?` prop(不传则完全不渲染,零影响普通模式);位置=header 右上(scaleBadge 同位/并列,视空间);样式=liquid glass icon 按钮(32px 命中区,透明底→hover 变调,#007AFF 或破坏性红调均可,与卡片内既有 icon 风格一致);`aria-label` i18n 化(zh/en 键,如「取消收藏 / Remove」)。
4. **不动**:账户页 SavedList(对比表、非互斥路径)、RecentPanel、普通模式任何渲染。

## ② 历史点击冲突门控(boss 裁决:方案 A,最小面)
- `handlePickRecent`(map-shell.tsx:1934-1966,桌面/移动共用唯一入口)开头加门控:
  `if (savedLayerEnabled) hideSavedOverlay()`(hideSavedOverlay 已存在,map-shell.tsx:1880 登出在用)再走原链路。
- 语义:点历史查询点 = 显式离开收藏视图开始新探索(与 toggle 未登录弹窗门控同模式,use-saved-layer.ts:80-84)。
- 不选 B/C(不加 load effect 依赖、不拆 openDetail)——避免副作用面扩大。

## 契约与记录
- `saved-panel.tsx` 的 SavedList 不再被收藏模式消费(仍被账户页消费,不删组件)。
- tech/16-bug-fixes.md 追加 2026-08-22 节:收藏模式卡片化 + 历史点击门控(症状/根因/方案/验证)。
- 若 component-contracts / hooks-contracts 断言了 savedMode → SavedList 或 handlePickRecent 行为,同步更新为互斥卡片语义 + 门控。
- 新 i18n 键(移除收藏/aria)加到 lib/i18n.ts(zh/en)。

## 文件边界(优先只碰这些;改其他文件需在汇报列理由)
- `server/src/components/poi-card.tsx`(+ module.css:onRemove 按钮样式)
- `server/src/components/poi-list.tsx`(如需要透传 onRemove)
- `server/src/components/secondary-sidebar.tsx`(savedMode 分支)
- `server/src/components/map-shell.tsx`(handlePickRecent 门控 + 移动 drawer + 桥接传参)
- `server/src/lib/saved-overlay.ts`(如桥接微调)
- `server/src/lib/i18n.ts`(新键)
- `server/tests/*`(新增/更新)+ `tech/16-bug-fixes.md`

## 不做
- 不 merge / 不 push;不改账户页 SavedList/RecentPanel/对比表;不改视觉 token 体系;不跑 Env-only 步骤;不 npm install

## 门禁(全部通过才写 OK)
1. `cd /Users/acccan/dm-wt-saved-card/server && npm run typecheck`
2. `cd /Users/acccan/dm-wt-saved-card/server && npm test`(全绿;测试数以实际运行结果为准)
3. `cd /Users/acccan/dm-wt-saved-card && make docs-check`(应为全绿)
4. `git diff --check`
5. **新增回归测试**:
   - POICard `onRemove` 渲染/点击(不传时不渲染)
   - 收藏模式列表数据桥接(resolveSavedPoi 优先/快照兜底)
   - `handlePickRecent` 收藏开启时先关图层再走原链路(jsdom,断言 hideSavedOverlay 调用序)

## 提交
小步 Conventional Commits(`feat` / `fix` / `test` / `docs` / `refactor`);提交前 git status 干净。

## 回报
写 **/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-card/reports/ws-1.md**:
- 改动摘要(每文件 1-2 行)
- 卡片复用路径 + 移除按钮实现(样式/位置/i18n)
- 历史门控实现 + 为何最小面
- 遇到的问题
- 门禁实际输出摘要(测试总数 pass/skip)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
