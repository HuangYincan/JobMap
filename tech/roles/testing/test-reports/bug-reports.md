# Bug Reports

> 测试发现 Bug 的规范记录。每条约 2–5 行现象 + 复现 + 根因 + 修复,按日期倒序。
> 关联文档:`tech/16-bug-fixes.md`、`CHANGELOG.md`。

---

## 2026-08-29 — 视野内 POI 很多时地图卡顿(HTML Marker DOM overlay)

**状态:** 已修复(`amap-engine` LabelsLayer + 控制器少触碰 + `usePOIMap` 不再
`zoomchange` 全量 sync)

### 现象

POI 全量加载后,视野里点一多,平移/缩放明显掉帧。加载逻辑没有少加载;腾讯侧
同样海量点不卡。

### 根因

每个 POI 是高德 `AMap.Marker` + HTML `content`(独立 DOM overlay)。相机变化时
浏览器逐个重排;`zoomchange` 在缩放动画中连续触发全量 `sync()`。腾讯已是
WebGL `MultiMarker`;高德官方对 1000+ 点要求 `LabelMarker` / `MassMarks`。

### 修复

- AMap 有 `icon` 的点改走共享 `LabelsLayer`+`LabelMarker`;catalog 仍全量入池。
- 坐标/可见性未变不触碰 marker;`zoomchange` 不再全量 sync。
- TMap `isAttached` = 仍在 geometry 登记簿,hide ≠ 外部删除。

### 回归

- 引擎/控制器隔离套件 130/130;`npm run typecheck`、`make docs-check`、
  `git diff --check` 通过。
- 浏览器(工作模式 AMap):zoom 9 / zoom 8 均为 `.amap-marker` = 0、
  `.dm-badge` = 0、1 canvas。
- 细则:`tech/16-bug-fixes.md`、`tech/23-map-engines.md`。

## 2026-08-18 — WS-U6:公司 POI 与地图 POI 混合展示(视口批次跨模式污染)

**状态:** 已修复(`fix/poi-mixing`,`batchMatchesCurrentMode` 模式守卫)

### 现象

用户在 Domain(地图)模式下看到工作模式的公司卡片与公司徽章 marker 混入列表与地图,
表现为「公司 POI 与地图 POI 混合展示」,时有时无(「经常」),切换模式、搜索、缩放后出现。

### 复现(Playwright,确定性)

1. 工作模式停留至主加载完成(loadingRef 空闲)。
2. 地图事件(缩放/平移)→ 视口加载器 800ms 防抖 → 工作视口加载在飞。
3. 在飞期间切到 Domain(Playwright 注入 3.5s 响应延迟拉大在飞窗口)。
4. 结果:Domain 模式 radio 与搜索占位符均为地图口径,但列表 156 张公司卡(78×2)、
   地图 78 个公司徽章 badge、0 个地图图钉。

### 根因

`map-shell.tsx` 视口加载器(moveend/zoomend → `createViewportLoader`)的 `onBatch`
缺少模式/信号守卫:主加载的 onBatch 有 `signal.cancelled` + `viewportEpochRef` 守卫
(`cd6f75b`),但视口加载器的工作分支与 Domain 刷新分支直接 `catalogRef.current = batch;
setCatalog(batch); writeModeCache(...)`,不校验当前模式。模式切换时,旧模式在飞的批次
落到新模式的 catalog → marker 与列表被跨模式污染。被污染的 catalog 随后经
`handleModeChange` 的 `writeModeCache({ mode, catalog: catalogRef.current })` 写入
当前模式缓存(sessionStorage),跨会话粘住——这就是「经常」的原因。

排查中排除的嫌疑:
- `pois` 只是 `catalog` 的过滤视图,非第二数据源(排除)。
- `compareCatalog`(INTERNSHIP_SEED 补齐)只进收藏叠加层/详情查找,不直接进 marker;
  仅「已登录 + 已收藏 + 叠加层开启」时按设计显示收藏公司徽章(排除,属特性)。
- 建议选择(Domain 搜索)只建 DomainPOI 卡,不建公司卡(排除)。
- `hz_pois` `big_type='公司企业'` tier 5:杭州内 zoom ≥ 5 浏览时本地库返回公司企业
  类 POI 卡(如「恒彩家装集团(总部旗舰店)」)。**产品口径已确认(2026-08-18 用户)**:
  无岗位信息的公司只作为地图 POI(domain 浏览保留公司企业为地图 POI,不过滤、不升
  级);有岗位信息的公司才作为公司 POI(工作模式,`withAlivePositions` 只保留有活岗
  的公司)。数据核对:30 家工作目录公司(蚂蚁/同花顺/阿里/字节…)在 hz_pois 有同名
  公司企业 POI,domain 语境下是「地点」,按地图 POI 展示;其公司 POI 形态在工作模式。
  两条闸门当前均已满足,无需代码改动。

### 修复(最小改动,数据流守卫层)

- `src/lib/viewport-search.ts` 新增 `batchMatchesCurrentMode(current, batch)`:
  批次写入前校验当前模式未切换(internship→work 同口径;本地 canonical 避免
  modes→spatial-filters→viewport-search 循环导入)。
- `map-shell.tsx` 四处落库点加守卫:主加载 onBatch、主加载最终结果、视口工作
  onBatch、视口 Domain 刷新 onBatch。模式切换后旧模式批次一律丢弃。
- `MODE_CACHE_VERSION` 5→6:让已被污染的会话缓存失效重拉。

### 回归

- `npm test`:278 pass / 0 fail(新增 `batchMatchesCurrentMode` 语义测试 +
  `loadWorkViewport` 信号取消不回调测试)。
- Playwright 重跑原复现序列:切 Domain 后列表 0 公司卡、0 badge、50 个地图图钉,
  全部为 Domain POI。✅
- `npm run typecheck`、`make docs-check`、`git diff --check` 通过。
