# Changelog

Dates are UTC+8. This file tracks shipped work on `feature/phase-2-multi-mode` and later. It is not a substitute for `tech/05-milestones.md`.

## 2026-08-21

### Added

- **腾讯 WebService 第三级兜底(AMap→百度→腾讯,`feature/geocode-tencent`).** `site-geocode.ts` 三入口(地址 geocode / 地点搜索 / regeo)在高德日配额(10044/10043)或百度日配额(302)双耗尽后自动切腾讯(`TENCENT_MAP_KEY`):新增 `tencentGeocodeAddressRest` / `tencentPlaceSearchRest` / `tencentRegeoCityRest`(ws/geocoder/v1 + ws/place/v1/search,原生 GCJ-02)+ `fallbackChain` 链式 helper 收敛兜底分支;腾讯个人开发者每接口 10000 次/天、5 QPS。错误码分类(真实探测校准):121/321/322 每日上限归配额类短路、120 每秒限流重试一次、110/112/190/199/311 配置永久失效归短路(缺 key→301、错 key 格式→311、缺参→404,均与预设无冲突)。`geocode-sites-apply.mjs` 接 env 注入/DRY_RUN 判定/节流 provider 感知(百度 600ms、其余 340ms)/REPORT 三 key 状态。测试 +12(全量 549:547 pass / 2 skip)。
- **geocode 双配额耗尽短路(`fix/geocode-quota-short-circuit`,`3d51d7a`+`808414a`+`89103b3`,merge `83fc6d0`).** 配额类失败(`quota` / `baidu-status:302` / `no-key`)连续 5 站 → 提前停止(`QUOTA_EXHAUSTED` 行 + exit(2));成功解析/非配额失败冲窗口防误停(401/http/间歇性可重试不误伤);7 新用例(全量 520:518 pass / 2 skip)。同日 `4b05e64` 写入 20 家公司站点坐标(2026-08-21,配额耗尽前完成)。报告 `tech/roles/development/parallel-sessions/20260821-boss-geocode-quota/`。
- **place-text 结果缓存(`fix/geocode-place-memo`,`4ffebe6`+`a41e5e1`+`64e8be6`,merge `9d5ed19`).** 同 (query, province, city) 进程内复用,只缓存成功命中(失败/空结果/配额类/低置信度一律不写);10 新用例(全量 530:528 pass / 2 skip);同城多站点实例调用削减 97%+(安克创新 38→1 / 元气森林 71→1 / 小鹏 52→1)。报告 `tech/roles/development/parallel-sessions/20260821-boss-geocode-memo/`。
- **全量计数输出修正(`fix/geocode-plan-count`,`e5cd04d`+`fa5f854`,merge `6737a6b`).** 只读预扫统计过滤前全量 `planTotal`;配额短路后剩余 = planTotal − resolutions − unresolved − skipped(旧口径短路后恒为 0,误导);8 新用例(全量 536:534 pass / 2 skip);实跑:1783 站待 geocode、attempted 5、剩余 1778 如实报告。报告 `tech/roles/development/parallel-sessions/20260821-boss-geocode-count/`。
- **腾讯文档官方招聘源 142 家入库(`feat/qqdoc-official-source`,merge `1ec3fff`).** qqdoc-official 适配器 + 礼貌官网地址提取(壳 HTML → 官方招聘 URL + 城市/街道地址,`extract-qqdoc-addresses.mjs` / `official-site-parse.ts`),142 央企/银行/国企 drops(name + 官方招聘 URL),19 家城市+街道地址提取、50 家 `city_pending` 待后续;19 用例(全量 568:566 pass / 2 skip)。采集仅礼貌 GET + robots(RFC 9309 重定向跟随)。Docs:`tech/roles/data/etl/qqdoc-official.md`;报告 `tech/roles/development/parallel-sessions/20260821-boss-qqdoc-official/`。

## 2026-08-20

### Added

- **zhiye(北森 italent `*.zhiye.com`)ATS 适配器 + feishu 租户扩充(national w2,`feacd10`+`bf68d37`+`7d50d21`,merge `cebdc8e`).** 三步探针(壳 HTML → SPA bundle → API 端点探测)固化为运行时流程,`cli.py` 新增 `zhiye` 子命令,`FEISHU_TENANTS` 24→28(英科医疗/真格基金/原力灵机/算秩未来);37 个 fixture 驱动单测(server 全量 500 pass / 2 skip;crawler pytest 103 全绿,boss 复验)。采集未执行(Env E3 留给 boss/用户)。Docs:`tech/roles/data/etl/zhiye-ats.md` / `feishu-ats.md`;报告 `tech/roles/development/parallel-sessions/20260820-boss-national-data/reports/w2.md`。
- **南京/西安 drops 增量并入(boss E1,`45bd9fa`).** 16 新公司 + 74 站点 + 83 岗位,externalId 跨城重写;dev@45bd9fa 门禁全绿。
- **飞书 28 租户采集合入(`a8a9df7`).** 4 新租户 + 岗位刷新,import 计划 11602 岗位 0 dropped。

### Changed

- **Next.js 15.5.23 → 16.3.1、React/ReactDOM 19.0.8 → 19.2.8(清 version-staleness 警告,`chore/next-16`).** 依赖升级由 boss 预置(`server/package.json`/`package-lock.json`),本批仅修破坏点:实际**零代码改动**——`npm run typecheck` 0 错误、`npm test` 488(486 pass / 2 skip)、`npm run build`(Next 16.3.1 + Turbopack)21 路由全部产出。Next 16 自动迁移两项:tsconfig `jsx: preserve → react-jsx`(强制)与 include 增 `.next/dev/types/**/*.ts`;`next-env.d.ts` 按新 typed-routes 格式重生成(`import` 替代 `/// <reference path>`,新增 `root-params.d.ts`)。项目无 middleware / 无 ESLint 配置 / next.config.ts 仅 `reactStrictMode`,均无需迁移。报告:`tech/roles/development/parallel-sessions/20260820-boss-bugfix/reports/b3.md`。

### Fixed

