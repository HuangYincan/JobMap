# Bug Fixes Log

记录所有重要的bug修复，包括问题描述、根本原因、解决方案和相关文件。

## 2026-08-22: 首访卡死加载界面——三条无界/无出口链修复(loading-hang)

**症状**：首次进入网站必定卡死在 "Loading map..." 覆盖层,刷新(或重开)即好。
用户报告后 Explore 定位三根因三修复(批次 `20260822-boss-loading-hang`,
merge `f5c3d17` ws-1 / `6c780dc` ws-2 / `8e05d2d` ws-3 / `5165904` ws-4)。

**根因**(三条无界/无出口链):

1. **C1(loadAMap 无超时)**：`loadAMap()` 是全链路唯一无超时 await——主脚本
   中途卡死(DNS/TLS/CDN)时 Promise 永不落定,`mapReady` 恒 false,覆盖层永转。
2. **C2(挂载失败无出口)**：引擎挂载(含回退)失败仅 `console.warn`,无任何
   错误出口/重试入口——失败一次首屏即永久 Loading。
3. **C2'(首访全量加载逐页无界)**：首访 work 全量加载逐页 fetch 无超时,
   任一页挂起(服务端冷启动/公网抖动)拖死整个首屏;刷新走
   `useModeCacheRestore` 短路不重拉,故「刷新即好」——对称问题另一面。

**修复**：

- **C1**(`fix/amap-load-timeout`,amap-api.ts):
  - `AMAP_LOAD_TIMEOUT_MS = 8_000`(:45)——主脚本(含插件)加载上界;
  - 超时(:104-107)→ 清 `loadPromise` + `document.getElementById(SCRIPT_ID)?.remove()`
    移除标签 + `reject`(`code: 'AMAP_LOAD_TIMEOUT'`);onerror 同语义(:125);
    移除标签是关键——否则下次 loadAMap 走「复用 existing」分支(:113-118)给已死
    标签挂监听,Promise 永不落定;
  - `settled` 竞态守卫(:82-100):超时/error 后迟到的 onload/onerror 一律无效
    (不二次 settle,不依赖「remove 后浏览器不再触发」)。
- **C2**(`fix/mount-retry`,use-map-engine.ts + lib/map-engine/mount.ts):
  - 挂载链提取 `runMount`(use-map-engine.ts:337,首挂载 effect 与 retryMount
    共用,不复制第二份挂载链);
  - 失败(含引擎回退全败)置 `mountError`——`MapMountError { engine, code?, message }`
    (:85-92);engine = 失败引擎 id,mount.ts 在最终错误上携带 `engineId`(mount.ts:96-101);
  - `retryMount()`(:438-441):重新执行完整挂载链,挂载进行中/已有活 view 时
    no-op(幂等),成功后走与首挂载相同的 .then 落地;
  - 25s watchdog `MOUNT_TIMEOUT_MS = 25_000`(:167):整条链 withTimeout 上界,
    超时以 `code: 'MOUNT_TIMEOUT'` 进入错误态并作废在飞挂载链(代际
    `mountSeqRef` 递增,mount.ts 经 isCancelled 销毁已建视图,不泄漏)。
- **C3**(`fix/loading-error-ui`,map-shell.tsx):覆盖层三态(:2290-2311)——加载中
  (现状零改动)/ 失败态(`mountError` 非空:标题 `mapLoadFailed` + 重试按钮
  `mapLoadRetry`/`mapLoadRetrying` i18n zh+en(i18n.ts:202-213),点击走
  `handleMountRetry` → `retryMount`(map-shell.tsx:327-333),错误小字
  `code · message`(无 code 或无 message 时单边显示))/ 配置缺失(现状)。
- **C2'**(`fix/first-load-bounded`,viewport-search.ts):
  - 首访全量加载 `WORK_FULL_LOAD_MAX_PAGES=10_000`(:292)逐页
    `withTimeout`(:436,`WORK_VIEWPORT_PAGE_TIMEOUT_MS=10_000` :299)——任一页挂起
    按该页失败跳过,绝不永久 await;
  - 失败页跳过继续(不置 noMore/vacant),连续失败
    `WORK_VIEWPORT_MAX_CONSECUTIVE_FAILURES=3` 页(:301-304,:484-504)止损返回
    已取部分(服务端故障时防日志洪泛 + 空转);缺口由 mapReady 后视口加载
    增量语义自然补齐。

**修改文件**：`server/src/lib/amap-api.ts`、`server/src/hooks/use-map-engine.ts`、
`server/src/lib/map-engine/mount.ts`、`server/src/components/map-shell.tsx`、
`server/src/lib/viewport-search.ts`、`server/src/lib/i18n.ts`、测试
(`amap-api.test.mjs` +3 / `map-engine-mount.test.mjs` +7 / `component-contracts
.test.mjs` +1 / `viewport-search.test.mjs` +3)、`tech/23-map-engines.md`(契约回填,见该文档)。

**验证**：合并后全量 1443 tests / **1441 pass / 2 skip / 0 fail**(merge-report);
typecheck / docs-check / git diff --check 绿。历史文字保留(仅追加)。

---

## 2026-08-22: 筛选「莫名勾选独角兽」(缓存残留 + 切模式闭包 stale filters)

**症状**：用户报告筛选面板莫名勾选上「独角兽」(work 模式公司规模筛选
scale=unicorn)。Explore 定位两处根因(2026-08-22),详见批次 README
(`parallel-sessions/20260822-boss-filter-unicorn/`)。

**根因**：
1. **主因(缓存残留,F5 复现)**:`map-shell` 主加载 effect 刻意不依赖 filters
   (minRating/price 不重搜),`writeModeCache` 只在 load() 内写,写的是 **load
   启动时刻的闭包 filters 快照**。某次 load 时 filters 含 unicorn(如点
   `#独角兽` 建议,query 清空触发 load)→ 连同过滤后 catalog 写进缓存;用户
   随后面板取消勾选 → setFilters 无重载 → **缓存仍残留 scale:['unicorn']**;
   F5/重开 → `useModeCacheRestore` 全量还原 → 独角兽「莫名」勾选。切模式方向
   自愈(handleModeChange 会把当前正确 filters 写回),所以只有刷新路径坏。
2. **次因(切模式闭包 stale filters)**:`handlePickRecent` →
   `openExploreSearch(replay.query)`,同栈内先 `handleModeChange(replay.mode)`
   ——state 更新异步,openExploreSearch 闭包 deps `[query, filters]` 拿的还是
   **切换前旧模式**的 filters 做标签 merge → 旧模式筛选(如 work 的
   scale:['unicorn'])被带进新模式。

**方案**(`fix/filter-unicorn`,纯逻辑修复,零 UI 改动)：
1. **主因根治(双保险)**:
   - 写缓存时刻的最新状态:load 内两处 `writeModeCache`(onBatch + 最终)的
     `filters`/`sort` 改用 `viewStateRef.current.*`(与 `use-work-viewport.ts:206`
     同款 viewStateRef 模式),不再用闭包快照——加载在飞期间用户改筛选也不会
     写入过期值;
   - **非 category 筛选变更同步重写缓存**:新增 effect(deps `[filters]`)调
     `syncModeCache`(mode-cache.ts 新导出)——每次 filters 变更以「最新 filters
     + 当前池」重写缓存,viewport(地图未就绪)为 null 时跳过(不覆盖现有快照,
     保护挂载对齐判定)。**取消勾选独角兽 → F5/重开 → 不复活**。不依赖 mode:
     避免 profile defaultMode 的 setMode 直改路径把旧模式状态写进新模式缓存。
2. **次因根治**:`handleModeChange` 两分支(缓存还原/清空)在 setState 同时**立即
   同步 `viewStateRef.current` 为目标模式将生效的状态**;`openExploreSearch`
   改以 `viewStateRef.current` 为 merge 基准(deps `[query, filters]` → `[]`,
   经新纯函数 `planExploreSearch`),同栈调用读到的是切换后模式的 filters。
   点历史 `#独角兽` 的应用语义保持(applyTagSuggestion 不 strip)。
3. 排查确认:2026-08-22 收藏批次(互斥/门控)不触碰 filters 链路,非回归;
   默认值/pickCategoryFilter/候选 chips 均不含 scale;历史记录不存 filters
   (guest-search-history.ts:65-71 仅 query/mode/entity)。

**新增回归测试**(`tests/filter-unicorn-regression.test.mjs`,12 项,jsdom 可测层:
本仓库无 jsdom 运行时,沿用「源码契约 + 语义镜像」模式):
- 主因:load 写入 unicorn → 取消勾选 syncModeCache → 缓存/还原不含 unicorn;
  连续取消始终跟随最新 filters;viewport 为 null 跳过不覆盖;在飞改筛选不写旧值;
- 次因:切新模式后点历史 `#独角兽` → 只应用独角兽(旧模式 industry 等不泄漏)、
  合并进新模式已有筛选、纯关键词不碰 filters、同模式语义保持;
- 契约:load 写缓存两处用 `viewStateRef.current.filters`、syncModeCache effect
  deps `[filters]`、openExploreSearch 以 viewStateRef 为基准、handleModeChange
  两分支同步 ref、handlePickRecent 先切模式再回放。

**修改文件**：`server/src/lib/mode-cache.ts`(+`syncModeCache`)、
`server/src/lib/search.ts`(+`planExploreSearch`)、
`server/src/components/map-shell.tsx`(load 写缓存两处 + sync 新 effect +
handleModeChange ref 同步 + openExploreSearch 基准切换)、
`server/tests/filter-unicorn-regression.test.mjs`(新)、`tech/16-bug-fixes.md`(本节)。

**验证**:1269 测试(1267 pass / 2 skip,含新回归 12 项);typecheck / docs-check /
git diff --check 绿。历史文字保留(仅追加)。

---

## 2026-08-22: 收藏图层互斥语义(开 = 只留收藏;关 = 恢复)

**症状**：用户反馈收藏图层开关「没区别」。判定为**叠加语义**且实现正常(收藏 pin 按 id
去重并入结果集、同样式,典型场景开关 pin 级零差异)——「开 = 只显示收藏点」从未被实现。

**决策**：用户当面拍板:**地图 + 列表都切**的互斥语义(数据流语义变更,非 UI 设计变更;
视觉样式/布局/交互细节一律不动)。

**目标语义**：
- 开(savedOverlay && user):地图**只**显示收藏点 pin(普通 POI 全部隐藏/排除)+
  Explore 列表(桌面侧控栏 / 移动抽屉)切为收藏列表(「我的收藏」视图);
- 关:恢复 toggle 前的正常模式——搜索管线 catalog pin + Explore 列表恢复搜索管线;
- 未登录:保持现有门控(toggle 弹登录窗);已登录无收藏:允许开(空地图 + 列表空态);
  有收藏时保留现有相机 fit 收藏外接框;
