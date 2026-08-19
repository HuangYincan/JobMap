# Manifest — 20260819-boss-viewport-profile

## 目标

用户请求(2026-08-19):
- **BUG 1**: 首次点击 poi 还是会回到用户所在位置(复测)
- **BUG 2**: 未知 bug——切到 profile 界面后地图上所有 poi 消失
- **F1**: 工作 poi 随视角全量持续增量加载,不设结果数上限,展示视角内所有工作 poi;zoom 变小又变大时已加载 poi 不删,只换侧控栏二级卡片列表,地图 poi 保持全量
- **F2**: 地图 poi 用户没选类别时,在原 poi 卡片位置给一个候选类别列表
- **F3**: profile「偏好」改成下拉框选择,与「求职偏好」逻辑一致

## 根因(Explore 已确认,dev 9b5f94a)

| 项 | 根因 | file:line |
|---|---|---|
| Bug1 | hasInteractedRef(上批已修)完好,但**卡片/列表 onSelect 路径不置位**——首次交互若点卡片(桌面 2108→handleSelect 1404、移动 2632/2639)而非地图 pin,ref 仍 false → geolocation 晚 resolve 仍 setCenter(userLocation) 拽走相机 | map-shell.tsx:181/510/1381/1404/2108/2639 |
| Bug2 | 主因=移动端全开抽屉(`drawer("full")`,`.mobileDrawer` z-index:5 全屏)覆盖 `.mapCanvas`,视觉遮蔽非数据清空;次因=登出(`handleAuthAction`)清 savedPlaces 但没 reset savedOverlay pref → overlay pin 静默消失 | map-shell.tsx:1691, handleAuthAction 1706;module.css:1119-1131/41-46 |
| F1 | work 视口加载是**替换式**(use-work-viewport `existing:[]` + 整池替换,每轮 ≤50)+ POI_HARD_CAP 3000 + WORK_INITIAL_MAX_PAGES 4 | use-work-viewport.ts:181/197-198, viewport-search.ts:52-56/294/575-589, map-shell.tsx:832-843 |
| F2 | work 模式无类别门控(只有 domain 有);filter-options = getMode().filters 静态透出,客户端未 fetch(可直接用 getMode) | map-shell.tsx:850-854, poi-list.tsx:138-159, modes.ts:99-138 |
| F3 | 「偏好」两行(language/defaultMode)是 pill 切换,**非下拉**;「求职偏好」已是 PrefField/PrefMenu 下拉(可复用) | account-panel.tsx:542-576(vs 343-374/386-432) |

## workstreams

| ws | 分支 | 主题 | 文件 | 状态 |
|---|---|---|---|---|
| ws-a | fix/first-select-locate | Bug1 卡片选中也置 hasInteractedRef(补全竞态盲区) | map-shell.tsx、component-contracts.test.mjs | PENDING |
| ws-b | fix/profile-overlay | Bug2 登出 reset savedOverlay pref + (文档/说明)移动抽屉覆盖 | map-shell.tsx(handleAuthAction)、tests | PENDING |
| ws-v | feat/viewport-full | F1 视口增量加载不删 + 列表/地图池分离 + 去上限 | use-work-viewport.ts、viewport-search.ts、map-shell.tsx、mode-cache 语义、tests | PENDING |
| ws-u | feat/category-prefs | F2 候选类别列表(work 未选态)+ F3 Profile 偏好下拉 | poi-list.tsx、secondary-sidebar.tsx、filter-panel/chips、account-panel.tsx、tests | PENDING |

## 合并顺序

ws-a → ws-b → ws-v → ws-u(文件互不冲突:map-shell 各段 / hook+viewport / UI 各组件;合并按完成序)

## 门禁基线(2026-08-19 boss 实测 dev @ 9b5f94a)

- `cd server && npm test` → 447 tests / 445 pass / 2 skip
- `npm run typecheck`、`make docs-check`、`git diff --check`

## 后续里程碑

- MERGE → VERIFY 浏览器复验(Bug1 卡片首点不拽回、Bug2 登出 overlay 保留、F1 zoom 往返 poi 不丢、F2 类别候选列表、F3 偏好下拉)
- 终态总汇报(含 deferred)

## 最终结果(2026-08-19)

- **ws-a/b/v/u 全部合并**:dev @ 028bb25(454/452),4 merge commits,已 push;ws-u followup(domain 候选类别)@ e1ace57(455/453),已 push。
- **浏览器 VERIFY 完成**:
  - F1 zoom 往返:3 → 11(zoom out ×2)→ 6 → 3(zoom in),列表随视角换,每视角独立 fetch(maxTier 正确);marker 池只增不减(契约覆盖)。
  - F2 domain 候选类别:未选类 → 「选择类别开始浏览」+ 9 类 chips(餐饮/购物/景点/…),点击 → 加载 1000 结果;work 候选同样生效;桌面+移动各一份(移动 hidden 非重复)。
  - F3 偏好下拉:语言/默认地图 → PrefField 触发钮 + 玻璃 listbox(中文 ✓ / English),选择即存。
  - Bug1/Bug2:契约测试覆盖(卡片选中置位 9 处 flyTo、登出 reset savedOverlay);浏览器无新 console error(favicon.im 404 为既有 deferred)。
- **deferred**:移动抽屉覆盖(ws-b 判定设计保留)、docs #20/#23(上批)。
- **测试基线**:455 tests / 453 pass / 2 skip。