- **work 全量加载(首点刷新 / 聚合计数漂移 / 死代码清理,`933f972`,`fix/poi-zoom-full-load`).** work 视口加载原以 geolocation settle 为门:首点触发定位完成 → 依赖变化取消在飞加载并重载,首帧 `syncView()` 又被视口对齐拉回杭州。现改**全量加载**(`WORK_FULL_LOAD_MAX_PAGES=10_000`,不传 bounds/maxTier,page 恒 1;侧栏列表客户端按 `mapBounds` 裁剪,浏览器实测平移 0 视口请求),`load()` 门控仅 `mapReady`——首点详情立即打开、视角保持。聚合计数取消 LOD(tier)过滤(徽章 N 与 zoom 无关),「杭州市」/「杭州」归入同一徽章。死代码清理净删 566 行(视口增量加载 / 首点 flyTo 队列 / 视口搜索堆栈 / marker 同步注册表等)。`MODE_CACHE_VERSION` 14→15。14 文件(server/src 9 + tests 5);全量 488 通过(486 pass / 0 fail / 2 skip)。Docs:`tech/16-bug-fixes.md` §2026-08-20、`tech/21` 计数口径。
- **positions import 自愈去重(先删重后迁移,`788e9c6`,`fix/positions-dedup-order`,b1f).** 同 `external_id` 在旧 source(seed)与新真实 source 下各存一行(upsert 唯一键 `(source_id, external_id)`,source 变了就插新行、旧行不删)→ poi-card 同 key 警告上百条。修复:apply 事务内先按 `external_id` 保 `MIN(id)` 删重(applications.`position_id` 多指向旧行,保留最早 id 避免悬空),再迁移旧 source 行到本次 source,后照常 `ON CONFLICT` upsert;顺序不可颠倒——先迁移会让同 `external_id` 的旧/新行共享唯一键,UPDATE 内即触发 `positions_source_id_external_id_key`(`_bt_check_unique`)导致整个事务回滚(boss 实测:重跑 `import:seed:apply` 报唯一键冲突,DB 未变)。契约测试断言 dedup-before-migration 顺序(`server/tests/recruitment-import.test.mjs`)。
- **LOD 徽章计数一致性(optimize w1,`b178cb0`,`fix/cluster-consistency`).** `cityLabelMatchesCoordinates` + LOD 徽章计数口径统一(聚合徽章不再随 zoom 漂移)。
- **首点 flyTo 延迟(optimize w2,`fe2aee9`,`fix/poi-first-locate`).** `pendingFlyToRef` 推迟首点飞行,消除定位/首点交互竞态。
- **logo 覆盖(optimize w3,`3632fa3`,`feat/logo-coverage`).** IP host favicon 映射 + icon.horse 兜底,`s2` 失效链接清理。
- **data 代码覆盖率(optimize w5,`da754ed`,`feat/data-code-coverage`).** 704 drops source 全覆盖 + `CITY_CENTERS` +15 + radar 十城 + `city_site_id`。
- **import upsert 歧义(optimize f1,`f13fbb6`,`fix/import-upsert-ambiguity`).** `INSERT … ON CONFLICT` 加 `EXCLUDED` 限定 + `MODE_CACHE_VERSION` 13→14。
- **公司 POI 屏闪(bugfix b2,`8837fe9`,`fix/marker-stability`).** marker 只增不删 + `setVisiblePOIs`,消除重渲染闪烁。
- **`/api/pois/[id]` 双重解码 500(scan ws-api,`0efa878`,`fix/poi-id-route`).** 双重解码 500 修复 + id 长度上限 400。
- **radar 双 https 前缀(scan ws-data,`32fadaf`,`fix/radar-double-https`).** drops 前缀修正 + import 校验器 URL scheme 断言。
- **map-shell 收藏图层 hook 抽取(scan ws-frontend,`19139bd`,`refactor/map-shell-hooks`).** `useSavedLayer` 抽 hook 降复杂度。
- **POI 首点点击相机消失(poi-vanish,`cd360dd`,`fix/poi-first-click-camera`).** 首点 pin/卡片点击不再抑制 geolocation settle 相机跟随(`hasInteractedRef`→`userMovedMapRef`,仅相机手势与 5 个 flyTo 入口置位);`handleLocate` 失败保持视野不回杭州默认中心;distance 圆心在定位前不落默认值(`effectiveFilters` 剥离 distance 键)。
- **地图 remount 相机恢复(poi-vanish2,`5fd4c2f`,`fix/map-remount-camera`).** createMap 初始相机改用 state(`DEFAULT_MAP_CENTER`/`DEFAULT_MAP_ZOOM` 常量)+ settle 仅默认中心附近时飞用户位置(`isNearDefaultCenter` 0.1 度阈值);新增 camera-center 契约测试。
- **dev 冷启动首点整页刷新(rail-prefetch,`51c0406`,merge `d61e720`).** 挂载时预载 rail 面板 chunk。
- **settle 自动定位「用户已交互」门控(rail-settle,`863f7f2`,merge `870af90`).** 门控由「双门控」扩为「三门控」(`!userMovedMapRef.current && !userInteractedRef.current && isNearDefaultCenter(...)`),消除首点整幅跳变;浏览器实测留给 boss VERIFY。
- **事故坐标清扫(national w1,`460867b`+`f389d1b`,merge `ecef347`).** 115 个非杭州事故站点坐标(49 文件:46 radar + 3 official)删除——任务字面「清为 null」与 importer 契约冲突(`lng: null` 判 invalid),改为删键(偏离字面,报备);防回归契约 4 用例;全量 504 pass / 2 skip。DB 侧坐标清扫留待 boss 裁决。
- **zhiye job_city 归一 + 分页到 total(national w3,`f078359`,merge `3da1c8e`).** 城市文本归一(「上海市浦东新区」→「上海市」);已知 total 时翻页到 `len(jobs) ≥ total`(短页兜底不再提前停);crawler pytest 103 全绿。
- **BAIDU_MAP_AK 注入(`0b7c1da`).** AMap 配额耗尽时百度兜底可触发(process.env 注入)。
- **geocode fetch 20s 超时守卫(`ca54ce7`).** 防挂起代理连接。
- **geocode 地址-城市一致性闸门(national w4,`2992fb4`+`e37cb7d`,merge `de7ab7e`).** 跨市地址(杭州地址落在广州/成都/北京站点)在地址检索前拦截 → 改公司名检索;regeo 区级校验兜底;7 新用例(奇安信回归);全量 511 pass / 2 skip。