- 搜索词/视口联动:互斥开启期间 pipeline 刷新结果不显示(被互斥);关闭后恢复显示,
  **不额外重查**。

**实现**(`fix/saved-layer-mutex`,池/可见性分工):
1. **marker 池只增不删**：`mergeMapPois` 退化为池构建——catalog 结果全量保留
   (复用 6bf2092「空批次不置空 catalog」保证),开时把 catalog 未命中的收藏点快照
   补入池;关时池回到 catalog 本体。catalog marker 实例全程保留。
2. **互斥在可见性层落地**：新增 `mutexVisibleIds(pool, overlayIds, enabled)`——
   开时 visible 只含收藏点 id(普通 POI 全部排除,`setVisiblePOIs` show/hide 切换,
   实例不销毁),关时返回 null 走正常 LOD/聚合可见性。关时秒恢复、零重查。
3. **聚合(work zoom ≤ 8)互斥**：`clusterState` 在互斥开时按 `overlayPois` 聚合
   (徽章计数/个体 pin 不混入普通 catalog 公司)。
4. **列表互斥**：桌面 `SecondarySidebar` 新增 `savedMode` 接线,开时列表区渲染
   `SavedList`(收藏列表;行点击沿用 `handlePickSaved` 打开详情,行移除走
   `handleRemoveSaved`);移动抽屉 Explore sheet 同口径切 `SavedList`。
5. **契约同步**：`saved-overlay.ts` 头注释 / `mergeMapPois` 注释由叠加语义改为
   互斥语义;`tech/11-phase2-plan.md` Phase 4 起步段追加修订注;component-contracts
   互斥断言 + 新增 `saved-layer-mutex.test.mjs` 回归测试(纯函数 + 源码契约双覆盖)。

**修改文件**：`server/src/lib/saved-overlay.ts`、`server/src/components/map-shell.tsx`、
`server/src/components/secondary-sidebar.tsx`、`server/tests/saved-layer-mutex.test.mjs`、
`server/tests/component-contracts.test.mjs`、`tech/11-phase2-plan.md`

**测试验证**：互斥流(开 → 地图只含收藏点 + 池保留 catalog;关 → 恢复管线,零重查)、
mutexVisibleIds 空收藏 = 空地图、池只增不删、桌面/移动列表互斥接线、契约注释修正。
全量 `npm test` + `typecheck` + `docs-check` + `git diff --check` 绿。

---

## 2026-08-20: 首点刷新+视角回杭州 + 聚合计数漂移 + 死代码清理(work 全量加载重构)

**症状**：
- 第一次点击 POI:地图重新刷新,视角回到杭州(用户报告,长期存在的严重 bug)。
- zoom < 8(聚合区间)继续缩小时聚合点数量变化。
- 历史功能叠加遗留大量前后逻辑矛盾、冗余低效代码。

**根本原因**：
1. 首点刷新:work 视口加载以 geolocation settle 为门(`load()` 等
   `geoSettled`)。首点触发定位完成 → `geoSettled`/`userLocation`/
   `searchOrigin` 依赖变化 → load effect cleanup 置 `signal.cancelled` 取消
   在飞加载循环并重载;首帧 `syncView()` 又被视口对齐拉回杭州。
2. 计数漂移:聚合分支按 `tier <= floor(zoom)` 过滤计数,zoom 变化 → 徽章 N
   漂移;且「杭州市」/「杭州」并存产生双徽章。
3. 冗余:视口增量加载(`listCatalog` state/ref)、首点 flyTo 队列
   (`pendingFlyToRef`)、视口搜索堆栈(`searchNearbyPOIs` /
   `searchViewportPOIs` / `searchViewportPOIsIncremental` / `POI_CATEGORIES`)、
   marker 同步注册表(`syncPOIsToMap`)、`fitPOIs`/`flyTo` 等与全量加载/聚合
   语义矛盾的死代码。

**解决方案**(work 全量加载 + 去门控 + 清理,`fix/poi-zoom-full-load`):
- work 模式改**全量加载**(`WORK_FULL_LOAD_MAX_PAGES=10_000`,不传
  bounds/maxTier,page 恒 1):当前规模 107 POI 一次取尽;侧栏列表客户端按
  `mapBounds` 裁剪(`pois` memo `inBounds`),不再有 work 视口请求(浏览器
  实测平移 0 请求)。
- `load()` 门控从 `mapReady && geoSettled` 改为仅 `mapReady`;load effect deps
  移除 `geoSettled`/`userLocation`/`searchOrigin`——geolocation settle 不再
  取消在飞加载循环(修复缓存只有 50 条的问题)。
- `handleSelect`/`onOpenDetail` 去 geolocation 门控;`pendingFlyToRef` 整体
  删除。`syncView()` 在 createMap 末尾首帧立即调用一次(mapBounds 提前就绪)。
- 缓存恢复/`handleModeChange` 恢复分支:work 置 `noMore=true`(全量池即取尽,
  防「加载更多」死按钮)。`MODE_CACHE_VERSION` 14→15(work 旧视口分页池
  失效)。
- 聚合计数取消 LOD 过滤(徽章 N 与 zoom 无关);裸城名分组(「杭州市」/
  「杭州」归入同一徽章)——详见 tech/21 规则 7。
- 死代码清理:净删 566 行(`loadWorkViewport`/`maxTierForZoom`/
  `lodVisibleAtZoom`/`sampleViewportGrid`/`normalizeBounds`/`buildSearchWaves`/
  `REFRESH_ADD_CAP`/`WORK_INITIAL_MAX_PAGES` 等)。

**修改文件**：14 个(`server/src` 9 + `server/tests` 5;tech/21 计数口径同步修订)

**测试验证**：
- ✅ 契约测试更新:计数与 tier 无关(zoom 0/4/5/6/8 全同)、未打标计入徽章、
  杭州市/杭州归一、首点无门控、work 分支 no-op + 客户端裁剪、restore
  work noMore=true
- ✅ 全量 488 测试通过(486 pass / 0 fail / 2 skip),typecheck 0 错误,
  docs-check / git diff --check 均绿
- ✅ 浏览器验证:首点公司卡详情立即打开、zoom 保持(未回杭州);zoom 6/4/2
  徽章一致(上海26/北京3/杭州27);zoom 10 聚合关、107 个体 pin;平移 0
  视口请求

---

## 2026-08-19: 收藏图层启停导致所有 POI 消失(saved-overlay-wipe)

**症状**：
- 开启收藏图层后,地图上所有 POI marker 全部消失,列表同步清空;关闭收藏图层也无法恢复。
  单 pin 收藏时必现,多 pin 且落在 DB 覆盖区外时同样复现。

**根本原因**(链条)：
1. `handleToggleSavedOverlay`(`map-shell.tsx`)在 **ON** 时执行程序化相机移动:
   `overlayBounds(overlayPois)` + `map.setBounds(...)`(bbf1e91「fit its pins」引入;
   无 AMap.Bounds 时 fallback `setCenter`)。OFF 分支是纯状态切换,本身无害。
2. `map.setBounds` 触发 AMap `moveend`/`zoomend` → `onViewChange` 调度 debounce 800ms
   的**视口 replace loader**;loader 以 `existing: []` 整体替换目录。
3. 收藏 pin 的视口往往是退化/稀疏视野:单 pin → `overlayBounds` sw==ne → 拉满 zoom → 0 行;
   或 pin 在 DB 覆盖区外 → 新批次 = `[]` → `setCatalog([])`/`setPOIs([])` 按 id diff
   **删光所有 marker**。OFF 时看到的「全消失」是 ON 清空后的残局。

**解决方案**(方案 A,保留 fit-to-pins UX)：
- 新增模块常量 `VIEWPORT_SUPPRESS_MS = 500` 与 ref
  `suppressViewportRefreshUntilRef`(`map-shell.tsx`):程序化相机移动前
  `suppressViewportRefreshUntilRef.current = Date.now() + VIEWPORT_SUPPRESS_MS`。
- `onViewChange` 加抑制检查:当前时间在抑制窗口内则跳过本次调度(不 schedule)。
  窗口自动过期,不影响后续用户操作触发的视口刷新。
- 用时间窗口而非一次性标记:setBounds 会连续触发 moveend + zoomend 双事件,
  一次性清除会被第二个事件重新调度。
- 纵深防御(同型问题:handlePickSaved 单 pin flyTo 空视野清空):视口 loader onBatch
  的「空批次保留旧目录」保护由同批 w1(poi-category-loading)承担(w1 prompt 任务 6),
  此处不重复实现以免区域冲突。

**修改文件**：
- `server/src/components/map-shell.tsx`(VIEWPORT_SUPPRESS_MS、suppress ref、
  onViewChange 抑制检查、handleToggleSavedOverlay 相机移动前置抑制窗口)
- `server/tests/component-contracts.test.mjs`(静态契约:抑制标记先于 setBounds/setCenter)

**测试验证**：
- ✅ 契约测试:抑制窗口 ref/常量存在;onViewChange 窗口内跳过 schedule;toggle 函数体内
  抑制标记在 setBounds 与 setCenter fallback 之前置位
- ✅ 全量 332 测试通过(330 pass / 0 fail / 2 skip),typecheck / docs-check /
  git diff --check 均绿

---

## 2026-08-19: POI 电话 `[]` 显示 + 本地 POI 查看评价链接

### 问题1:用户看到「电话 []」

**症状**：
- POI 详情里电话行渲染成「电话 []」

**根本原因**：
- `hz_pois.tel` 是 text 列,源 CSV 空电话写成字面量 `'[]'`(实测 1,006,158 行中
  697,546 行(69.3%));导入器 `cleanCsvRow` 只做 `(raw.tel || '').trim()` 不清 `'[]'`,
  原样入库;API 侧 `hzRowToDomainPoi` / `normalizeAMapPOI` 也直接透传。
  前端 `InfoRow` 只跳过 falsy,`'[]'` 是真值 → 显示「电话 []」。

**解决方案**：
- 导入器新增 `parseTelCell`(`hz-poi-import.ts`):空串/`'[]'`/`'{}'` → `undefined`
- 防御清洗(旧数据未重导也正确):`hz-poi-store.ts` 的 `hzRowToDomainPoi` 与
  `amap-api.ts` 的 `normalizeAMapPOI`(含空数组)均清成 `undefined`
- `poi-detail.tsx` 的 `InfoRow` 把 `'[]'`/`'{}'`/纯空白当空值,不渲染该行
- DB 脏数据清理(re-import / SQL UPDATE)是 Env-only,未执行,记 deferred

### 问题2:本地 POI 没有任何评价,也无入口查看

**根本原因**：
- `hz_pois` 无 reviews 表/reviewCount 列;本地 POI 恒显示「暂无详细评价」,
  用户无法跳到高德看真实评价。

