# 20260819-regression-fix — 合并回归修复批次

> **创建**:2026-08-19(主 Agent)
> **背景**:2026-08-19 七分支全量并入 dev(HEAD 7c027e7)后,用户验收发现 6 个 bug。
> 主 Agent 已用 3 个并行 Explore 定位根因;用户已确认口径。

## 目标

修复 7 个 bug:侧控栏 logo 垂直居中 / 邮箱溢出 / Profile 身份卡塌陷 /
求职偏好改下拉 / 工作模式无「没有更多结果」/ 工作模式混入无岗位收藏 pin /
**工作模式 poi 列表不随视角刷新**。

## 用户已定口径

- **Bug 6(修正)**:收藏功能**按主地图和工作地图区分**——work 模式只显示 `place.mode ∈
  {work, internship}` 的收藏(带岗位公司),domain 模式只显示 `place.mode === 'domain'`
  的地点收藏;另加列表层 kind:'recruitment' 守卫 + mode-cache kind 校验。
- **Bug 5**:工作模式到底**复用「── 没有更多结果 ──」**文案,不新增文案,只补 work
  noMore 判定。

## Workstream 表

| WS | 分支 | 主题 | prompt | 汇报 | 不碰 |
|---|---|---|---|---|---|
| w1 | fix/sidebar-chrome-regress | Bug1+2 侧控栏 logo 居中 + 邮箱溢出 | prompts/w1.md | reports/w1.md | account-panel/工作加载/saved-overlay |
| w2 | fix/profile-identity | Bug3+4 Profile 身份卡高度 + 求职偏好下拉 | prompts/w2.md | reports/w2.md | map-shell 侧控栏/工作加载 |
| w3 | fix/work-nomore | Bug5 工作模式「没有更多结果」 | prompts/w3.md | reports/w3.md | account-panel/saved-overlay/侧控栏 |
| w4 | fix/work-domain-leak | Bug6 收藏按模式区分 + kind 守卫 | prompts/w4.md | reports/w4.md | account-panel/侧控栏布局 |
| w5 | fix/viewport-refresh | Bug7 工作模式视口刷新(替换语义) | prompts/w5.md | reports/w5.md | account-panel/mode-cache 改动 |

## 合并顺序(收尾 Agent 按此逐个 merge,红则停)

1. **w1**(纯 CSS,独立) → 2. **w2**(account-panel,独立) → 3. **w3**(工作加载判定) →
   4. **w5**(视口替换,依赖 w3 的 noMore 语义对接) → 5. **w4**(marker/cache 层)
- w3/w5 都动 viewport-search.ts 的 loadWorkViewport(不同方面:noMore 上报 vs 替换语义),
  w3 先行、w5 在其上对接;w4 动 mode-cache.ts。冲突集中在 map-shell.tsx /
  viewport-search.ts,按各 prompt「不碰」为据解决。
- 遗留 worktree `domain-map-wt-hz-poi-local`(批前已有,分支 cd6f75b 已入 dev)
  可在收尾时安全 `git worktree remove`。

## 角色分配

- 每个开发会话:触发 `workstream-agent` skill,读对应 `prompts/<ws>.md`,完成后写
  `reports/<ws>.md`。
- 全部完成后:收尾会话触发 `merge-agent` skill,读本 manifest + 各汇报,执行合并。

## 合并执行提示(boss 追加)

- 主树 `git status --short` 中的 `?? tech/roles/development/parallel-sessions/*` 与
  `?? tech/roles/development/quality-scans/*` 是**会话工件目录,未跟踪、不阻塞合并**,
  合并/提交时勿触碰、勿视为脏树。
- 集成要点:`loadWorkViewport` 在 w3(返回 `{ pois, noMore }`)+ w4(existing kind 守卫)
  都改动,`viewport-search.test.mjs` 在 w3/w4/w5 三处追加断言——冲突按「不碰」为据、
  保留三者语义合并;w5 的 noMore 复位对接 w3 的 noMore 状态。合并每个分支后跑完整门禁。

## 参考(根因定位,来自主 Agent 探索)

| # | Bug | 根因 | 位置 |
|---|---|---|---|
| 1 | 侧控栏 logo 不垂直居中 | `.menuWrap` 非 flex 容器,品牌行 top 对齐(差 ~9px) | map-shell.module.css:191-196 |
| 2 | 邮箱溢出 | `.profileCopy` 无 overflow/text-overflow,215px 下预算 ~102px | map-shell.module.css:669-684 |
| 3 | Profile 身份卡塌陷 | `.card` 带 overflow:hidden 成为 flex 项 → 自动最小高度坍缩 | account-panel.module.css:224-231 |
| 4 | 求职偏好→下拉 | 现 100% pill 按钮;需下拉(布局已批) | account-panel.tsx:311-376 |
| 5 | 工作到底还刷新 | noMore/atCap 全 domain-gated;work 永不知已加载全部 | map-shell.tsx:799-802/1965-1966/2488-2489, viewport-search.ts:388 |
| 6 | 工作混入收藏 pin | saved-overlay 把 kind:'domain' 收藏注入所有模式;mode-cache 不校验 kind | saved-overlay.ts:12-26, map-shell.tsx:1109-1112, mode-cache.ts:49-53 |
| 7 | 工作 poi 列表不随视角刷新 | work 视口刷新是 merge 非 replace,79 家公司全捕获后去重无变化;在飞主加载吞掉视口刷新 | map-shell.tsx:859-891(domain 正确 894-935), :840 |