## 2026-08-19

### Added

- **boss-agent smoke**(端到端验证)。

### Fixed

- **移动端二级卡片交互(`fix/mobile-card-interactions`)。** ① 详情返回后滚动位置保留:`.drawerContent`
  挂 ref 存 `scrollTop`,移动端卡片打开详情前保存,返回时 `useLayoutEffect`(key=`detailPoi`)
  在重挂载后恢复;模式切换/新搜索/刷新/桌面详情路径清零保存值。② 点卡片边缘空隙取消选中:
  `POIList` 新增 `onDeselect` prop(仅移动端传,桌面 secondary-sidebar 不传),
  `.cardSlot` + `.list` 容器接 onClick,`poi-card` 卡片 `<article>` onClick 加 `stopPropagation`
  不冒泡触发取消;取消时清 `selectedId` + `highlightedId`。测试:+3(该批;全量基线 423 通过 / 0 失败 / 2 跳过,2026-08-19)。
  Docs:`tech/16-bug-fixes.md`。
- **工作模式 poi 列表不随视角刷新(Bug 7,`fix/viewport-refresh`).** 工作视口刷新原为
  **增量合并**(`loadWorkViewport` 传 `existing: catalogRef.current`):工作目录仅 ~79 家公司,
  首屏+加载更多几乎全捕获 → 刷新返回 0–11 家全部被 `mergePoisById` 去重,`setCatalog` 不变,
  列表冻结。现镜像 domain 分支改为**替换**:`existing: []` 按 live bounds 取新一批、
  `viewportEpochRef += 1` 丢弃在飞主加载的旧视野追加批次、`setPageOffset(0)` + skipFetch 武装、
  视口替换时复位 noMore(与 w3 noMore 判定对接)。另修复主加载在飞时视口刷新被静默丢弃:
  `loadingRef.current` 在飞时置 `viewportRefreshPendingRef` 标记,主加载 `finally` 释放后补跑
  `viewportLoaderRef.schedule()`(防抖合并,不引入重复加载竞态)。domain 视口刷新(替换+淡入)
  行为不变。Docs:`tech/22-hangzhou-poi-local.md` §视口变化刷新。
- **`portal-megvii-campus` 官网入口移除（用户拍板，B2.1 同型追加）。** megvii-hangzhou 的「校园招聘(官网投递)」入口与已删的 `portal-megvii-social` 同型（warn 非 fail）,drop 对象删除 + DB 行删除（SELECT 确认）;该文件只剩真实岗位「前端开发工程师(2026 秋招)」。全量统计 813 → 812 条（下次全量校验落数）。记录:`fix-plan-20260817.md` / `data-quality.md`。

### Changed

- **移动端抽屉 chrome(`fix/mobile-drawer-chrome`).**
  - 全开抽屉高度从 `86svh` 拔高到**顶边=指南针中心**:CSS `.drawerFull`/`.mobileDrawer max-height` 同步为 `calc(100svh - max(12px, env(safe-area-inset-top)) - 20px)`;拖拽全开阈值从 `vh*0.86` 改为同口径 `vh - (max(12, safeAreaTop) + 20)`(safeAreaTop 在 pointerdown 用探测元素实测 `env(safe-area-inset-top)`),松手 snap 不再回弹错档;`.drawerHalf`/`.drawerMini` 不变。
  - **全开隐藏指南针+比例尺**:`.topTools`(指南针 + 移动端定位按钮)在 `drawer==="full" || !!detailPoi` 时挂 `topToolsHidden`(opacity/visibility 过渡 200ms);`AMap.Scale` 提升到 `scaleControlRef` 由 effect 显隐,插件异步/resize 重建时同步初始态。
  - **移动端新增「显示用户当前位置」按钮**:`.topTools` 指南针正下方,同款 `.toolButton` 40×40 + `box-shadow:var(--shadow)`,复用 `handleLocate`/`Icon name="locate"`/`t("locateMe")`;桌面端 `@media (min-width:768px)` 隐藏(右下角已有 `.mapControls` 定位按钮)。
  - Docs:`tech/07` 抽屉/工具组/比例尺节、`tech/16` 本批问题与方案。

## 2026-08-18

### Added

- **Parallel role skills** (`.claude/skills/main-agent|workstream-agent|merge-agent`): a fresh Claude session picks its role in a parallel batch by triggering a skill. `main-agent` decomposes goals into workstreams and writes per-workstream prompt files; `workstream-agent` develops in its own worktree and writes a report (never merges); `merge-agent` reads the batch manifest + reports and runs the parallel-development merge orchestration. Batch directory convention: `tech/roles/development/parallel-sessions/<YYYYMMDD>-<slug>/` (`README.md` manifest, `prompts/<ws>.md`, `reports/<ws>.md`, `merge-report.md`). Docs: `agent.md` §0.5, `tech/04-workflow.md` "Parallel role skills", `CLAUDE.md`.
- `SearchSuggestion.distance` (meters) + optional `center` param on `GET /api/suggest`; company rows use site coordinates. Client recomputes against the live origin (user location / map center) for freshness.
- Suggestion rows render kind-based icons (place 📍 / company 🏢 or logo emoji / job 💼) and right-aligned grey 12 px distance on desktop (`secondary-sidebar.tsx`) and mobile (`map-shell.tsx`); the API's previously unused `icon` field is wired through. Layout L3 approved 2026-08-18.
- Tests: domain suggest route contract, `loadHzPoiSuggestions` (prefix SQL + clamp + DB-error fallback), client LRU empty-result behavior, updated component contracts. 283 pass / 0 fail; docs `tech/22-hangzhou-poi-local.md` §搜索建议.

### Changed