**解决方案**：
- `poi-detail.tsx` ReviewSection:无 review 文本且 `poi.id` 是真 poiid
  (不以 `amap-` 合成前缀开头)时,「暂无详细评价」旁展示蓝色「查看评价」外链
  `https://www.amap.com/place/<poiid>`(`target="_blank" rel="noreferrer"`)
- 新增 i18n 键 `viewReviews`(zh: 查看评价 / en: View reviews);样式 `.reviewLink`
  沿用品牌蓝 `--accent`

**修改文件**：
- `server/src/lib/hz-poi-import.ts`(parseTelCell + cleanCsvRow tel 段)
- `server/src/lib/hz-poi-store.ts`(hzRowToDomainPoi tel 清洗)
- `server/src/lib/amap-api.ts`(normalizeAMapPOI tel 清洗)
- `server/src/components/poi-detail.tsx`(InfoRow 空值 + ReviewSection 外链)
- `server/src/components/poi-detail.module.css`(.noReviews/.reviewLink)
- `server/src/lib/i18n.ts`(viewReviews)
- 测试:`hz-poi-import.test.mjs` / `hz-poi-store.test.mjs` / 新增 `amap-api.test.mjs`

**测试验证**：
- ✅ tel `'[]'`/空串/空数组 → undefined(import 解析、store 映射、AMap 规范化三层)
- ✅ 真实电话保留(trim 后)
- ✅ 全量 305 测试通过(typecheck / docs-check / git diff --check 均绿)

---

## 2026-08-16: 滚动条体验优化

### 问题1：滚动条轨道背景持续显示

**症状**：
- 鼠标移到滚动区域后，滚动条轨道背景变成浅灰色
- 即使鼠标移开，背景色仍然保持显示
- 只有刷新页面才能恢复透明状态

**根本原因**：
- `globals.css` 中 `*:hover::-webkit-scrollbar-track` 和 `*:active::-webkit-scrollbar-track` 规则会在hover/active时给轨道添加背景色
- CSS伪类 `:hover` 和 `:active` 的生命周期是持久的，一旦触发就会保持状态
- 没有明确的"离开"状态来清除背景

**解决方案**：
- 删除了 `*:hover::-webkit-scrollbar-track` 和 `*:active::-webkit-scrollbar-track` 规则
- 滚动条轨道始终保持透明背景
- 只有滚动条thumb本身在hover时变深色，提供足够的视觉反馈

**修改文件**：
- `server/src/app/globals.css` (第100-106行，第120-125行删除)

**测试验证**：
- ✅ 滚动条轨道始终透明
- ✅ 滚动条thumb hover时正确变色
- ✅ 鼠标移开后无残留背景

---

### 问题2：POI列表滚动条弹跳卡顿

**症状**：
- 缓慢滚动POI列表时，卡片正常滚动
- 但滚动条在某个位置上下弹跳，无法平滑移动
- 滚动条位置与实际滚动内容不同步

**根本原因**：
- `poi-list.module.css` 中 `.cardSlot` 使用了 `content-visibility: auto` 和 `contain-intrinsic-size: auto 148px`
- 当卡片滚动到可视区域外时，浏览器使用 `contain-intrinsic-size: 148px` 作为占位高度
- 但实际卡片高度不是固定的148px（有多张照片或多个职位时会更高）
- 导致滚动容器总高度在"实际高度"和"占位高度"之间反复切换
- 滚动条位置计算错误，产生弹跳效果

**解决方案**：
- 从 `.cardSlot` 移除 `content-visibility: auto` 和 `contain-intrinsic-size: auto 148px`
- 让所有卡片保持真实高度，不使用虚拟化占位
- 同时优化滚动条尺寸：
  - 宽度从 10px 增加到 14px
  - border从 2px 增加到 3px
  - 实际可见thumb宽度从 6px 增加到 8px
- 改善了滚动条的可操作性和视觉反馈

**修改文件**：
- `server/src/components/poi-list.module.css` (第14-15行删除)
- `server/src/app/globals.css` (第77-79行，第88-89行，第109-111行修改)
- `server/tests/component-contracts.test.mjs` (第32-33行更新测试用例)

**技术细节**：
- `content-visibility: auto` 是Chrome的性能优化特性，用于跳过不可见内容的渲染
- `contain-intrinsic-size` 提供一个估算高度，但如果估算不准确会导致布局抖动
- 对于内容高度差异较大的列表（如POI卡片），不适合使用这个优化
- 保持真实DOM高度可以确保滚动条位置计算准确

**性能影响**：
- 移除 `content-visibility: auto` 后，所有卡片都会被渲染
- 当前POI列表通常在50-100个卡片范围内，渲染性能影响可接受
- 换来了更好的用户体验（滚动流畅度）
- 如果未来需要优化大列表性能，应考虑使用虚拟滚动库（react-window）而不是content-visibility

**测试验证**：
- ✅ 滚动条平滑移动，不再弹跳
- ✅ 滚动位置与内容完全同步
- ✅ 158个测试通过
- ✅ TypeScript编译无错误

---

### 问题3：卡片圆角处理和头像边框优化

**症状**：
- POI卡片圆角周围有诡异的背景色
- 液态玻璃效果不够精致
- 头像边框过粗（2px），不够优雅

**解决方案**：

**卡片优化**（`poi-card.module.css`）：
- 提升背景透明度：`0.34` → `0.48`（亮色），`0.42` → `0.52`（暗色）
- 提升边框透明度：`0.55` → `0.68`
- 简化阴影效果：移除多余的 `inset` 内阴影
- 优化渐变层透明度：`0.65` → `0.55`，调整渐变位置
- 降低 backdrop-filter 饱和度：`200%` → `180%`

**头像优化**（`map-shell.module.css`）：
- 边框宽度：`2px` → `0.5px`
- 登录用户边框透明度：`0.85` → `0.35`
- 游客边框透明度：`0.45` → `0.25`
- 现在是一道精致的细线，符合苹果设计语言

**修改文件**：
- `server/src/components/poi-card.module.css` (多处透明度和效果调整)
- `server/src/components/map-shell.module.css` (第429-445行头像边框)

**测试验证**：
- ✅ 卡片圆角干净，无异常背景色
- ✅ 液态玻璃效果更精致
- ✅ 头像边框轻盈优雅

---

## 最佳实践

基于这次修复总结的经验：

### 1. CSS性能优化特性的使用场景
- `content-visibility: auto` 适合高度一致的列表
- 不适合高度差异大的动态内容
- 使用前必须提供准确的 `contain-intrinsic-size`
- 如果无法估算准确高度，宁可不用

### 2. 滚动条样式设计原则
- 轨道背景应保持透明或极浅色
- 避免使用 `:hover` 状态给轨道添加持久背景
- thumb是主要的交互元素，应该在hover时提供明确反馈
- 宽度建议 12-16px，thumb可见部分至少 6-8px

### 3. 液态玻璃效果调优
- 背景透明度不要过低（< 0.3），否则显得脏
- 边框透明度应该高于背景（0.6-0.8范围）
- backdrop-filter 饱和度不要过高（150-180%合适）
- 渐变层的透明度要比背景低，才能产生高光效果

### 4. 测试验证流程
- 修改CSS后必须在浏览器中实际测试
- 滚动相关的bug必须手动滚动验证
- 更新测试用例以匹配新实现
- 确保TypeScript编译通过

---

## 2026-08-16: 地图初始化期间点击卡片导致重新加载

### 问题描述

**症状**：
- 在地图尚未完全初始化加载时点击侧控栏的POI卡片
- 地图会重新开始加载，而不是持续当前的加载流程
- 导致加载进度丢失，用户体验不连贯

### 调试历程

**第一次尝试**：在 `handleSelect` 中添加 `!mapReady || !geoSettled` 守卫
- ❌ 问题依旧存在

**第二次尝试**：补充 `onOpenDetail` 回调中的守卫
- 发现卡片点击触发两个状态更新路径，第一次修复遗漏了 `onOpenDetail`
- ❌ 问题依旧存在

**第三次诊断**：深入分析 effect 依赖和初始化流程
- 发现真正的根本原因：初始化过程中的**多次连续 setState** 触发并发加载

### 根本原因

**初始化时的状态更新序列**（`map-shell.tsx` 365-380行）：
```typescript
setMapReady(true);                              // 第1次setState
getCurrentPosition(map).then((loc) => {
  map.setCenter([lng, lat]);
  map.setZoom(15);
  setMapCenter({ lng, lat });                   // 第2次setState
  setUserLocation({ lng, lat });                // 第3次setState
  setSearchOrigin((prev) => prev ?? { lng, lat }); // 第4次setState
  setGeoSettled(true);                          // 第5次setState
});
```

**effect依赖数组**（661行）：
```typescript
}, [mode, query, mapReady, geoSettled, refreshToken, pageOffset, searchOrigin, userLocation]);
```

**竞态条件的完整流程**：
1. `setMapReady(true)` 触发effect，但 `geoSettled=false`，guard返回
2. `setUserLocation` 改变 `userLocation` 依赖，触发effect，但 `geoSettled` 可能还是 `false`
3. `setGeoSettled(true)` 触发effect，此时 `mapReady=true && geoSettled=true`，开始加载
4. **关键问题**：第2步到第3步之间如果用户点击卡片或发生其他重新渲染，会导致effect在 `geoSettled` 刚变 `true` 时再次执行
5. 更严重的是，初始化过程中的5次 setState 可能在不同的渲染周期完成，每次都重新评估effect依赖
6. 即使没有用户交互，React批处理的边界也可能导致effect被多次触发

**为什么前两次修复无效**：
- 阻止用户交互只能防止手动触发的重新渲染
- 但无法防止初始化本身的多次 setState 触发并发加载
- effect的依赖包含 `userLocation`，这个值在初始化的第3步才设置
- 当 `setUserLocation` 触发重新渲染时，如果 `geoSettled` 恰好也变成 `true`，effect会执行两次

### 解决方案

使用 `loadingRef` 标志防止并发加载，在 `load()` 开始时检查并设置标志，完成后重置：

```typescript
// 添加 ref 跟踪加载状态 (154行)
const loadingRef = useRef(false);

// POI加载effect (594-656行)
async function load() {
  if (!mapReady || !geoSettled) return;
  if (loadingRef.current) return; // 防止初始化期间多次setState触发并发加载
  if (skipFetchRef.current) {
    skipFetchRef.current = false;
    return;
  }
  // ... 缓存检查 ...
  loadingRef.current = true;  // 标记加载开始
  setLoading(true);
  try {
    // ... 加载逻辑 ...
  } finally {
    if (!signal.cancelled) {
      setLoading(false);
      loadingRef.current = false;  // 标记加载结束
    }
  }
}
```

