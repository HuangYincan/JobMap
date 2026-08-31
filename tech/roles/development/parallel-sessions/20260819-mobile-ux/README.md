# 20260819-mobile-ux — 移动端 UX 优化批次

> **创建**:2026-08-19(boss-agent,`/boss-agent`)
> **背景**:用户在移动端验收后提出 2 类交互问题 + 3 项 UI 优化。boss 已用 3 个并行
> Explore 定位代码;用户已给出明确规格(视为已批)。

## 目标

- **交互 1**:移动端二级卡片——进详情再返回后滚动位置不重置(已选卡片仍为第一张可见);
  已选(蓝色)卡片时,点卡片区域边缘(margin/空隙)取消选中。
- **UI 1**:移动端抽屉全开高度拔高到指南针中心高度;全开状态下隐藏指南针与比例尺。
- **UI 2**:移动端在指南针下方新增「显示用户当前位置」按钮(与指南针同尺寸)。
- **UI 3**:工作模式搜索占位「搜索公司或岗位」,地图模式「搜索地点或地址」;默认工作模式。

## 用户已定口径 / Explore 结论

- **占位文案已是 mode-aware**(`ModeConfig.searchPlaceholder`,`modes.ts`),所有输入框
  (map-shell.tsx:1878/2237、secondary-sidebar.tsx:268)已读它 → 只改字符串。
- **默认模式已是 work**:`map-shell.tsx:190` `useState('work')` + `account.ts:120`
  `DEFAULT_PREFERENCES.defaultMode:'work'` → UI3 的默认模式部分**无需改码,只验证**。
- 指南针中心(移动端)= `max(12px, env(safe-area-inset-top)) + 20px`(40×40 按钮)。
- `.drawerFull` 现为 `86svh`(顶边 14svh);`DRAWER_FULL_RATIO=0.86`(map-constants.ts:74);
  拖拽全开阈值 `h >= vh*0.86`(map-shell.tsx:1765-1767)。
- 比例尺是命令式 `AMap.Scale`(map-shell.tsx:587-594,移动端 LT/[12,22])→ 隐藏需 effect
  调 `show()/hide()`。
- 现有定位按钮仅桌面(`.mapControls`,map-shell.module.css:1073-1076 移动端 `display:none`);
  handler `handleLocate`(1577-1599)+ icon `locate`(147)+ i18n `locateMe` 可直接复用。
- 滚动重置根因:`detailPoi` 三元组(map-shell.tsx:2178-2212)卸载 `.drawerContent`+`POIList`,
  返回时重挂载 scrollTop=0;无 ref/保存。选中态(selectedId)返回后保留。
- 取消选中:`.cardSlot`(poi-list.tsx:150)无 handler;卡片 `<article>` onClick
  (poi-card.tsx:166);桌面已有「点地图取消选中」(map-shell.tsx:647-652),移动端抽屉盖住
  地图故罕见 → 取消选中交互仅移动端。

## Workstream 表

| WS | 分支 | 主题 | prompt | 汇报 | 拥有 | 不碰 |
|---|---|---|---|---|---|---|
| w1 | fix/mobile-drawer-chrome | UI1+UI2 抽屉全开高度+隐藏指南针/比例尺+移动端定位按钮 | prompts/w1.md | reports/w1.md | map-shell.tsx(topTools/compass/drawer 类/scale 显隐/locate)、map-shell.module.css(相应类)、map-constants.ts(如需) | poi-list/poi-card(w2)、modes.ts(w3)、account-panel/filter/search、db/ |
| w2 | fix/mobile-card-interactions | 交互1+2 返回滚动保留+边缘点选取消 | prompts/w2.md | reports/w2.md | poi-list.tsx、poi-card.tsx、map-shell.tsx(detail 开/返回 handler、drawerContent ref、POIList 移动端 props) | topTools/compass/scale/locate/抽屉高度(w1)、modes.ts(w3)、account-panel/filter/search、db/ |
| w3 | chore/search-placeholder | UI3 搜索占位文案(默认模式已 work,仅验证) | prompts/w3.md | reports/w3.md | modes.ts(searchPlaceholder) | 其余全部 |

## 合并顺序(收尾 Agent 按此逐个 merge,红则停)

1. **w3**(modes.ts,独立,先行清场) → 2. **w1**(抽屉 chrome) → 3. **w2**(卡片交互)
- w1/w2 都动 map-shell.tsx 但**不同段**(w1:2122-2144 + topTools/抽屉类;w2:2159-2212 +
  2319 + 2512-2522 + poi-list/poi-card),冲突按各 prompt「不碰」为据解决。

## 角色分配

- 每个开发会话:headless `boss-worker` 读对应 `prompts/<ws>.md`(worktree 已预建、boss 统一
  合并,不要 merge/push),完成后写 `reports/<ws>.md`(末两行 token)。
- 全部完成后:headless `boss-merger` 按上表顺序合并回 dev、跑门禁、绿则 push origin/dev。

## 合并执行提示(boss 追加)

- 主树 `git status --short` 中的 `?? tech/roles/development/parallel-sessions/*` 与
  `?? tech/roles/development/quality-scans/*` 是**会话工件目录,未跟踪、不阻塞合并**,勿触碰。
- **已知冲突点**:`CHANGELOG.md` 与 `tech/16-bug-fixes.md` 被 w1 与 w2 都追加(w1:+8/+18、
  w2:+7/+63)——按「保留两者条目」合并,不互相覆盖。`map-shell.tsx` 两分支动不同段
  (w1:topTools/scale/抽屉高度;w2:detail 三元组/drawerContent/POIList props),按「不碰」为据。
- w1 的 scale 显隐与 topTools 隐藏已限定 ≤767px(桌面不生效),合并后请保持。