- **工作/地图模式筛选精简 + 距离/价格范围放宽 (`feature/filter-refine`).**
  - 工作模式移除 `industry` / `district` / `providesShuttle` 三个筛选卡（`modes.ts` `WORK_FILTERS`）；后端匹配器保留，供 API / 历史筛选回放。对应 `#互联网` / `#西湖区` / `#班车` 标签退化为普通关键词（不再产生隐形筛选）。
  - 距离上限 10→50km、步长 0.5→1：`modes.ts` `DISTANCE_FILTER` 与 `search.ts` `DISTANCE_SLIDER` 两处同步（后者供距离环拖动吸附，map-shell 消费）。
  - 地图模式移除 `district`；`minRating` 由单头 slider 改为双向「评分区间」range `[lo, hi]`（旧数值仍兼容作下限，`filter-panel` RangeControl 渲染）。
  - 人均消费 max 500→5000、step 50→100；匹配映射从 `priceLevel*50`（封顶 200，上限拉高后高档位被误滤）改为档位中点 `priceLevel→[50,200,800,3000]`，且 hz 本地 / AMap 读路径带真实 `cost` 时优先用真实值（`DomainPOI.cost` 新增，`amap-api` / `hz-poi-store` 两条转换同步填充）。
  - 地图模式默认按距离排序：`defaultSort='distance'` 端到端生效，`sortOptions` 把 `distance` 排到第一位。
- **双头滑块端点错位修复 (`filter-panel.tsx` `RangeControl`).** 根因：两个原生 range input 原先动态钳制边界（min input `max={hi}`、max input `min={lo}`），拇指几何按各自 [min,max] 定位而 fill 按全局 [min,max]，区间收窄时错位。修复：两个 input 均用完整 `min`/`max`，互不越界在 onChange 钳制（原 clamp 逻辑不变）。
- **Profile 二级卡片大改 (`feature/profile-redesign`, WS-U4).** `ProfilePanel` 重构为 L4 inset grouped 分组圆角卡(同一组件同一样式,桌面 380px 卡 + 移动端 sheet 嵌入):
  - 身份卡:头像(点击仍走 `AvatarCropper` 裁剪)+ 名字 + 账号「· 已登录」;头像缩小为 64px 居中英雄区。
  - 「账户」组:编辑资料(展开内联编辑:显示名 + 更换/移除头像 + 蓝色保存,复用 `PATCH /api/auth/me`;`avatarUrl` 传原值含空串,清空即保存)、密码与安全 / 手机与邮箱(demo 占位,点击弹「演示模式」toast,2.6s 自动消失)、退出登录(复用 `DELETE /api/auth/me` 与 `handleAuthAction`,桌面 + 移动都接线)。
  - 「偏好 / 求职偏好 / 通知 / 收件箱 / 我的投递」按 L4 分组保留原功能;偏好与通知改动即时后台 PATCH 持久化(不再依赖手动保存)。
  - 行高 46px、右侧 ›、inset 分隔线(14px 内缩)、SF Symbols 风格描边图标(与 map-shell `Icon` 同一套 viewBox 24 / stroke 2 / round 风格,本地化到 `account-panel.tsx`)。
  - 主题对齐:保存按钮由绿改蓝(`--blue`);深色/浅色 + `prefers-reduced-motion` 适配。桌面侧控栏 `authGlyph` 保留(签名状态快速入口,卡片内退出登录为新增)。
- **Mobile drawer follow-finger physics (`feature/mobile-drawer-physics`).** The bottom drawer (mini `96px` / half `42svh` / full `86svh`) now follows the finger on the grabber: `pointerdown/move/up` with pointer capture writes inline `height` (px) every move under a `.drawerDragging` class that disables `transition`, so the panel tracks the gesture with zero easing lag; CSS `min/max-height` acts as the bounds. On release a position + velocity state machine decides the detent — upward fling (>900 px/s) → `full`, downward fling → `mini`, slow drag → nearest detent by height midpoints — and content visibility follows the finger across detent boundaries (mini shows search only). Content-stack pops are preserved and velocity-aware: detail/JD pulled past the half-way point (or flung) closes to its previous level, non-explore sheets fling back to explore. The snap animates with `cubic-bezier(0.32, 0.72, 0, 1)` over `0.32s` via a rAF hand-off that releases the inline height to the CSS `svh` classes; `prefers-reduced-motion: reduce` snaps instantly. Taps (≤8px) keep the original cycle/back `onClick`; real drags suppress the click. Desktop (≥768px) unaffected — the drawer is hidden there. Docs: `tech/07` drawer interaction section updated to the live gesture contract.

### Fixed

- **LLM 校验 10 条 fail 数据修正（B2.1，`fix/b2-1-validation-fails`）.** 用户已批准 `tech/roles/data/fix-plan-20260817.md` 方案并全量执行（2026-08-17 首跑 817 条:82 pass / 724 warn / 10 fail / 1 error）:
  - **移除 4 条**（整个 position 对象删除）:`radar-c08140d30e81`（博世智能驾控，问卷星投递硬伤）、`radar-732fce657587`（学而思网校，标题=城市列表）、`portal-megvii-social`（megvii 官网入口）、`portal-tigermed-moka`（tigermed 官网入口）。
  - **修正标题 3 条**（仅 title）:`radar-52e776ddb58f` →「暑期实习(咨询顾问方向)」、`radar-a6a104980035` →「实习生(研究/投行方向)」、`radar-e49ce7364a1a` →「攻防渗透工程师」。
  - **标注聚合 3 条**（补 `aggregate: true`）:`radar-ce7419500bcc`（度小满）、`radar-cf5a954e8f78`（曼伦）、`radar-a72738f8085f`（申万宏源研究）。
  - **DB 清理**:`positions` 表删除 2 行（博世/学而思不在 DB）,删除前已 SELECT 确认。
  - **全量重跑（2026-08-18）:813 条 = 86 pass / 718 warn / 8 fail / 1 error**。修正的 3 条 titleReal 全部翻 true;讯飞 `radar-b871edcdf925`（原 error）被覆盖为 warn;C 组标注聚合行按预期仍可能 fail/warn（标注即交付物,不改标题不修校验器）。剩余 8 fail 为同类「招聘计划/专项/入口名」标题,留待后续拆解/决策;剩余 1 error 为腾讯 `radar-302c5ea36a84`（LLM 空响应,与本次数据修正无关,下次全量自动覆盖）。
  - 报告 `tech/roles/data/validation-report-20260818.json`（gitignored）;统计同步 `data-quality.md`。