**关键点**：
1. `loadingRef` 是同步的，在 effect 重新运行时立即检查
2. 即使 React 在初始化期间多次触发 effect，第二次执行会立即返回
3. `finally` 块确保无论加载成功或失败都重置标志
4. 配合 `signal.cancelled` 检查，避免组件卸载后的状态更新

### 修改文件

- `server/src/components/map-shell.tsx` (154行，594行，652-655行)
- `tech/16-bug-fixes.md` (本文档)

### 技术细节

**React批处理和effect触发时机**：
- React 18 自动批处理同步代码中的 setState
- 但 `getCurrentPosition` 是异步的，其回调中的 setState 可能在不同的批次
- 这导致初始化的5次 setState 可能触发1-5次重新渲染
- 每次重新渲染都会重新评估 effect 依赖
- 如果依赖在两次渲染之间变化，effect 会重新运行

**为什么用ref而不是state**：
- `useState` 的更新是异步的，无法在同一个渲染周期内立即检查
- `useRef` 是同步的，修改后立即生效
- effect 在同一个渲染周期内多次检查 `loadingRef.current` 会得到最新值
- 这是防止并发的正确模式

**与skipFetchRef的区别**：
- `skipFetchRef`：跳过整个加载逻辑（用于缓存恢复）
- `loadingRef`：防止并发执行（用于竞态保护）
- 两个标志互补，解决不同的问题

### 进一步诊断：对象引用导致的虚假依赖变化

**第四次调试**（2026-08-16）：
- 在浏览器中添加详细日志追踪 effect 触发
- 发现点击卡片后 POI loading effect 被触发了**3次**
- 时间间隔：116ms、270ms，说明是3次独立的状态更新
- 所有3次触发的依赖值**完全相同**，但 React 仍然认为依赖改变了

**真正的根本原因**：
- Effect 依赖数组包含对象类型：`searchOrigin` 和 `userLocation`
- React 使用 `Object.is()` 比较依赖，比较的是**引用**而不是**值**
- 即使对象内容相同（`{lng: 120, lat: 30}`），如果是新的对象引用，React 会认为依赖改变
- 某些状态更新（如点击卡片）会导致组件重新渲染，而重新渲染可能创建新的对象引用
- 新引用 → React 认为依赖变了 → effect 重新运行

**证据**（浏览器日志）：
```
[15128ms] [TEST] Clicking first card: didi-hangzhou
[15129ms] [HANDLESELECT] Called at render 40
[15130ms] [HANDLESELECT] Setting selectedId
[15131ms] [RENDER 41] MapShell rendered
[15363ms] [LOAD 1786898992784] Effect triggered  ← 点击后232ms，触发第1次
[15363ms] [LOAD 1786898992784] Early exit: skipFetch
```

虽然 `loadingRef` 防止了实际的重新加载，但 effect 仍然在不必要地运行。

**最终解决方案**：
将 effect 依赖数组从对象引用改为**原始值**：

```typescript
// 之前（错误）
}, [mode, query, mapReady, geoSettled, refreshToken, pageOffset, searchOrigin, userLocation]);

// 之后（正确）
}, [
  mode, query, mapReady, geoSettled, refreshToken, pageOffset,
  searchOrigin?.lng, searchOrigin?.lat,
  userLocation?.lng, userLocation?.lat
]);
```

**为什么这样有效**：
1. 原始值（number）的比较是按值比较，不是按引用
2. 即使父对象引用变了，只要 `lng` 和 `lat` 值不变，effect 就不会重新运行
3. 可选链 `?.` 处理 `null` 情况，`null?.lng` 返回 `undefined`
4. React 能正确比较 `undefined` 和数字值

**修改文件**：
- `server/src/components/map-shell.tsx` (第687行，依赖数组)

### 测试验证

**修复前**：
- 点击卡片后，POI loading effect 触发 3 次
- 所有触发都被 `skipFetch` 或缓存守卫拦截，但仍然浪费执行
- 从 render 40 到 render 82（42次重新渲染）

**修复后**：
- 点击卡片后，POI loading effect 只触发 1 次
- 完全消除了虚假的依赖变化
- 组件重新渲染次数从 42 次降低到预期范围

**测试结果**：
- ✅ 158个测试通过
- ✅ TypeScript编译无错误
- ✅ 浏览器验证：点击卡片不再触发多余的 effect 运行
- ✅ 地图初始化流畅，无重新加载

### 用户体验改进

- 地图初始化期间即使触发多次重新渲染也只会加载一次
- 用户点击卡片不会中断加载（配合 `handleSelect` 和 `onOpenDetail` 的守卫）
- 加载流程保持连贯，不会重新开始

### 4. React Effect 依赖数组最佳实践

**避免对象引用依赖**：
- Effect 依赖数组应该使用**原始值**（string、number、boolean），不是对象或数组
- React 用 `Object.is()` 比较依赖，对象比较的是引用而不是值
- 即使对象内容相同，新引用会导致 effect 重新运行

**错误示例**：
```typescript
const [userLocation, setUserLocation] = useState<{lng: number; lat: number} | null>(null);
useEffect(() => {
  // ...
}, [userLocation]); // ❌ 对象引用，可能导致虚假的依赖变化
```

**正确示例**：
```typescript
const [userLocation, setUserLocation] = useState<{lng: number; lat: number} | null>(null);
useEffect(() => {
  // ...
}, [userLocation?.lng, userLocation?.lat]); // ✅ 原始值，只有实际值变化才触发
```

**替代方案**：
```typescript
// 方案1：使用 useMemo 稳定对象引用
const stableLocation = useMemo(
  () => userLocation,
  [userLocation?.lng, userLocation?.lat]
);
useEffect(() => {
  // ...
}, [stableLocation]);

// 方案2：直接使用原始值（推荐，更简单）
useEffect(() => {
  // ...
}, [userLocation?.lng, userLocation?.lat]);
```

**并发保护模式**：
- 使用 `useRef` 标志防止异步操作并发
- `ref.current` 是同步的，立即生效
- `useState` 是异步的，无法在同一渲染周期内检查

```typescript
const loadingRef = useRef(false);
useEffect(() => {
  if (loadingRef.current) return; // 同步检查，防止并发
  loadingRef.current = true;
  asyncOperation().finally(() => {
    loadingRef.current = false;
  });
}, [deps]);
```

---

## 2026-08-17: 移动端提手间距 + 游客 Recent

### 问题1：地图模式 / 工作模式抽屉提手与上下组件间距不一致

**症状**：同一抽屉 snap 下，工作模式（更多 chips / 结果头）看起来比地图模式更挤或更松。

**根本原因**：提手 CSS 按 snap 而不是按模式区分；half/full 另有 `margin-top: 6px`，`.drawerContent` 顶部 25px 只在列表态出现，工作模式额外 chrome 叠在这个缝上。

**解决方案**：`.mobileDrawer` 增加 `--drawer-handle-gap: 8px`，提手统一 `padding-bottom`；去掉 half/full-only `margin-top`；把 `.drawerContent` 顶距收到 10px。芯片仍在 content 内，不再改 handle↔toolbar / handle↔search。

**修改文件**：`server/src/components/map-shell.module.css`

### 问题2：游客搜索后 Recent 仍为空

**症状**：未登录搜索并点选结果后，“最近”二级卡片仍是登录提示。

**根本原因**：`recordSearch` 在 `!user` 时直接 return；`refreshHistory` 只打 `/api/me/search-history`（游客 200 + `[]`）；`RecentPanel` 用 `!signedIn` 挡住列表。

**解决方案**：`lib/guest-search-history.ts`（`dm.guest-search-history.v1`，上限 30）只写 persistable 模式。游客读写本地；登录上传后保留本地镜像；登出再读本地。Recent 有条目就展示。

**修改文件**：`guest-search-history.ts`、`persistable.ts`、`map-shell.tsx`、`recent-panel.tsx`

---

## 2026-08-17: 数据导入崩溃 + (0,0) 假针

### 问题3：DB apply 因 `deadline: "招满即止"` 崩溃

**症状**：`import:seed:apply` 在雷达数据上抛 `invalid input syntax for type date: "招满即止"`（22007）。

**根本原因**：`positions.deadline` 是 date 列；雷达快照的截止时间是中文文本（"招满即止"、"2026 o6 30"），校验器不查格式，直接透传进 SQL。

**解决方案**：双保险——`radar_jobs.py` 的 `parse_deadline` 只输出合法 ISO 日期（空格/斜杠分隔兼容）；`recruitment-import.ts` 的 `normalizeDeadline` 在入库前再归一化，非法值落 null。

**修改文件**：`crawler/.../radar_jobs.py`、`server/src/lib/recruitment-import.ts`

### 问题4：DB 读路径把无坐标站点画成 (0,0) 针

**症状**：导入 137 家公司后 `/api/pois` total=137，雷达-only 公司（仅城市文本、无坐标）被 `lng ?? 0, lat ?? 0` 画到非洲西海岸。

**根本原因**：离线路径有 `hasPlausibleCoord` 过滤；DB 读路径（`loadWorkCatalogFromDb` 无空间裁剪分支）直接 `site.lng ?? 0`。

**解决方案**：DB 读路径统一过滤：无坐标站点不进 POI；全部无坐标时返回 null 回落离线目录。

**修改文件**：`server/src/lib/recruitment-store.ts`

### 问题5：礼貌抓取的真实世界健壮性

- 瞬态 SSL/网络错误（`URLError`）与拼错 charset（`uft-8`）会中断整轮扫描 → `acquire.py` 捕获并跳过。
- `parse_robots` 组优先级错误（具体 UA 组应覆盖 `*` 组）→ 按 RFC 9309 重写。
- 导航 CTA（"Join Tigermed"、`javascript:` 链接、超长横幅）被误判为岗位 → 词边界匹配 + href 过滤 + 标题长度上限。

**修改文件**：`crawler/app/domain_map_importer/acquire.py`、`html_jobs.py` + 测试

---

## 2026-08-17: 坐标审计修正 + 会话缓存数据陈旧

### 问题6：11 个 pin 的坐标/地址与真实位置不符

**症状**：地图上的公司 pin 与实际办公地不符（偏差最高 24km，如贝达在临平却标在文一西路291号）。

**根本原因**：seed 与 official-career 的坐标是开发期人工策展填写的，从未经过地理编码验证。

**解决方案**：三层核查（地址→坐标 geocoding、坐标→地址 regeocoding、岗位→公司域名匹配），基于高德 Web 服务 + 工商公开地址。修正 11 家坐标/地址（蚂蚁→西溪路556号Z空间、深度求索→拱墅汇金国际大厦、贝达→临平兴中路355号、泰格→滨江盛大科技园、群核→莱茵·矩阵国际等）。固化 `npm run audit:pins`（`scripts/audit-pin-locations.mjs`，14/14 PASS）。

**修改文件**：`seed-data.ts`、`official-career/*.json`、`scripts/audit-pin-locations.mjs`、PostGIS（重导）

