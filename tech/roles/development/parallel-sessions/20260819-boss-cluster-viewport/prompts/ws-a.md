# ws-a — B3 城市聚合(zoom ≤ 8,用户已批准布局图)

## 背景

用户已批准 tech/21-city-clustering.md 方案,**唯一修改:触发阈值从 zoom ≤ 7 改为 zoom ≤ 8**。
新 UI 符合 liquid glass 设计系统(品牌蓝 #007AFF 描边、白底、复用现有品牌徽章样式)。

问题背景:tier 模型落地后,全国/省级视野(zoom ≤ 8)同城 10–50 家 pin 重叠无法点选。
聚合后:每个城市一个圆形徽章「城市名 N」,点击平滑缩放到该城(zoom 11)展开个体 pin。

## 布局图(已批准,阈值更新)

```
zoom ≤ 8(全国 / 省级视野)               zoom ≥ 9(城市级,自动展开)
┌───────────────────────────┐          ┌───────────────────────────┐
│                           │          │                           │
│         ╭────╮            │          │              ╭───╮        │
│    ╭────┤北京 │────╮       │          │         ╭───┤字节│        │
│    │ 12 │    │ 8  │       │          │    ╭────┤   ├───╮        │
│    ╰────╯    ╰────╯       │          │    │阿里│   │腾讯│        │
│    ╭────╮    ╭────╮       │          │    ├────╯   ╰───╯        │
│    │杭州 │    │深圳 │       │          │    │小米│                │
│    │ 15 │    │ 10 │       │          │    ╰────╯                │
│    ╰────╯    ╰────╯       │          │                          │
│                           │          │                          │
└───────────────────────────┘          └───────────────────────────┘
  聚合徽章:圆形,#007AFF 描边,白底,    点击聚合徽章 →
  「城市名 N」(如「北京 12」)            地图平滑缩放到该城市 zoom 11,
                                        聚合徽章消失,个体 pin 出现
```

## 规则(tech/21,阈值已改)

1. 触发:work 模式,`zoom <= 8` 启用聚合;`zoom > 8` 自动切回个体 pin。
2. 聚合粒度:`site.city`(公司办公点城市);无 city 的 pin 保持个体。
3. 徽章点击 → `setZoomAndCenter(11, 城市中心点)`;城市中心 = 该城所有 pin 坐标均值。
4. 徽章 hover 显示城市 + 数量;点击仅下钻,不弹卡片。
5. 与视口增量加载、选中高亮、LOD 过滤零冲突(聚合是渲染层第二种模式)。

## 任务

1. **`server/src/lib/city-cluster.ts`(新文件)**:纯函数
   `clusterCities(pois: POI[], zoom: number): { city, count, lng, lat }[] | null`
   - `zoom > CLUSTER_MAX_ZOOM(8)` 或非 work 上下文 → 返回 null(调用方用个体 pin)
   - 按 `site.city` 分组计数;无 city 的 POI 不聚合(保持个体,由调用方另行渲染或省略);
     中心点 = 组内 pin 坐标均值(有合法坐标的)
   - 单测:分组/计数/中心点/阈值/无 city 个体
2. **`server/src/lib/map-markers.ts` 扩展**:聚合徽章渲染(新增独立导出函数,
   如 `createCityClusterMarker(amap, map, group, color)` 或复用现有徽章 HTML 构造;
   **不侵入 POIMarkerController 内部实现**)——圆形、#007AFF 描边、白底、「城市 N」、
   复用品牌徽章字体/尺寸 token;hover 增强城市+数量(可简化为徽章本身已含)。
3. **`server/src/components/map-shell.tsx` 接线**:
   - work 模式:zoom 变化时在「聚合徽章模式」与「个体 marker 模式」间切换;
     聚合模式接到现有 catalog(pois 经 pipeline 后,或直接 catalog——按视口替换语义,
     建议用 pipeline 后的 pois 保持一致)
   - 聚合徽章点击 → `setZoomAndCenter(11, group.center)`(个体 marker 模式由
     POIMarkerController 照常管理,两模式互斥切换)
   - **不碰**:视口加载逻辑段(onBatch/noMore/挂载对齐/空批次/缓存)、
     POIMarkerController 的 setPOIs/isReady/destroy 等内部实现
4. **测试**:city-cluster 单测(必做);marker 徽章构造契约(如有现成模式);Playwright 验收
   (可选,dev server :3000,zoom 拉低看聚合徽章出现、点击下钻)
5. **文档**:`tech/21-city-clustering.md` 更新阈值(zoom ≤ 7 → zoom ≤ 8)与实现状态
   (草案 → 已实现,标注日期与 commit 摘要)

## 文件边界(绝对路径,worktree = /Users/acccan/dm-wt-wsA)

- 只动:`server/src/lib/city-cluster.ts`(新)、`server/src/lib/map-markers.ts`(仅新增导出,
  不动 controller 内部)、`server/src/components/map-shell.tsx`(仅聚合接线段)、
  `server/tests/city-cluster.test.mjs`(新)或现有测试文件、`tech/21-city-clustering.md`
- **不碰**:`server/src/lib/viewport-search.ts`、map-shell 视口加载段
  (onBatch/noMore/对齐/空批次/mode-cache)、`server/src/lib/mode-cache.ts`、
  `server/src/hooks/use-poi-map.ts`(ws-b 区域,另一任务在修 controller 生命周期)、
  `server/src/components/account-panel.tsx`

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsA/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsA && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-cluster-viewport/reports/ws-a.md`:
改动文件 + 聚合实现简述 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
## 续作附录(boss 2026-08-19,预算超限中断后重派)

已提交:`bb90235`(city-cluster.ts 纯函数)+ `b479118`(map-markers 聚合徽章)。
未提交改动(继续在其上做,勿丢弃):`map-shell.tsx`(接线中)、`tech/21-city-clustering.md`、
`server/tests/city-cluster.test.mjs`(新)。

开工先 `git log --oneline -3` + `git status` 确认现状,不重做。剩余任务:
1. **先 commit 未提交改动**(拆成合理 commit:接线 / 测试 / 文档)
2. 补齐 map-shell 接线(zoom ≤ 8 聚合 ↔ > 8 个体切换、徽章点击 setZoomAndCenter(11, 城市中心);
   若接线已完成则直接验证)
3. city-cluster 单测跑通 + 门禁全绿(npm test / typecheck / docs-check / diff-check)
4. 写报告(改动文件 + 实现简述 + 测试 + 遇到的问题;末两行 token 照常)
5. 预算纪律:先 commit 再验证,避免再次中断丢成果