- **筛选相关测试同步新范围/新筛选（`search-logic` / `search-integration`）.** `metersToDistanceKm` 吸附断言按 step 1 / max 50 更新；price 档位中点映射与真实 cost 优先各有新断言；`minRating` range 与旧数值兼容覆盖；work filter-options 契约断言移除 industry/district/providesShuttle 并锁定新范围。
- **Search suggestions (autocomplete) — candidate list never landed / clicks did nothing (`feature/suggest-fix`).** Four verified causes, all fixed:
  1. Suggest effect deps `[query, mode, zoom, catalog]` — `catalog` replaces on every batch (hz-poi Stage 4) and `zoom` on every pan, so the 200 ms debounce timer was reset before firing; candidates never rendered. Deps narrowed to `[query, mode]`; `zoom`/`catalog` read via refs.
  2. Empty suggest results were cached (client LRU 5 min + server 30 s) — a first empty result went "dead", blocking the domain local→AMap fallback. Only non-empty responses are cached now.
  3. Clicking a suggestion whose company was in the server catalog but not yet loaded client-side did nothing (`handleSelectSuggestion` searched only the local catalog). Work mode now fetches `/api/pois/[id]?mode=work` and opens the detail; domain rows open the loaded rich card when present, else upsert a session card from `location`.
  4. Domain suggestions went straight to AMap AutoComplete; the route's domain branch iterated the tiny `DOMAIN_SEED` (dead code). `/api/suggest?mode=domain` now queries `hz_pois` first (name ILIKE prefix, `adname` subtitle, GCJ location, optional `distance` from `center=lng,lat`); 0 hits / no DB → empty list → client falls back to AMap AutoComplete once, failures return empty without hanging.

### Fixed

- **公司 POI 与地图 POI 混合展示(视口批次跨模式污染,`fix/poi-mixing`).** 视口加载器(moveend/zoomend 防抖)的 `onBatch` 缺模式守卫:工作模式的在飞批次在切换模式后落进 Domain 的 catalog,列表出现公司卡、地图出现公司徽章;被污染的 catalog 又经模式切换写入 sessionStorage 缓存,跨会话粘住(「经常」的根因).修复:新增 `batchMatchesCurrentMode` 模式守卫,主加载 + 视口加载的工作/Domain 四处落库点统一校验;`MODE_CACHE_VERSION` 5→6 使已污染缓存失效.复现/根因/修复详 `tech/roles/testing/test-reports/bug-reports.md`.

### 产品口径确认(2026-08-18,未改数据语义)

- **无岗位信息的公司只作为地图 POI;有岗位信息的公司才作为公司 POI。** Domain 模式
  杭州内 zoom ≥ 5 浏览时,本地 `hz_pois` 返回的 `big_type='公司企业'` 类 POI(如「恒彩
  家装集团(总部旗舰店)」)是「地点」,按地图 POI 展示,不过滤、不升级——两条闸门
  (`withAlivePositions` 只保留有活岗公司)当前均已满足。带岗位的公司(工作目录)在公司
  POI 语境(工作模式)展示;其同名 hz_pois 地点在 domain 语境仍是地图 POI。

## 2026-08-17

### Added

- **Hangzhou POI localization (`feature/hz-poi-local`, Stages 1–4).** AMap quota (10044) hit on 2026-08-17 made the browser 36-call PlaceSearch viewport refresh untenable. User's 1,006,185-row Hangzhou POI export (authorized, photos included) now lives in `hz_pois` (migration `013`): GCJ-02 geom (zero-conversion, matches AMap tiles), tier 0..21 visible-min-zoom mapping (noise classes hidden at 21), idempotent staged import (`server/scripts/import-hz-pois.mjs`, `npm run import:hz:pois:apply`, re-run keeps count 1,006,158). Read path `GET /api/pois/domain-local` (bbox + zoom tier + ILIKE + big_type, common-filter pushed down, rating/photos order, 30s cache). Frontend forks on `inHangzhouBox`: in-HZ browse = local 50/batch infinite scroll capped 1000 (IntersectionObserver sentinel, 「已达加载上限」); in-HZ keyword = local first, AMap 1-call fallback on 0 hits; out-of-HZ = AMap fallback 1 call (25) per scroll, failures return 0 without hanging. UI per user spec: viewport-change replace+fade refresh (800ms debounce), load-more button removed, refresh button only at 0 cards, top counter removed (bottom sentinel text only). Docs: `tech/22-hangzhou-poi-local.md`, `tech/roles/data/etl/hangzhou-poi.md`, `data-sources.md` register row.