### 问题7：坐标修正后浏览器仍显示旧位置

**症状**：数据修正后用户刷新页面，地图 pin 仍在旧位置。

**根本原因**：工作模式 catalog 存在 sessionStorage（`domain-map:mode-cache:v1:*`），切模式/重进恢复旧缓存、不重拉 API；缓存版本未随数据修正而失效。

**解决方案**：bump `MODE_CACHE_VERSION`（1→2），版本校验拒绝旧缓存并重新拉取。数据修正流程固化：改 seed/drops → `import:seed:apply` → bump 缓存版本 → `audit:pins` 验证。

**修改文件**：`lib/mode-cache.ts`、`tests/mode-cache.test.mjs`

---

## 2026-08-19: 移动端抽屉 chrome(全开高度→指南针中心 + 全开隐藏指南针/比例尺 + 移动端定位按钮)

### 问题：抽屉全开与顶部控件重叠 / 移动端缺定位按钮

**症状**：移动端抽屉全开(86svh)仍与右上角指南针、左上角比例尺区域重叠;移动端指南针下方没有「显示我的位置」按钮(桌面才有)。

**方案**：
- **全开高度**改为顶边=指南针中心:`calc(100svh - max(12px, env(safe-area-inset-top)) - 20px)`(40px 按钮一半=20px)。`.mobileDrawer` 的 `max-height` 必须同步为同一 calc,否则 max-height 会截断更高的全开抽屉。`.drawerHalf`/`.drawerMini` 不变。
- **拖拽一致性**:JS 侧原 `DRAWER_FULL_RATIO=0.86` 的比率阈值无法表达「顶边到指南针中心」,改为 `drawerFullHeight(vh, safeTop) = vh - (max(12, safeTop) + 20)`。`safeTop` 在 pointerdown 时用探测元素实测 `env(safe-area-inset-top)`(读 `getComputedStyle(paddingTop)`),存在手势 ref 里,pointermove/松手共用;取不到返回 0。拖拽阈值与 CSS 高度对齐后,松手 snap 不回弹到错误档位。
- **全开隐藏指南针+比例尺**:`.topTools` 是 `.mobileDrawer` 的兄弟,不能靠兄弟选择器 → 在 map-shell.tsx 条件化 className(`topToolsHidden`,opacity/visibility ~200ms 过渡);比例尺是命令式 `AMap.Scale`,需把局部变量提升到 `scaleControlRef`,新增 effect 在 `drawer==="full" || !!detailPoi` 时 `hide()`/否则 `show()`,空指针守卫;插件异步加载与 resize 重建控件时用 `drawerFullishRef` 同步一次初始显隐。**⚠ 必须限移动端**:`detailPoi` 在桌面端也成立(左侧栏打开详情),若不限视口会把桌面 top-right compass / bottom-left scale 一并隐藏 → `.topToolsHidden` 包 `@media (max-width:767px)`,scale 显隐 effect 与插件/resize 同步均加 `window.innerWidth <= 767` 守卫。
- **移动端定位按钮**:`.topTools` 内 compass 后加同款 `.toolButton .locateButton`,移动端 40×40(继承 `.topTools>.toolButton`)+ `box-shadow:var(--shadow)`;桌面端 `@media (min-width:768px){ .topTools .locateButton{ display:none } }`(避免与右下角 `.mapControls` 定位按钮重复)。

**修改文件**:`server/src/components/map-shell.tsx`、`server/src/components/map-shell.module.css`

**测试验证**：typecheck 通过;`npm test` 全绿;文档 `tech/07` 抽屉/工具组/比例尺节同步。

## 2026-08-19: 移动端二级卡片交互(返回滚动保留 + 边缘点选取消)

### 问题1：详情返回后列表滚动位置重置

**症状**：移动端(≤767px frost 抽屉)选中一张二级卡片 → 进详情 → 返回列表后,列表滚回顶部,
刚选中的卡片滚出视野(蓝色选中态仍在,只是看不见)。

**根本原因**：`.drawerContent`(`map-shell.tsx`)是滚动容器(`overflow:auto`),但无 ref、无
scrollTop 保存/恢复。打开详情时 `detailPoi` 三元组让 `.drawerContent` + `POIList` 整体卸载,
返回时重挂载,`scrollTop` 归零。

**解决方案**：
- `.drawerContent` 挂 `ref={drawerContentRef}`(`useRef<HTMLDivElement>`),配 `drawerScrollRef`
  (`useRef(0)`)。
- 移动端卡片 onClick 链(`onSelect`)在 `setDetailPoi(poi)` 之前
  `drawerScrollRef.current = drawerContentRef.current?.scrollTop ?? 0`。
- 返回恢复用 `useLayoutEffect`(key 为 `detailPoi`):当其变为 `null` 且 ref 存在时
  `drawerContentRef.current.scrollTop = drawerScrollRef.current`。layout effect 在重挂载
  DOM 更新后、绘制前执行,保证容器已存在;任意 `detailPoi→null` 路径(抽屉把手 / `onBack` /
  手势下推)都覆盖。
- 清理时机:模式切换(`handleModeChange`)、新搜索(`openExploreSearch`)、刷新本处
  (`handleRefreshHere`)、桌面 `onOpenDetail` 都清零 `drawerScrollRef`,避免把旧视野的滚动
  带到新列表/移动端。

**修改文件**：
- `server/src/components/map-shell.tsx`

### 问题2：点卡片边缘空隙无法取消选中

**症状**：卡片显示蓝色已选态时,点卡片周围的空隙(卡片间 12px margin/列表空白)不会取消选中;
只有点地图才能取消(移动端抽屉盖住地图下半,点地图罕见)。

**解决方案**：
- `poi-list.tsx`:`POIList` 新增可选 prop `onDeselect?: () => void`;`.cardSlot` 与 `.list`
  容器都接 `onClick`(仅 `onDeselect` 传入时)。`.cardSlot` 的 onClick 带 `stopPropagation`
  避免与 `.list` 双重触发。`.list` 容器级 onClick 是为了兜住卡片间的 12px flex gap(该 gap
  实际属于 `.list`,不属于 `.cardSlot`)。
- `poi-card.tsx`:`<article>` onClick 加 `e.stopPropagation()`,点卡片自身不冒泡到 cardSlot/list
  触发取消,仍走原 select + 进详情逻辑。
- `map-shell.tsx`:移动端 `POIList` 传 `onDeselect={() => { setSelectedId(null);
  setHighlightedId(null); }}`(与桌面点地图取消口径 647-652 一致);桌面 `secondary-sidebar`
  不传,行为不变。

**修改文件**：
- `server/src/components/poi-list.tsx`
- `server/src/components/poi-card.tsx`
- `server/src/components/map-shell.tsx`
- `server/tests/component-contracts.test.mjs`

**测试验证**：
- ✅ 组件契约测试新增:POICard stopPropagation、POIList onDeselect 接线、map-shell
  drawerScroll 保存/恢复。
- ✅ 全量 `npm test` 423 通过 / 0 失败(2 跳过,2026-08-19)。
- ✅ `npm run typecheck` 无错误。

### 注意：桌面 secondary-sidebar 行为不变

桌面 L2 复用同一个 `POIList`,但不传 `onDeselect`,`.list` / `.cardSlot` 的 onClick 均为
`undefined`,无取消选中交互;`stopPropagation` 只阻断卡片点击继续冒泡到容器,桌面无依赖
该冒泡的 handler,行为保持不变。

---

## 2026-08-19: 移动端微修(打开 profile 滚动重置 + 侧控栏搜索框失焦丢文本)

### 问题1:移动端打开 profile 继承列表滚动位置

**症状**:移动端滚过 POI 列表后点头像打开 account 面板,面板不是从顶部开始,而是停留在列表的滚动位置。

**根本原因**:抽屉滚动容器 `.drawerContent`(`map-shell.tsx:2394`)常驻挂载(`overflow:auto`),
`mobileSheet` 切换只换内容不卸载容器,`scrollTop` 被带到 account 面板;`openMobileAccount`
(`map-shell.tsx:1681-1694`)只设 `mobileSheet="account"` / `drawer="full"` / 清 detailPoi、
mobileJd,无滚动重置;全库无 `scrollTo(0)`。

**方案**:`openMobileAccount` 打开 account 分支末尾重置
`if (drawerContentRef.current) drawerContentRef.current.scrollTop = 0`。头像按钮只在
`!detailPoi` 分支渲染,不会与详情返回的 `useLayoutEffect` 滚动恢复(detailPoi→null)打架。

**修改文件**:`server/src/components/map-shell.tsx`(openMobileAccount,~1694)

### 问题2:展开侧控栏,搜索框有文本失焦后文本不可见

**症状**:侧控栏展开、搜索框有查询文本时点击别处(失焦),文本消失;重新聚焦又出现,状态并未丢失。

**根本原因**:CSS 可见性问题——`.searchBox input`(`map-shell.module.css:391-397`)
`opacity:0` + `position:absolute`,仅 `.searchBox:focus-within input`(:399-401)显示;fallback
标签「搜索」只在 `!query` 时渲染(`map-shell.tsx:1944`)。于是 有文本+失焦 → input 透明 且
label 不渲染 → 看起来文本消失。

**方案**:CSS-only 最小 diff——`.sidebarOpen .searchBox input:not(:placeholder-shown) {
opacity: 1 }`。`query` 非空时 placeholder 不占位(`:not(:placeholder-shown)` 命中),展开态
失焦也常显;折叠态不挂 `.sidebarOpen`,仍只显示图标;空查询仍走 label,行为不变。与既有
`.sidebarOpen .searchLabel` 规则同构。

**修改文件**:`server/src/components/map-shell.module.css`(`.searchBox` 区,~403)

**测试验证**:
- ✅ 组件契约测试新增:「mobile account open resets drawer scroll; expanded search keeps
  query text visible」(map-shell.tsx 重置断言 + CSS `:not(:placeholder-shown)` 断言)。
- ✅ 全量 `npm test` / `npm run typecheck` 通过。

## 2026-08-19: 比例尺控件崩溃(地图销毁后 resize 摸已销毁实例)

### 问题：控制台 `Cannot read properties of undefined (reading 'removeChild')` / `appendChild`

**症状**：组件卸载 / Next dev Fast Refresh 重挂载 / 路由重挂后,窗口 resize 偶发抛
`removeChild`/`appendChild` 错误,或地图区域出现**两个比例尺**。

**根本原因**：
- `handleResize`(map-shell.tsx ~630)在 resize 时 `map.removeControl(scaleControl)` +
  `map.addControl(...)`。window resize 监听在 `createMap` 里注册,但 `initMap` 调用
  `createMap(...)` **没有接收返回值**——cleanup(含 `removeEventListener('resize')`)成了
  孤儿永不执行。
