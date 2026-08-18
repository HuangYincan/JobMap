# Bug Reports

> 测试发现 Bug 的规范记录。每条约 2–5 行现象 + 复现 + 根因 + 修复,按日期倒序。
> 关联文档:`tech/16-bug-fixes.md`、`CHANGELOG.md`。

---

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
  类 POI 卡(如「恒彩家装集团(总部旗舰店)」)——这是 tech/22 的有意 tier 映射
  (购物/公司企业 = 5),非本 bug;是否调整属产品口径,待用户确认。

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