- Guest Recent in the browser: persistable (work/internship) queries write `dm.guest-search-history.v1` (cap 30). Sign-in merges rows the account does not have and keeps a local mirror; sign-out restores. `lib/persistable.ts` is the extension seam (`PERSISTABLE_MODES`; add `college` when that catalog lands).
- Saved + Recent persist only recruitment catalog POIs. Domain AMap bookmarks are hidden; `POST /api/me/saved` and `POST /api/me/search-history` return 400 `NOT_PERSISTABLE` for non-persistable rows.
- Map-mode suggestion pick upserts a session `DomainPOI` (`suggestionToDomainPoi` + `mergePoisById`) so a card exists. Empty search boxes no longer render trending tags (Recent L2 still does).
- Login: Other = GitHub / Google / WeChat icon rows (X removed); mobile hides the promo and spaces method tabs with vertical dividers. Drawer handle gap unified via `--drawer-handle-gap`.
- Real recruitment data: `crawler/app/domain_map_importer/` — polite acquisition (`acquire.py`: robots + blocked commercial hosts; `html_jobs.py`: JSON-LD then link fallback; `radar_jobs.py`: maps the published Apache-2.0 `jobs.json`; `official_refresh.py`; `cli.py`). Server `radar` adapter + `mergeCompaniesIntoPois`; offline catalog filters ungeocoded sites (no (0,0) pins). Drops: `server/data/recruitment/radar/` (98 companies / 125 jobs) + curated verified official portals (betta / megvii / deepseek). Import plan now 137 companies / 240 positions. Source reviews: `tech/roles/data/etl/`; evidence: `tech/roles/data/data-quality.md`. `make refresh-radar` / `make crawl-official`.
- Freshness presentation proposal (awaiting approval): `tech/17-freshness-presentation-proposal.md`.
- Parallel-development principle (worktree-first, user-stated): always develop in a git worktree cut from `dev` (`feature/` / `fix/`), merge back to `dev`; subagents each own a worktree. Persisted in `CLAUDE.md` (new always-on instruction), `agent.md`, `tech/04-workflow.md`, `.claude/skills/parallel-development/SKILL.md`, and project memory.
- **dev sync (2026-08-17):** `feature/phase-2-multi-mode` merged into `dev` (fast-forward, no conflicts) — all of Phase 1/2 now lives on `dev`; new work cuts `feature/` / `fix/` branches from `dev`.
- **National-scale plan + parallel workstreams (2026-08-17):** `tech/18-national-scale-plan.md` records the architecture decisions — D1 (Domain mode calls AMap API directly, no POI import; work mode is nationwide, pre-crawled into Postgres), A1 (only live real positions show), B1 (company↔site↔position authenticity, LLM concurrent validation), D2 (pre-crawl 北上广深成都武汉 first). Four parallel agent sessions defined with file boundaries + merge order: `tech/roles/development/parallel-sessions/` (ws1 national-db-schema / ws2 multi-city-data / ws3 llm-validation / ws4 work-viewport-lod).
- **WS1–4 merged to `dev` (2026-08-17, `4ea0c79`..`12c00df`):** national DB schema + read paths (migration `011`: `companies.tier` / `company_sites.province`/`city_code` / `geom_geog` gist / alive partial index), multi-city radar drops (630 companies / 761 jobs, per-city sites, aggregate flags), LLM validation script (`server/scripts/validate-positions-llm.mjs`, env `LLM_API_KEY`/`LLM_MODEL`/`LLM_BASE_URL`, dry-run without key), work-mode viewport loading + LOD + client alive filter. Zero manual merge conflicts; gates green at every step.
- **Tier model rework + company category (2026-08-17):** `tier` is now the visible-min-zoom 0..21 (`lod.ts` identity mapping `maxTierForZoom(zoom)=floor(zoom)`; 0=always visible, 21=never, default 12; SQL `tier <= zoom` unchanged; migration `012` replaces the `1..3` CHECK). New `companies.category` = national-standard GB/T 4754-2017 industry class code (`text`, default `'other'`). Labeling guide + dev plan: `tech/19-company-labeling.md` / `tech/20-development-plan.md`. `isAlivePosition` consolidated into `lib/position-alive.ts` (was duplicated in `freshness.ts`).
- **Company labeling, all 668 drops (2026-08-17):** tier (0..21) + category (GB/T class) for every company — 28 hand-approved anchors + 5 parallel shard labelers, QA-gated (`server/scripts/qa-labels.mjs`: coverage / value ranges / anchor bands / variant consistency; drift unified: 京东/美团/拼多多/比亚迪/百度 → national 4-6). 30 GB classes hit, `other` only 8. Tools kept: `apply-company-labels.mjs` (idempotent write-back), `split-aggregates-report.mjs` (696 aggregate-row split plan). Import plan unchanged: 669 companies / 1440 sites / 877 positions, 0 issues.
- **LLM validation full run + verdict fix (2026-08-17):** 817 items validated with user's DeepSeek key: 82 pass / 724 warn / 10 fail / 1 error. Fixed `verdictLevel`: aggregate rows are warn, not fail (first run misjudged 692 catalog titles as fake). 10 real fails await user decision (`tech/roles/data/fix-plan-20260817.md`).

### Fixed

- **Hangzhou POI search/cache deadlocks (`d127ec2`):** mode-cache early-return guard ignored `query` — searching any new keyword while a cached catalog existed returned 0 results with **no request ever sent** (now `query === cached.query` required). Cancelled in-flight loads never released `loadingRef`, deadlocking all subsequent loads (now released unconditionally in `finally`; state updates still gated on the signal).
- **Sparse-viewport sentinel spin (`8822a01`):** with <1000 matches (or the AMap fallback window exhausted), every scroll issued a request that added 0 rows and the IntersectionObserver sentinel spun forever. A `noMore` flag (round added nothing and there was prior data) now stops the sentinel with 「── 没有更多结果 ──」, distinct from the 1000-cap text; reset on viewport replace, mode switch, and session-cache restore (`e7323c7`).
- **Removed fossil budget constant `AMAP_FALLBACK_MORE_CALLS=4`** (`e256339`): superseded when the per-scroll budget settled at 1 PlaceSearch call (25 items); dead import + test assertion dropped, stale comment corrected.
- **Work mode shows real data only (2026-08-17 decision).** Example jobs (seed / official-career curated titles like "前端开发工程师（2026 秋招）") are development scaffolding: `isAuthenticPositionId` keeps only `radar-*` / `portal-*` positions on every read path (offline catalog, DB read, client fallback). The seed still supplies the coordinate skeleton; DB example rows were marked `closed` (reversible). Map surface: 51 → 14 pins, all with real recruiting signals.
- Merge-on-sign-in wiped rows whose POST failed; now only rows absent from the account upload, and failed rows stay local. Merge logic extracted to `mergeGuestHistoryIntoAccount` (unit-tested).
- Persisted signed-in sessions now merge leftover guest rows on mount, not only after the auth modal.
- `mergeCompanyOntoSeedPois` no longer appends a new site's positions twice; `zhejiang-lab` site id corrected to `{slug}-site` per the merge rule.
- DB read path pinned ungeocoded sites at (0,0); `loadWorkCatalogFromDb` now filters them (matches the offline path). Verified over HTTP: 51 coordinated pins, 0 (0,0).
- `import:seed:apply` crashed on radar deadlines like "招满即止" (`positions.deadline` is a date column); `parse_deadline` (crawler) + `normalizeDeadline` (import) now emit ISO dates only. **Live DB import succeeded: 137 companies / 137 sites / 240 positions.**
- Polite fetcher survives transient SSL/network errors and a misspelled page charset; `parse_robots` follows RFC 9309 (specific UA group wins, Allow tiebreak). Stale `betta-hangzhou` careerUrl fixed.
- Desktop rail search used a static placeholder; now mode-specific (`modeConfig.searchPlaceholder`). 11 dead i18n keys removed.
- Reserved `college` / `overseas` modes return empty trending instead of borrowing work queries.