- 地图销毁后,泄漏的 `handleResize` 仍引用已销毁的 map/容器 → 下一次 resize 摸到销毁
  实例 → removeChild/appendChild 崩溃。
- 附带竞态:`AMap.Scale` 插件回调若在 resize 之后完成,会**第二次 addControl**,产生两个
  比例尺。

**方案**：
- `initMap` 持有 `createMap` 返回的 cleanup(`mapCleanup = createMap(...)`);effect cleanup
  先 `mapCleanup?.()`(移除 resize/主题/鼠标监听)再 `map.destroy()`——顺序反了会在销毁
  实例上 removeEventListener。
- `handleResize` 加保护:`mapInstance.current` 为 null / `map.isDestroyed?.()` → 直接 return;
  `scaleControlRef.current` 未就绪(插件未加载完)由插件回调创建,不抢建。
- 双 addControl 竞态:统一 `addScaleControl()` 创建函数,插件回调里
  `if (scaleControlRef.current) return`;resize 先 remove 再置 null 再重建。

**修改文件**：`server/src/components/map-shell.tsx`(initMap ~485、Scale 区域 ~616-660、
effect cleanup ~692)

**测试验证**：组件契约测试新增 scale 静态断言(cleanup 接线 / 销毁保护 / 无双 addControl);
`npm test` 全绿;typecheck 通过。

---

## 2026-08-19: POI 停止加载/不新增(A/B/C/D)+ 加载更多按钮

### 症状

滚动到底后列表停在「── 没有更多结果 ──」不再新增;或一次瞬时网络/AMap 错误后哨兵
永久失效;或叠加模式切换缓存恢复后列表冻结;桌面探索侧栏无手动「加载更多」入口。

### 根本原因(A-D)

- **(A) 一次失败永久 noMore,无重试**:domain 路径错误静默 `return existing`、work 路径
  失败返回 `[]` → 主 load 的 `noMore = beforeLen>0 && data.length<=beforeLen` 置 true →
  `handleNeedMore` 在 `noMoreRef` 为 true 时硬返回。一次瞬时错误 = 哨兵永久失效。
- **(B) `loadingRef` 无限卡死,AMap 无超时**:`searchPOI` 只等 `complete`/`error` 事件,
  PlaceSearch 永远不回调(配额/脚本异常)时 `load()` 永久 await,后续一切加载被堵死。
- **(C) `skipFetch` 提前 return 吞掉待重放的视口刷新**:skipFetch 分支在 try/finally 之前
  return,视口刷新 pending 的重放逻辑被跳过 → 列表冻结到下一次地图移动。
- **(D) domain noMore 误判**:noMore 用**原始 catalog** 长度比较,可见列表是**过滤后**的
  memo;且 domain-local 带 common 过滤与 offset 上限 1000,DB 返回 0 新行时误判 noMore,
  即使视口内还有合法 POI。

### 方案

- **(A) 错误 ≠ 没有更多**:`poi-service.ts` 三条失败路径(domain 关键词/AMap 回退/本地库
  高德兜底)一律 `throw`,不再静默 `return existing`;`viewport-search.ts` non-ok 抛错
  (不再返回 `[]`);map-shell `load()` catch 置 `error` 态(不碰 `noMoreRef`),成功清 error;
  POIList footer 错误态显示「加载失败,点击重试」玻璃按钮(`onRetry` 清缓存 + refreshToken+1,
  同一 pageOffset 重拉,不跳过失败批次);哨兵在错误态不自动重发(等显式重试)。
- **(B) AMap 超时**:`amap-api.ts` 新增 `withTimeout` + `SEARCH_TIMEOUT_MS=15_000`,`searchPOI`
  的 promise 包超时,超时以 error 形态 settle → 走任务 A 的重试路径,绝不永久 await。
- **(C) skipFetch 不吞视口刷新**:skipFetch 提前 return 前,`viewportRefreshPendingRef` 已
  置位则直接 `viewportLoaderRef.current?.schedule()` 补跑。
- **(D) noMore 用服务端 total**:`fetchPOIsForMode` 返回 `{ pois, noMore? }`;domain-local
  用响应 `total` 判 `offset + rows.length >= total`(过滤导致可见列表不变不再误判);
  work 的 `/api/pois` 同样透出 `total`(`loadWorkViewport` 满页但已取完 → noMore,不白打
  后续页);无 total 的降级路径(高德回退/关键词)保持本地长度判断。
- **加载更多按钮**(桌面 secondary-sidebar resultHeader 右端,移动抽屉不加):蓝色文字按钮
  (12px 小字 `--blue-ink` `#0062CC`,玻璃底),`onLoadMore` → `handleNeedMore`(与滚动哨兵
  同一路径 pageOffset+1);noMore/atCap/空列表隐藏;loadingMore 禁用显示「加载中…」;
  错误态变「重试」(`onRetry`)。i18n 新键 `loadMore`/`loadingMore`/`retry`/`loadFailedRetry`。

**修改文件**：`server/src/components/map-shell.tsx`(load/skipFetch ~748-883、handleNeedMore
~1222、handleRetry ~1238、POIList/SecondarySidebar props 接线)、`server/src/components/
secondary-sidebar.tsx`(resultHeader ~437-457 + props)、`secondary-sidebar.module.css`、
`poi-list.tsx`(footer 错误重试 + 哨兵错误门控)、`poi-list.module.css`(`.retryBtn`)、
`server/src/lib/poi-service.ts`、`server/src/lib/viewport-search.ts`、`server/src/lib/
amap-api.ts`(withTimeout ~309-334)、`server/src/lib/i18n.ts`、`server/tests/poi-service
.test.mjs`(新)、`server/tests/viewport-search.test.mjs`、`server/tests/component-contracts
.test.mjs`。

**测试验证**：
- ✅ `poi-service.test.mjs`(新):withTimeout 超时 error settle、total 判 noMore(未到/到底)、
  本地库失败抛错。
- ✅ `viewport-search.test.mjs`:透出服务端 total、non-ok 抛错、total 判 noMore 不白打后续页、
  失败上抛不置 noMore。
- ✅ `component-contracts.test.mjs`:scale cleanup 静态断言 + resultHeader 加载更多按钮/
  错误重试/i18n 键断言。
- ✅ 全量 `npm test` 307 通过 / 0 失败(2 跳过);`npm run typecheck` 无错误。

---

## 相关文档

- 设计系统：`tech/07-frontend-design-system.md`
- 组件开发指南：`.claude/skills/frontend-component-dev/skill.md`
- 测试规范：`server/tests/component-contracts.test.mjs`

---

## 2026-08-19:import:apply 清空站点坐标(事故,79 pins → 2)

**症状**：`npm run import:seed:apply` 后工作模式地图从 ~79 个公司 pin 骤降到 2 个。

**根因**：
1. 8/17 的 `geocode:sites:apply`(commit 7d19271)把 65+ 家 radar 公司的真实杭州办公室坐标
   copy-on-write 进 radar drops；其后 `refresh-radar` 重生成 drops(fbc4448,per-city 布局)时
   **坐标随重生成丢失**——DB 成了唯一持有坐标的地方。
2. `applyRecruitmentImport` 的 `UPDATE company_sites SET lng = $7, lat = $8` 用
   `drop 坐标 ?? NULL` **覆盖**既有列——drop 缺坐标 → 既有 geocoded 坐标被清成 NULL。
3. `loadWorkCatalogFromDb` 只保留 `hasPlausibleCoord` 的站点 → 地图只剩 official-career
   幸存公司(贝达药业、深度求索)。

**修复**：
- `server/src/lib/recruitment-import.ts`：site UPDATE 改 `lng = COALESCE($7, lng),
  lat = COALESCE($8, lat)`——drop 缺坐标时保留既有坐标,永不破坏已 geocoded 数据。
- 数据恢复：从 7d19271 把已验证坐标合回当前 drops(65 文件 / 181 站点)+ manycore 补 curated
  seed 坐标(西湖区余杭塘路 515 号莱茵·矩阵国际)。
- 回归契约测试：`tests/recruitment-import.test.mjs` 静态断言 COALESCE 存在。

**验证**：重导后 `GET /api/pois?mode=work&bounds=中国` total = 75(事故前 ~79,差额为无 open
岗位/从未 geocoded 的公司);群核科技 4 拆分岗位 + 公共战略培训生均正常。

## 2026-08-19: 视口空批次保护(程序化相机移动冲空目录)

**症状**：`setBounds` / `flyTo` 等程序化相机移动触发视口 loader,替换语义的
onBatch 若返回空批次,会把已有非空目录整体清空(收藏图层同类 bug 的纵深防御)。

**修复**：
- `map-shell.tsx` work 分支与 domain 视口分支的 onBatch 各加防御:
  `batch.length === 0 && catalogRef.current.length > 0 → 保留旧目录`(不整体替换为空)。

**修改文件**：
- `server/src/components/map-shell.tsx`(两处 onBatch 空批次保护)

## 2026-08-19: 站点合并键折叠——多城市公司同名站点 collapse(import site_key)

**症状**:`import:seed:apply` 后得物/米哈游等 9 家试点公司每家只剩 1 个站点,且
city 字段与坐标错配(米哈游 city=北京市、坐标却在上海徐汇;哔哩哔哩 city=深圳市、
坐标是上海杨浦)。地图上多城市办公点全部消失。

**根因**:`recruitment-import.ts` 的站点合并键是 `(company_id, name)`——
多城市 drops 里 5 个站点同名(得物-site-beijing/-shanghai/... 的 `name` 都是
「得物」),`LIMIT 1` 命中同一行,后写站点覆盖 city/坐标 → 折叠 + 错配。
这是全国多城市数据模型落地后的**首次**带多站点 import,此前所有公司单站点,
按 name 合并一直没暴露。

**修复**(`738f1bc`):
- `db/migrations/016_site_key.sql`:加 `company_sites.site_key` 列 +
  `(company_id, site_key) WHERE site_key IS NOT NULL` 唯一索引;
- import 合并键改为 `site_key`(= drop 的 `site.id`);存量行(site_key IS NULL)
  按 `(name, city IS NOT DISTINCT FROM)` 一次性认领并回填,同名同城才可能
  误配,多城市站点按城市区分,组合唯一;
- INSERT/UPDATE 携带 site_key;COALESCE 坐标保护保留(参数号顺移 $7→$8 等)。

**恢复**(Env-only,用户授权执行):清理全部 legacy 站点行(site_key IS NULL,
687 行)+ 其 positions(876 行,按 external_id upsert 重链)→ 全量重导 →
验证 15/15 -shanghai 站点坐标落在上海市 bbox、得物 5 站独立、DB 1440 站点
与 drops 一致。positions 表 `ON DELETE RESTRICT` — 先删 positions 再删 sites。

**教训**:import 的合并键必须映射 drop 的稳定标识(site.id),不能依赖展示名;
「同名不同城市」是合法数据形态,不是重复。