### Measured

- `npm run test:coverage` (Node built-in): **78.75% lines / 77.42% branches / 75% functions** — plan target >70% met.
- Warm local API (dev, DB imported): `/api/pois?mode=work` p95 **9.6ms**; `/api/pois/:id` p95 **8.2ms**; `/api/suggest` p95 **6.8ms** — all plan targets met.

### Pin location audit

- Three-layer audit of all 14 map pins against AMap Web services (geocoding / regeocoding / POI search) + public business records: **14/14 PASS** (offsets < 0.4 km, district matches).
- Corrected **11 pins** (address and/or coordinates): 蚂蚁 Z 空间（西溪路556号）、滴滴 EFC（景兴路896号）、深度求索（拱墅区环城北路169号汇金国际大厦）、贝达（临平区兴中路355号）、泰格医药（滨江区聚工路19号盛大科技园）、群核（余杭塘路515号莱茵·矩阵国际）、字节跳动、旷视、同花顺、新华三、之江实验室（+阿里微调）。网易/零跑原数据正确。
- `npm run audit:pins` added (`scripts/audit-pin-locations.mjs`, `AMAP_WEB_KEY` + `DATABASE_URL` from env).
- **Browser cache invalidation**: `MODE_CACHE_VERSION` bumped 1→2 — stale sessionStorage catalogs refetch the corrected coordinates. Data-fix workflow documented: seed/drops → `import:seed:apply` → bump cache version → `audit:pins`.

### Geocode apply — radar-only companies to real Hangzhou offices (2026-08-17)

- `npm run geocode:sites:apply` (`scripts/geocode-sites-apply.mjs`): resolves city-text-only radar sites ("北京/杭州") to a **real Hangzhou office** via AMap place-text search (`v3/place/text`, city-scoped) instead of pinning a company at a city center. It regeocodes every hit to confirm it sits inside 杭州市, skips companies already on the map (no duplicate pins), and copy-on-write replaces only `site.location` in the owning drop JSON. Missing `AMAP_WEB_KEY` → dry-run.
- New helpers in `lib/site-geocode.ts`: `cleanCompanySearchName` / `normalizeNameForMatch` (strip decor + legal forms, known aliases), `gradeOfficePoi` (rejects out-of-city and wrong-entity name mismatches — the 海天集团 trap), `pickBestOfficePoi` (office type over retail store), `placeTextSearchRest`, `regeoCityRest`. Unit tests: `tests/site-geocode.test.mjs`.
- Hand-curated resolutions live in `data/recruitment/geocode-overrides.json` (real office for wrong-entity hits: 白贝壳 for Babycare, 游卡滨江基地, 阿里巴巴西溪园区 for 淘天集团/淘宝闪购/阿里淘天, 兴业银行杭州分行, 台达电子杭州设计中心, 华润置地浙江公司, vivo杭州研发中心, 海信星海科技, 舜宇光学(浙江)研究院, 迈瑞杭州分公司, 禾赛赫兹智能制造中心, 吉利科技大厦…) plus explicit `exclude` markers for companies with **no verifiable Hangzhou office** in AMap (奥比中光 / MPS / 星宸 / 多益 / 昆仑芯 / 拓竹 / 恒瑞 / 海天集团…).
- **Result: map surface 14 → 79 pins**, all with a street address and 0 (0,0) pins. Import plan stays valid: 137 companies / 137 sites / 241 positions, 0 dropped, 0 issues. `MODE_CACHE_VERSION` bumped 2→3 so browsers refetch the expanded catalog. **Postgres re-sync** (`import:seed:apply`, `DATABASE_URL` from `server/.env.local`): the work-mode API reads Postgres first, so the geocoded drops only reach the map after the DB is re-imported — 79 DB pins verified via `npm run audit:pins` (72/79 PASS; the 7 flagged are compound-address geocode artifacts, each confirmed by regeo). Audit script now strips parenthetical walking notes before geocoding.

## 2026-08-16

### Added

- Multi-mode map: Domain + Work. Intern / campus / social are work FilterPlugins, not extra map modes.
- Viewport Domain search (single-center AMap queue, soft cap 300, sessionStorage per mode).
- Secondary sidebar: glass POI cards, in-panel detail, sibling JD panel.
- Account slice: demo OTP / OAuth stubs, Profile L2 prefs, Recent = search history only.
- Saved places, applications, queued job-alert inbox (`008`–`010`).
- Layers L2 frost card: saved overlay + persisted basemap style.
- Public read API 30s process cache (`lib/public-cache.ts`).
- Shared `lib/server-catalog.ts` for `/api/pois`, `/api/pois/[id]`, `/api/search`, `/api/suggest`.
- Home lazy-loads `MapShell` from a Client Component (`home-map.tsx` + `next/dynamic`, `ssr: false`). Next 15 rejects `ssr: false` on the Server Component `page.tsx`. Rail panels (detail / JD / auth / Profile / Recent / Saved / Layers) are split the same way inside the shell; hover/focus on the rail prefetches the matching chunk. See `tech/12-bundle-notes.md`.
- Account SQL / index inventory: `tech/13-db-query-notes.md`.
- Search/filter integration tests: `server/tests/search-integration.test.mjs`.
- Recruitment import planner: validate / dedupe seed companies (`lib/recruitment-import.ts`, `npm run import:seed`). Live upsert still waits on Postgres.
- Work seed expanded to 50 Hangzhou public-career companies (still representative examples, not a live crawl).
- Public work APIs (`/api/pois`, `/api/pois/:id`, `/api/search`, `/api/suggest`) read imported Postgres rows via `loadServerCatalog` when present; otherwise the seed.
- Work mode on the map loads that same catalog (`fetchWorkCatalogFromApi`); job-alert matching uses `loadServerCatalog` instead of a hardcoded seed. Coordinates that are already set are not geocoded again.
- Site geocode planner (`lib/site-geocode.ts`, `npm run geocode:sites`): seed already has points; missing imported rows are listed. Live AMap REST waits on `AMAP_WEB_KEY` and is a no-op without it.
- Public `/api/pois` and `/api/search` clip to `bounds` (`inBounds`) instead of only using the box as a distance origin.
- Official-career file adapter: drop JSON under `server/data/recruitment/official-career/`. `import:seed` and the no-DB work catalog (`loadOfflineWorkCatalog`) merge it with the seed (same slug unions sites/positions; new slugs become catalog POIs). Sample drops: Alibaba / ByteDance / Tencent / NetEase / Huawei / Ant 2026 autumn frontend + 之江实验室. Empty dir is still a no-op. `apiRecruitmentAdapter` is `kind: catalog` (read `/api/pois`), not official-career. Closed / paused official-career rows stay in the import plan but drop out of the no-DB catalog, same as `positions WHERE status = 'open'`.
- Work autocomplete uses `GET /api/suggest` (imported companies included). Job suggestions carry `poiId`. Offline / empty falls back to `suggestRecruitment`.
- `/api/suggest` tag rows come from the same `TAG_FILTERS` map (`#大厂`, `#秋招`, industries, `#西湖区`, `#在招`, `#班车`, `#住宿`, `#硕士`), not a five-industry hardcode. Bare `#西湖` stays a Domain keyword. Work toggles: `onlyOpen` / `providesHousing` / `providesShuttle`. Education is a multi-select plugin (`#本科` / `#硕士` / `#博士`). internship and work share one filter list.
- Skip links (results / map), polite live result count, and `document.documentElement.lang` follow the UI language. `#` suggestions apply FilterPlugins via `applyTagSuggestion`.
- Search boxes are comboboxes: Arrow / Enter / Escape share `lib/suggest-nav.ts` on desktop L2 and the mobile drawer.
- Applied `#` plugins render as removable chips (`activeFilterChips`) so a picked tag stays visible after the query clears. Recent / trending hashes use the same `applyTagSuggestion` path. District, salary, and distance also chip when the mode configs are passed. District hashes are generated from `HANGZHOU_DISTRICTS` (`#西湖区` is a plugin; bare `#西湖` is still the lake).
- Job-title aliases: `FE` / `frontend` match 前端, `backend` matches 后端, `PM` matches 产品. Short codes (`fe`, `be`, `pm`) are token-aware so they do not hit Alibaba. Domain place aliases: `westlake` / `West Lake` match 西湖; `lingyin` matches 灵隐. Company aliases: `alibaba` / `bytedance` / `tencent` / `netease` / `huawei` hit the Chinese seed titles.
- Work `education` FilterPlugin: `#本科` / `#硕士` / `#博士` parse into a multi-select; companies stay if any open position lists that degree. internship and work share `WORK_FILTERS`.
- Work 职能 plugin (`roleFamily`): `#技术` / `#产品` / `#运营` / `#设计` match title/department/skills. intern/campus/social stay on `jobTaxonomy`. Deadline sort ranks the soonest `position.deadline` first (seed rows without a date sink).
- Domain 人均消费 range (`price` from `priceLevel`) plus `priceAsc` / `priceDesc`. Both modes gain a `relevance` sort (exact / prefix name, then rating and distance).
- Client suggest LRU (max 100, 5 minutes) in `lib/public-cache.ts`; `fetchSearchSuggest` hits it before `/api/suggest`. Public API cache stays a separate 30s store.
- Work `deadline` date filter: keep companies whose jobs close on or after the picked day (or have no date). Same key as the existing deadline sort.
- Official-career drops for Tencent / NetEase / Huawei / Ant Hangzhou offices: 2026 autumn frontend unions onto the existing seed pin (`${slug}-site`). No second map marker.
- Avatar crop dialog portals to `document.body` so Profile’s `pointer-events: none` cluster cannot swallow drag / zoom / save.
- Mobile search suggestions appear only in half/full as a liquid-glass overlay over the list (`mobileSearchStack`), not an in-flow block.
- Mobile Profile / Recent keep a visible close on the embedded sheet. Account, Saved, and Layers also expose a `mobileBackBtn`. Tapping the drawer avatar again while already on Profile returns to Explore.
- Public `/api/pois` and `/api/search` push `bounds` and `filters.distance` into PostGIS (`s.geom &&` then `ST_DWithin` on `company_sites`). Selected Hangzhou districts become address `ILIKE` + coarse-box SQL (a superset); `poiMatchesDistrict` still prefers named addresses. No database still clips in memory with `inBounds`. Suggest / job-alert stay unclipped. Live `EXPLAIN` on 51 sites: gist is used for `&&` + `ST_DWithin`; bbox-only stays a Seq Scan until the table grows. Warm local Next: `/api/pois` P95 12.7ms, bounds clip 5.8ms.
- File-drop adapters for `boss` / `nowcoder` / `shixiseng` (empty dirs are a no-op). Official-career 2026 autumn frontend drops now cover every seed slug that already has a public career URL (曦曦AI stays seed-only). Live `import:seed:apply` wrote 51 companies / 110 open positions.


### Changed

- Coordinate CHECKs in `003` / `006` use `lng = lng` (NaN-reject) instead of `isfinite()`, which PostgreSQL 16 does not have for `double precision`.
- `db/scripts/apply.sh` compares ledger checksums in SQL so a second `make db-migrate` works with psql 18 (`\if` is boolean-only).
- Default map mode is **work**.
- Settings rail item moved into Profile L2.
- Contrast tokens: `--muted` / `--blue-ink` / `--green` meet WCAG AA on frost/white. Brand `#007AFF` stays chrome-only.
- Suggest empty-q hot list is `trendingForMode` (not a second hardcoded array).
- Failed session / OTP lookups delete expired rows when `DATABASE_URL` is set.
- Embedded Profile / Recent preference cards are fluid in the drawer (`max-width: 100%`); `.sheet` follows `.sidebar` so `width: 100%` wins over the desktop 380px lock.

### Security

- Never print or commit `.env` secrets.
- Guests do not get a fake cloud Saved / Recent list.
- Notifications stay `queued`; nothing is emailed or SMSed.

## Earlier

Phase 0 docs scaffold and Phase 1 platform baseline (importer, migrations `001`–`004`, Apple Maps shell) landed on `feature/phase-1-platform-baseline`. See `tech/05-milestones.md`.