## 2026-08-19: 工作视口刷新三件套——noMore 闩锁 / 挂载对齐加载 / 空批次三态(boss 批次 ws1)

**症状**:视角拖动后工作 POI 不更新;杭州↔上海切换后常出现整城无 POI;低 zoom 或
残留城市标签下空视野被旧城市 pin 占住且无限滚动失效,恢复只能等下一次 moveend。

**根因**(Explore 复现 + 代码链):
1. `viewport-search.ts` 空页/短页 → `noMore=true` 闩锁;空批次(0 条)常由滤波/层级
   maxTier 裁剪导致,并非「到底」,闩锁后无限滚动失效、粘滞空白。
2. mode 级缓存(非城市级)恢复后主加载早退;地图初始化固定在杭州;geolocation 被拒时
   不产生 moveend → 刷新页面后当前视野整城空白,直到用户手动拖动。
3. 空批次保护 `batch.length === 0 && catalogRef.current.length > 0 → return` 无差别
   保留旧目录:新视野请求返回空时,旧城市 pin 全在屏幕外 → 新城市视觉空白。

**修复**(`78383f1` / `3a5430e` / `544e514`):
- noMore 闩锁:空批次(0 条)→ `noMore=false`;短页(< pageSize)仍闩锁。
- 挂载对齐加载:mode 缓存新增 `viewport` 视野快照(center/zoom/bounds),恢复时与当前
  地图视野不符(无快照 / 中心距 / zoom 差超阈值)→ 主动调度一次当前视野加载,不等 moveend。
- 空批次三态:请求成功且 0 条——旧目录有 POI 落在当前视野 bounds 内 → 保留
  (收藏 fitToPins 退化视野,VIEWPORT_SUPPRESS_MS 兜底);否则真空 → `setCatalog([])` 走空态;
  请求失败 → 保留旧目录 + console.warn。

**修改文件**:
- `server/src/lib/viewport-search.ts`(noMore 空批次不闩锁)
- `server/src/components/map-shell.tsx`(挂载对齐调度 + 空批次三态,work/domain 两分支)
- `server/src/lib/mode-cache.ts`(视野快照字段,key 结构不变,旧缓存兼容)
- 测试:`viewport-search.test.mjs`(0 条不闩锁)、`mode-cache.test.mjs`(快照 round-trip)、
  `component-contracts.test.mjs`(三态 + 对齐加载契约)

**验证**:376 pass / 0 fail;实机(dev :3000 + Playwright)刷新页面后缓存视野自动对齐回
当前视野 ✓;单次拖动后 marker 数 == catalog 数 ✓。

## 2026-08-19: marker 控制器与地图 overlay 失同步(残留 pin,boss 批次 ws2)

**症状**:杭州↔上海往返多次后,旧城市 marker 永久残留在地图上(`getAllOverlays('marker')`
> catalog 数),且残留 marker 不在控制器内部 markers Map 中(setPOIs 差分无法移除)。

**根因**:控制器创建/销毁与 AMap 异步就绪、地图实例销毁的竞态——地图已销毁后
overlay 注册表无人清理,`isReady()` 未拦截已销毁地图,marker 挂到已死实例上永久残留;
部分异常路径构造的 marker 未入 placed 账,cleanup 时摘不掉。

**修复**(`783f8d8` + 测试 `8a07cf0`):
- `isReady()` 增加 `map.isDestroyed()` 守卫:已销毁地图不再创建/操作 marker。
- placed 兜底账:构造即入账,任何后续异常都能凭 placed 摘除;`destroy()` 后
  `sweepPlaced()` 强制清扫全部登记 overlay,保证不变式「销毁后地图上无该控制器管理的 marker」。
- pendingPOIs 回放路径保留,amap 异步就绪后统一 flush。

**修改文件**:`server/src/lib/map-markers.ts`、`server/tests/marker-leak.test.mjs`
(mock 契约,9 用例)+ fixtures。

**验证**:375 pass / 0 fail;实机往返后 marker 计数与 catalog 一致 ✓。

## 2026-08-19: 公司无 icon——DB 读路径绕过 logo 解析链 + import 丢 logo + favicon 不可达(boss 批次 ws3)

**症状**:工作模式地图公司 marker 全为默认 🏢 徽章(DB 实测 672 家 `logo_url` 100% 空、
`logo_emoji` 99.7% 空)。

**根因**:
1. `recruitment-store.ts` DB 读路径直接读列(`logo_emoji ?? undefined`),不调
   `resolveCompanyLogo` 解析链(careerUrl → favicon);离线路径(recruitment-source.ts)才走。
2. `recruitment-import.ts` `mergeCompany` 只合并 sites+positions,丢弃 seed/drop 的
   logoUrl/logoEmoji → DB 全空。
3. `faviconFromUrl` 用 `google.com/s2/favicons` 国内被墙 → 即使有 URL 也加载失败。

**修复**(`d78e6f3` / `c09e706` / `f50cb20` + ADR-007 `a33bd24`):
- import:`mergeCompany` 合并 logoUrl/logoEmoji(非空不覆盖);site upsert COALESCE 保既有值。
- DB 读路径:解析链抽成可复用函数,`loadWorkCatalogFromDb` 对 logo 空的公司按链解析
  (careerUrl → favicon 兜底),离线/DB 两路径共用;无 logo → 🏢 emoji 兜底语义不变。
- favicon 服务:google s2 → **favicon.im**(国内可达,curl HEAD + content-type 实测,
  对 IP 域名返回 404 → emoji 兜底),选型与可达性结论记 ADR-007(tech/06-decisions.md)。

**修改文件**:`server/src/lib/recruitment-import.ts`、`recruitment-store.ts`、
`company-logo.ts`、`tech/06-decisions.md`(ADR-007)+ 测试。

**验证**:门禁全绿(397 pass / 0 fail);实机 marker 渲染 `favicon.im` `<img>`
(careerUrl→favicon 请求发出),加载失败回退 🏢 ✓。

## 2026-08-19: Profile 已投递/收件箱行不可点击(boss 批次 ws4)

**症状**:「我的投递」与「收件箱」行是纯文本,无点击跳转;数据已有
`companyPoiId`/`positionId`(`/api/me/applications`),岗位详情链路(poi-detail / JdPanel)
已存在但未接线。

**修复**(`c50462d` / `d3061ab` / `63b0aa5`):
- `account-panel.tsx`:两处行 `li.appRow` → `li > button.appRow`(视觉不变,hover 沿用
  rowBtn 语义,`positionId`/`companyPoiId` 缺失禁用)。
- `map-shell.tsx` 新增 `handleOpenApplication`:`GET /api/pois/[id]?mode=work` →
  按 positionId 匹配岗位 → 桌面 `setDetailPoi`+`setOpenPositionId` / 移动 `setMobileJd`;
  岗位下线/拉取失败 → console.warn + 面板原样,不崩溃。桌面与移动 embedded 两处接线。

**修改文件**:`server/src/components/account-panel.tsx`、`account-panel.module.css`、
`server/src/components/map-shell.tsx`、`server/tests/component-contracts.test.mjs`。

**验证**:369 pass / 0 fail;契约测试覆盖 button 化、回调载荷、禁用态、接线函数。

## 2026-08-20: 城市徽章串味剔除 + LOD 计数口径(boss 批次 w1)

**症状**:成都徽章混入坐标在杭州的串味行(假聚合);徽章数量不正确/不稳定,导航历史不同
徽章数不同;贝达药业(seed 无 sites/tier)归属与徽章表现异常。

**根因**:`clusterCities` 按 city 标签分组,不校验坐标是否落在该城市参考框内(串味行
city=成都 但坐标=杭州 被并入成都组);徽章 N 按池内残留行计数,与同 zoom 服务端
取数口径不一致。

**修复**(`0b247a5` / `7d3e91e`):
- `cityLabelMatchesCoordinates`(spatial-query.ts:118-141):标签 bare 归一后命中
  `CITY_REFERENCE_BOXES` 已知框但坐标不在框内 → 串味行剔除;参考框未收录/坐标缺失 → 放行。
- `clusterCities` 两道防御(city-cluster.ts:82-87):①串味剔除;②LOD 计数口径
  (`tier <= maxTierForZoom(zoom)` 才进徽章,未打标按 `TIER_DEFAULT=12` 不计),与同 zoom
  服务端 `/api/pois?filters.maxTier` 取数口径一致。徽章样式/触发阈值未动。

**修改文件**:`server/src/lib/spatial-query.ts`、`server/src/lib/city-cluster.ts`、
`server/tests/city-cluster.test.mjs`(+7)、`server/tests/spatial-query.test.mjs`(+2)、
`tech/21-city-clustering.md`(规则 6/7 记录新语义)。

**验证**:462 pass / 0 fail(净增 9);DB 串味行是否残留留给 boss 合并后 SQL 复核
(w1 报告附 `betta-hangzhou` 验证 SQL)。

## 2026-08-20: 首点 POI 视角 geoSettled 门控补放(boss 批次 w2)

**症状**:地图初始化 geolocation 挂起期间(`geoSettled=false`,1-5s 窗口)首次点击公司
详情卡/列表卡,相机不飞过去;settle 后需再点一次才正常。

**根因**:`handleSelect` / `onOpenDetail` 的 `!mapReady || !geoSettled` 门控命中时
直接 `return`,首点选中意图被静默丢弃。

**修复**(`0b3bb6b` / `2547977`):
- `pendingFlyToRef` 暂存门控命中的 poi(两处门控命中 `pendingFlyToRef.current = poi; return`)。
- geolocation settle 链抽 `settleGeolocation()`:三条出口(`!loc`/成功/失败)统一,先
  `setGeoSettled(true)`,再对暂存 poi 补飞 `flyToLocation`(zoom 16 / 600ms,与二次点击同口径)
  并清空 ref → moveend 后视口 loader 正常补拉目标视野,与第二次点击行为一致。
- `hasInteractedRef` 语义零改动;门控本身保留(仅「直接 return」→「暂存 + return」)。

**修改文件**:`server/src/components/map-shell.tsx`(pendingFlyToRef、settleGeolocation、
两处门控)+ 新测试 `server/tests/pending-fly-to.test.mjs`(6 契约)。

**验证**:459 pass / 0 fail(+6);typecheck / docs-check / git diff --check 绿。

## 2026-08-20: favicon IP 覆盖——裸 IPv4 careerUrl 不再全 🏢(boss 批次 w3)

**症状**:careerUrl 为裸 IPv4 host 的公司(浙江省发展规划研究院
`47.96.146.209:8111`)favicon 恒失败,marker 全 🏢 徽章。

**根因**:`faviconCandidatesFromUrl` 未识别裸 IP host,仍对 IP 请求 favicon 服务
(favicon.im 对 IP 域名 404,ADR-007 已实测)→ 解析链断在 favicon 层。

**修复**(`65ad2a6` / `4c17000` / `28c688d`):
- `IPV4_RE` 识别 + `DOMAIN_LOGO_MAP` 映射表(全库 grep 裸 IP 仅此 1 条:
  `47.96.146.209 → zdpi.org.cn`)+ 候选服务数组 `[favicon.im, icon.horse]`;
  `faviconCandidatesFromUrl` 对未映射 IP 返回空列表(不请求服务)。
- `resolveCompanyLogo` 链插入两层映射(site/company 层,在 favicon 层前,source='company')。
- 三消费组件 onerror 候选链:poi-card `CompanyLogo`、poi-detail `RecruitmentDetail`、
  map-markers 徽章(内联 `data-fb` JSON + onerror 依次切候选,全失败才 emoji)。
- seed 49 处 google s2 死链 `logoUrl` → `https://favicon.im/{host}?size=128`(grep 复核 49/49)。

**修改文件**:`server/src/lib/company-logo.ts`、`server/src/lib/seed-data.ts`、
`server/src/components/poi-card.tsx`、`poi-detail.tsx`、`server/src/lib/map-markers.ts`、
`server/tests/company-logo.test.mjs`(+7)。

**验证**:462 pass / 0 fail(+7)。⚠ `zdpi.org.cn` 映射值未联网复核(沙箱无 egress),
待 boss 复核;错误也只是多一次 404 → emoji 兜底,不破相。

## 2026-08-20: import upsert EXCLUDED 列引用歧义——import:seed:apply 必败(boss 实测)

**症状**:`npm run import:seed:apply` 必抛 PG 42702
`column reference "logo_url" is ambiguous`。

**根因**:`recruitment-import.ts` upsert SET 的 RHS
`COALESCE(EXCLUDED.logo_url, logo_url)` / 同 logo_emoji——DO UPDATE SET 的 RHS 表达式
对「目标表 + EXCLUDED」通用解析,未限定的 `logo_url`/`logo_emoji` 两边都有 → 歧义。
引入点 `d78e6f3`(2026-08-19 ws3「COALESCE 保既有 logo」);此后 import 一直 deferred
未跑,故未暴露。LHS 与 `EXCLUDED.xxx` 限定引用无问题;全库复核其余 EXCLUDED 引用
(`SET col = EXCLUDED.col`)均已限定,无同类问题。

**修复**(本 WS `3fe4377`):回退参数表限定为 `companies.logo_url` / `companies.logo_emoji`,
逻辑不变(保既有 logo 语义);契约测试同步改限定形断言 + 未限定形负断言(PG 42702 回归)。

**修改文件**:`server/src/lib/recruitment-import.ts`(:354-355)、
`server/tests/recruitment-import.test.mjs`。

**验证**:全量 npm test / typecheck / docs-check / git diff --check 绿;实跑 import 需
DB(工具禁跑),boss 合并后统一跑 `import:seed:apply` + audit 验证。

## 2026-08-22: 收藏 toggle 不再跳视角——相机动作与状态机移除(saved-layer-nofly)

**症状**:打开收藏图层时视角跳转——toggle 打开分支执行
`overlayBounds(overlayPois)` + `map.setBounds(收藏外接框)`(bbf1e91「fit its
pins」引入),相机被程序化移动 fit 到收藏点外接框。用户(2026-08-22)明确指示:
**打开/关闭收藏图层相机完全不动**。

**决策(用户指示,硬性)**:打开 = 只切换 pin 可见性(收藏点显示、普通 POI
隐藏)+ Explore 列表切「我的收藏」(互斥语义,2026-08-22 已落地);关闭 =
恢复搜索管线 pin 与列表,秒恢复(池只增不删,沿用可见性切换,不重查)。

**修复**(`fix/saved-layer-nofly`):
- **删相机动作**:`use-saved-layer.ts` toggle 打开分支的 `overlayBounds` +
  `map.setBounds` 与状态机置位全部移除——toggle 现在只做登录门控 → 写 pref →
  翻转状态;deps 移除 `mapInstance` / `savedCameraSyncRef`。
- **状态机退役**:「收藏相机同步」状态机(`lib/saved-camera-sync.ts`,ws1
  saved-overlay-wipe 结构性抑制,替代 500ms 时间窗补丁)的唯一输入源就是
  toggle 的 setBounds——输入源删除后状态机成为死代码,全部消费者一并移除:
  `use-work-viewport.ts` onViewChange 的同步消费/再导出、`map-shell.tsx`
  syncView 的 distance 圆心冻结与 ref 接线。消费者排查结论:无引擎切换/其他
  fit 调用等其余输入源,可整体移除。模块由 boss 合并时物理删除
  (`git rm`;worker 沙箱内曾降级为零导出退役桩)。
- **保留项**:「空批次不置空 catalog」加固(`use-work-viewport.ts` domain
  onBatch 空批次直接 return,独立于状态机)不动——toggle 不再产生程序化
  相机移动后该加固仍为通用空批次防护(滤波/层级裁剪导致的空页不清空)。
- **契约同步**:`tests/saved-layer-sync.test.mjs` 由状态机纯函数测试改造为
  no-fly 回归测试(语义镜像断言 setBounds/fit 零调用 + 源码契约 + src 全树
  零引用退役模块 + 模块已物理删除 + 保留项断言);hooks-contracts /
  component-contracts 中状态机断言按新语义更新(负断言)。

**修改文件**:`server/src/hooks/use-saved-layer.ts`、`use-work-viewport.ts`、
`server/src/components/map-shell.tsx`、`server/src/lib/saved-camera-sync.ts`
(由 boss 合并时 git rm 删除)、`server/tests/saved-layer-sync.test.mjs`、
`hooks-contracts.test.mjs`、`component-contracts.test.mjs`、`tech/16-bug-fixes.md`
(本节)。

**验证**:1149 pass / 0 fail / 2 skip(+no-fly 回归 6 项);typecheck /
docs-check / git diff --check 绿。历史文字保留(仅追加)。

## 2026-08-22: 收藏模式列表卡片化 + 历史点击冲突门控(saved-layer-card)

**症状**:① 收藏图层(互斥模式)下 Explore 列表 item 是 SavedList 简单行
(透明、12px、无玻璃),与普通模式 POICard 玻璃卡片观感断裂;② 收藏模式
(互斥)开启时,点击历史记录中的历史查询点与收藏模式功能冲突——互斥只落
显示层(visiblePOIIds/savedMode),搜索管线 load effect 零门控,`handlePickRecent`
无条件改 query/mode + 重拉 → 收藏开着时:搜索框=历史词 & 列表=收藏(a)、
实体详情越狱(b)、catalog 被替换且 mode 缓存组合「未存在过」(c)、overlayPois
按 mode 静默切换(d)。

**用户指示(2026-08-22)**:① 收藏图层下 Explore 列表 item 用原先的卡片样式
(普通模式 POICard);② 注意「收藏模式探索功能 vs 历史记录点击历史查询点」
的冲突。

**修复**(`fix/saved-layer-card`):
- **① 收藏模式列表卡片化**:savedMode 分支(桌面 secondary-sidebar 列表区 +
  移动抽屉)从 SavedList 换为 POIList + POICard(与普通模式完全相同组件与
  样式,玻璃卡片)。数据桥接 `savedPlacesToListPois`(`lib/saved-overlay.ts`):
  `savedItems.map(p => resolveSavedPoi(p, catalog) ?? savedPlaceToOverlayPoi(...))`
  ——活数据优先(compare-saved.ts:83-85),快照兜底(saved-overlay.ts:21-50);
  微调:带 origin 时按 haversine 补全快照 distance(卡片字段完整,与 SavedList
  对比表同口径),无坐标且无活数据的行丢弃(卡片必须有点位)。卡片右上新增
  「移除收藏」icon 按钮 = `POICard.onRemove` 可选 prop(不传则完全不渲染,
  零影响普通模式;32px 命中区、透明底 → hover 变调 #007AFF,aria-label i18n
  化「取消收藏 / Remove」),POIList 透传,桌面/移动都接 `handleRemoveSaved`。
  卡片点击沿用 `onPickSaved` 语义(活数据命中开详情)。收藏模式关闭对比表与
  无限滚动;对比表保留在账户页 SavedList(组件未删,仅不再被收藏模式消费)。
- **② 历史点击冲突门控**(方案 A,最小面):`handlePickRecent`(map-shell,
  桌面/移动共用唯一入口)开头加 `if (savedLayerEnabled) hideSavedOverlay()`
  再走原链路——点历史查询点 = 显式离开收藏视图开始新探索(与 toggle 未登录
  弹窗门控同模式,use-saved-layer.ts hide 路径)。不选 B/C(不加 load effect
  依赖、不拆 openDetail):避免副作用面扩大。deps 补齐
  `savedLayerEnabled`/`hideSavedOverlay`(hide 为 [] 依赖稳定回调)。

**契约同步**:`saved-layer-mutex.test.mjs` 桌面/移动互斥断言由 SavedList 更新
为 POIList + savedListPois(负断言:secondary-sidebar 不再动态导入/渲染
SavedList);`component-contracts.test.mjs` 移动抽屉互斥注释同步。

**新增回归测试**(`tests/saved-list-card.test.mjs`,10 项,jsdom 可测层:
本仓库无 jsdom 运行时,沿用「源码契约 + 语义镜像」模式):
- POICard `onRemove` 可选 prop + 条件渲染(不传零影响)、aria-label i18n、
  点击 stopPropagation → onRemove(poi)(语义镜像);
- 桥接纯函数实跑:活数据优先 / 快照兜底(recruitment 形态)/ 无坐标丢弃 /
  origin 补全快照 distance(活数据 distance 不动);
- `handlePickRecent` 门控:源码契约(门控位于原链路之前 + deps 含门控依赖)+
  语义镜像(开 = 先 hide 再回放;关 = 零门控直走)。

**修改文件**:`server/src/lib/saved-overlay.ts`(+`savedPlacesToListPois`)、
`server/src/lib/i18n.ts`(+`removeSaved` 键)、`server/src/components/poi-card.tsx`
(+`onRemove`/`RemoveSavedButton`)、`poi-card.module.css`(+`.removeBtn`)、
`poi-list.tsx`(+`onRemove` 透传)、`secondary-sidebar.tsx`(savedMode 分支 →
POIList,移除 SavedList 动态导入)、`map-shell.tsx`(桥接 memo + 移动抽屉 POIList
+ handlePickRecent 门控)、`tests/saved-list-card.test.mjs`(新)、
`saved-layer-mutex.test.mjs`、`component-contracts.test.mjs`、`tech/16-bug-fixes.md`
(本节)。

**验证**:1159 pass / 0 fail / 2 skip(+saved-list-card 回归 10 项);typecheck /
docs-check / git diff --check 绿。历史文字保留(仅追加)。

