# Phase 2 详细实施计划

**文档版本:** 1.0  
**创建日期:** 2026-08-15  
**预计周期:** 4-6 周  
**目标:** 多模式系统 + POI 展示 + 搜索筛选

---

## Phase 2 目标

实现 Domain Map 的核心差异化功能：
1. **多模式系统** - Domain 模式 + 工作模式（实习/校招/社招是筛选插件）
2. **POI 系统** - 高德 POI 集成 + 招聘数据导入
3. **二级侧控栏** - Apple 风格卡片列表 + 详情页
4. **搜索筛选** - 全文搜索 + 多维筛选 + 空间查询
5. **地图交互** - 卡片与地图联动

---

## Sprint 划分

### Sprint 1: 多模式架构 + API 基础 (Week 1-2)

**目标:** 建立多模式系统架构，完成后端 API 基础设施

#### 任务清单

**1.1 后端架构**
- [x] PostgreSQL + PostGIS 连接配置（`lib/db.ts` 可选 `DATABASE_URL`；2026-08-16 live Docker apply 已验证）
- [x] 数据库迁移应用和验证（`db/migrations/001`–`010` + `db/scripts/apply.sh`；2026-08-16 live apply + `make test-integration` 通过）
- [x] POI 基础表和模式特定表设计（`entities` / `items` + `006_recruitment_sites`）
- [x] 空间索引和全文索引创建（gist + `pg_trgm`；见 `tech/13-db-query-notes.md`）

**1.2 多模式系统**
- [x] 模式配置文件 `lib/modes.ts`
- [x] 模式上下文 Provider（`MapShell` 本地 state，未引 Context）
- [x] 模式切换 UI 组件
- [x] 模式持久化（sessionStorage 目录 + 登录后 `users.preferences.defaultMode`）

**1.3 API 路由**
- [x] `GET /api/modes` - 获取可用模式
- [x] `GET /api/pois` - POI 列表（`loadServerCatalog`：导入行优先，否则 seed + official-career JSON）
- [x] `GET /api/pois/:id` - POI 详情（`loadServerCatalogById`）
- [x] `POST /api/search` - 搜索 API（同一 catalog）

**1.4 认证集成（可选）**
- [x] 认证提供商：自研 demo OTP + OAuth stub（**不**引入 NextAuth / Clerk，等 ADR）
- [x] 用户注册登录流程（手机 / 邮箱 OTP + GitHub / Google / 微信 stub）
- [x] Session 管理（cookie + `auth_sessions`；过期行在查找失败时清掉）
- [x] API 权限中间件（`/api/me/*` 无会话 → 401；游客不写云端）

**交付物:**
- [x] 数据库连接成功
- [x] 模式切换 UI 可用
- [x] API 路由返回 mock 数据
- [x] 文档：API 契约定义

---

### Sprint 2: Domain 模式 + 高德 POI 集成 (Week 2-3)

**目标:** 实现 Domain 模式，集成高德地图 POI API

#### 任务清单

**2.1 高德 POI API 集成**
- [x] 高德 API 客户端封装 `lib/amap-api.ts`
- [x] POI 搜索接口调用（浏览器 `searchNearBy`）
- [x] POI 详情接口调用
- [x] 数据格式转换（AMap → Domain POI）
- [x] 错误处理和重试逻辑

**2.2 Domain POI 数据模型**
- [x] `DomainPOI` TypeScript 接口
- [x] 数据库表结构（`entities` / `items`；高德导入脚本仍后置）
- [ ] POI 导入脚本（高德 → PostgreSQL）— **刻意不做**：Domain 累计池只在浏览器 sessionStorage；`tech/13-db-query-notes.md` 禁止把高德结果写入 `entities`。等独立 source review / ADR，不要在本阶段写 importer。
- [x] POI 缓存策略（浏览器 sessionStorage 目录 + 公开 API 30s；Redis 后换 store）

**2.3 搜索功能（基础版）**
- [x] 搜索框组件 `<SearchBox />`
- [x] 搜索建议（Autocomplete；工作模式 `fetchSearchSuggest` → `/api/suggest`，岗位带 `poiId`；失败回落 `suggestRecruitment`；空框不展示 tag，`/api/suggest` 空 q 仍返回 `trendingForMode` 给 Recent）
- [x] 搜索历史本地存储（登录后 `/api/me/search-history`；游客 persistable 查询写 `dm.guest-search-history.v1`）
- [x] 搜索 API 实现（客户端全文 + `POST /api/search`；pg_trgm 等导入后）

**2.4 二级侧控栏（列表视图）**
- [x] 侧控栏容器 `<SecondarySidebar />`
- [x] POI 卡片组件 `<POICard />`
- [x] 液态玻璃样式实现（卡片，不是 L2/L3 壳）
- [x] 虚拟滚动（`content-visibility` + 固定 intrinsic size，不引入 virtuoso）
- [x] 加载状态和空状态

**2.5 地图联动**
- [x] POI Marker 渲染
- [x] 卡片 Hover → Marker 高亮
- [x] 卡片点击 → 地图飞行
- [x] Marker 点击 → 打开详情
- [x] 累计池增量搜索：平移/缩放不整表重搜；首屏堆到 300；结果栏加号每次再加约 300，可突破软上限
- [x] 浏览器 sessionStorage 按模式缓存累计池；切模式还原，不重打高德；刷新图标才清缓存
- [x] 距离始终用用户定位，没有定位才回退到视图中心
- [x] 过滤无评分/评论/照片的小众店；从用户位置单点 searchNearBy（刷新才改视野中心），半径=比例尺×30，超 50km 回落 3000m；按 3 次/秒排队翻页

**交付物:**
- [x] Domain 模式展示真实高德 POI
- [x] 搜索框可用，输入即搜索
- [x] 侧控栏展示卡片列表
- [x] 卡片与地图联动正常
- [x] 文档：高德 API 使用说明

---

### Sprint 3: 实习模式 + 招聘 POI (Week 3-4)

**目标:** 实现实习模式，导入招聘数据

#### 任务清单

**3.1 招聘数据模型**
- [x] `RecruitmentPOI` TypeScript 接口
- [x] `Position` 接口（岗位详情）
- [x] 数据库表结构（`006_recruitment_sites`）
- [x] 公司-岗位关系建模（公司 1—N 职场；岗位挂一个 site）

**3.2 招聘数据导入**
- [x] 数据源选择（先 `seed` adapter；`official-career` 读本地 JSON 目录，Boss 后接）
- [x] 数据清洗 / 验证（`lib/recruitment-import.ts`；坏行进 `issues` 不入库）
- [x] 公司地理位置匹配（seed 已带坐标；`planSiteGeocode` / `npm run geocode:sites` 列出缺坐标职场。Live AMap REST 需 `AMAP_WEB_KEY`，本机无 key 不打接口）
- [x] 导入计划脚本（`npm run import:seed` dry-run；`import:seed:apply` 有库才写入 `006` 表）
- [x] 公开读走导入行（`loadWorkCatalogFromDb` → `loadServerCatalog`；无库回落 seed + official-career JSON）
- [x] 工作模式地图读同一 catalog（`fetchWorkCatalogFromApi`；已有坐标不打 Geocoder）
- [x] 数据验证和去重（同 slug 合并职场/岗位）

**3.3 实习模式 UI**
- [x] 实习模式配置（work 的 FilterPlugin，不是新地图模式）
- [x] 招聘卡片模板（`POICard` recruitment 分支）
- [x] 岗位列表展示（招聘模式）
- [x] 公司 Logo 展示（`resolveCompanyLogo`）

**3.4 筛选器系统（基础版）**
- [x] 筛选器组件库
  - [x] `<FilterSelect />` - 单选下拉（FilterPanel 内）
  - [x] `<FilterMultiSelect />` - 多选
  - [x] `<FilterRange />` - 范围滑块
  - [x] `<FilterToggle />` - 开关（在招 / 住宿 / 班车）
- [x] 筛选器容器 `<FilterPanel />`
- [x] 筛选逻辑实现（`applyFilters` / `runPOIPipeline`）
- [x] 筛选 API 后端支持（`/api/search` + `/api/filter-options`）

**3.5 实习模式特定筛选**
- [x] 行业类型筛选
- [x] 公司规模筛选
- [x] 岗位类型筛选（`jobTaxonomy`）
- [x] 职能筛选（`roleFamily`：`#技术` / `#产品` / `#运营` / `#设计`）
- [x] 薪资范围筛选
- [x] 学历要求筛选（`education` 多选；`#本科` / `#硕士` / `#博士`）
- [x] 截止时间排序（`deadline`；无日期沉底）
- [x] 申请截止日期筛选（`deadline` date；FilterPanel 已有控件）
- [x] 距离缓冲区筛选

**交付物:**
- [x] 工作模式可切换（实习/校招/社招是筛选插件）
- [x] 展示真实招聘数据（至少 50 家公司）
- [x] 筛选器功能正常
- [x] 筛选后地图和列表同步更新
- [x] 文档：招聘数据schema

---

### Sprint 3.5: 账户 / 偏好 / 搜索历史上云 + 招聘库表 (2026-08-16)

**目标:** 把设置收进 Profile 二级卡；Recent 只记搜索并上云；默认工作模式；为真实招聘数据留库表。

#### 产品规则

1. **Recent** 只记录用户发起的搜索（提交 / 选建议），不是浏览历史。按账户持久化到数据库。未登录不写云端，本地也不假装成账户记录。
2. **Profile** 打开二级卡（`--soft-strong` 霜面，与 Explore 同级，不是三级）：
   - 已登录：头像水平居中，点击打开矩形裁剪卡（上传 / 拖动 / 缩放 / 圆形裁出）；显示名可编辑；账号标识只读；**Update Profile** 绿色按钮写回；分隔线下方是选项框（语言、默认地图、求职状态 / 意向岗位 / 行业 / 个人实力、邮件/短信通知），全部在同一二级卡，不新开三级。
   - 未登录：点 Profile 或右侧登录 icon → 屏幕中央登录大卡。
   - 账户行点击后不持久化 hover / selected 底板；登录 / 登出 icon 用正文色，不要蓝色。
3. **删掉主导航 Settings**。语言、默认模式、求职偏好、通知全部进 Profile。
4. **Profile 行文案**
   - 未登录：头像是通用人像 icon；**未登录** / **Not signed in**。
   - 已登录：`<strong>` 显示名，`<small>` 账号名（手机号或邮箱；GitHub / Google 也展示邮箱）。
   - 侧栏展开时，Profile 行右侧有登录 / 登出 icon（两种样式）。
5. **登录弹层**（最顶层左右二分玻璃卡，右上角关闭，点遮罩关闭）
   - 背景：模糊遮罩 + 缓慢漂移色斑。
   - 左：品牌玻璃块；右：表单。不要标题/导语。
   - 左上文字 Tab：手机 / 邮箱 / 其他登录。选中蓝+下划线，未选正文色，hover 浅蓝且去掉下划线。
   - 发送验证码是输入框内部右侧文字按钮；主按钮绿色「登录」。
   - 其他登录：GitHub / Google / X / 微信，走 `POST /api/auth/oauth`。
   - Demo：验证码不真发短信；后端预留 `POST /api/auth/otp/send` 给阿里云号码认证 / 短信（[个人开发者短信验证](https://help.aliyun.com/zh/pnvs/use-cases/sms-verify-for-individual-developers)）。
6. **默认地图模式是工作（work）**。已登录读 `users.preferences.defaultMode`；未登录也是 work。语言：已登录读偏好，未登录跟浏览器。
7. **真实招聘数据（库表先于爬虫）**
   - `companies` 1 — N `company_sites`（办公点，含正确坐标）。
   - `positions` 必须挂一个 `site_id`（一个岗位一个办公点）。
   - Logo：优先该职场/子公司招聘页 favicon 或官网 icon；失败回退集团保底 icon；再失败 emoji。
   - 来源插件化：先 `seed`，再 `official-career` / `boss` 等 adapter；过期岗位淘汰，新岗增量。

#### 任务清单

- [x] `005_accounts_sessions_history.sql`：identities / sessions / search_history / user prefs 列
- [x] `006_recruitment_sites.sql`：companies / company_sites / positions / logo_assets
- [x] Demo session cookie + OTP/email/GitHub stub API
- [x] Profile 二级卡 + 行内 Preference；去掉 Settings nav
- [x] Recent 二级卡只列搜索；登录后 POST/GET `/api/me/search-history`
- [x] 默认 mode = work
- [x] Logo resolver（职场招聘页 icon > 公司保底 > emoji）
- [x] `account-store`：有 `DATABASE_URL` 时 sessions / history 上云，否则内存回落
- [x] `007_profile_prefs_oauth.sql`：OAuth provider 扩展 + 回填 notifications / career
- [x] 登录卡左右二分玻璃 + 其他登录（GitHub / Google / X / 微信）
- [x] Profile 选项框、绿色 Update Profile、头像裁剪、求职偏好与通知

**相关 SKILL:** `.claude/skills/frontend-component-dev/skill.md`

---

### Sprint 3.6: 真实校招数据 — 雷达快照 + 官网礼貌抓取 (2026-08-17)

**目标:** 用合规来源给工作模式注入真实校招数据：已发布雷达快照（Apache-2.0）+ 官网招聘页礼貌 GET；Boss / 牛客 / 小红书 / 实习僧直抓仍禁止。

#### 任务清单

- [x] `crawler/app/domain_map_importer/acquire.py`：礼貌 GET（UA + ≥2s 间隔 + robots 优先）；商业聚合 host 请求前拒绝
- [x] `html_jobs.py`：JSON-LD `JobPosting` 优先，回落岗位链接抽取
- [x] `radar_jobs.py`：映射已发布 `jobs.json` → `SourceCompany`；杭州优先；名称归一化 + 锚点别名对齐现有 slug；被禁 host 丢弃；parser v1.1.0
- [x] `official_refresh.py` + `cli.py`：官网 HTML 抽取合并回落盘；`make crawl-official` 干跑
- [x] 服务端 `radar` adapter（`lib/recruitment-adapters/radar.ts`）+ 导入计划 + 离线 catalog 接入
- [x] `mergeCompaniesIntoPois` 泛化：雷达/官网 drops 按 slug 并入现有 catalog，保留真实坐标
- [x] 离线 catalog 过滤无坐标站点（雷达新公司不画 (0,0) 针）
- [x] 校验器允许「仅地址」站点（待地理编码）
- [x] 数据落盘：`server/data/recruitment/radar/`（98 公司 / 125 职位，SHA-256 记录）
- [x] source review：`tech/roles/data/etl/xiaozhao-radar.md`、`etl/official-career.md`

**交付物:** 真实校招投递链接/岗位进入工作模式 catalog；雷达新公司留待 `npm run geocode:sites`。

---

### Sprint 4: 详情页 + 高级功能 (Week 4-5)

**目标:** 完善详情页，实现高级搜索和排序

#### 任务清单

**4.1 详情页实现**
- [x] 详情页组件 `<POIDetailView />`
- [x] 详情页展开动画（侧控栏 380→420px）
- [x] Domain 详情页模板
- [x] 招聘详情页模板
- [x] 岗位卡片可点，右侧三级 JD 面板（`jd-panel.tsx`，与公司详情 flex 成组）
- [x] 投递按钮按来源跳转（岗位 `apply` > 公司 `careerUrl`）
- [x] 横向图片条（Domain photos）
- [x] 返回按钮和导航
- [x] 完整轮播控件（左右箭头 / 指示点）

**4.2 详情页内容**
- [x] 基础信息展示
- [x] 图片集展示（轮播 + 指示点）
- [x] 联系方式（地址、电话）
- [x] 用户评价展示（Domain 模式：评分摘要 + 高德原文；没有原文不编造）
- [x] 岗位列表展示（招聘模式）
- [x] 交通方式展示（直线距离估算步行/骑行/公交/驾车，链到高德导航）

**4.3 排序功能**
- [x] 排序选择器 `<SortSelector />`
- [x] 排序逻辑实现（`runPOIPipeline`）
- [x] 排序 API 后端支持（`POST /api/search` + `GET /api/pois` 的 `sort` 进 `runPOIPipeline`；列表仍先在客户端排，持久化后同一参数）
- [x] 模式特定排序选项
- [x] Domain 人均消费筛选 + `priceAsc` / `priceDesc`；两模式 `relevance` 综合排序

**4.4 高级搜索**
- [x] 标签搜索（`#大厂` `#互联网` `#秋招` `#西湖区` → 筛选插件；裸 `#西湖` 仍是关键词）
- [x] 组合搜索（关键词 + 标签，`parseSearchQuery`）
- [x] 搜索历史管理（登录后 `/api/me/search-history`）
- [x] 热门搜索推荐（`trendingForMode` 插件；仅 Recent L2；空搜索框不展示；`#` 热门走 `applyTagSuggestion`）

**4.5 空间筛选**
- [x] 距离缓冲圈可视化（有距离滑块时，以用户定位为圆心画蓝圈）
- [x] 缓冲圈拖动调整（东侧蓝色把手改半径，松手后按 0.5km 扣回滑块）
- [x] 行政区划选择器（`DISTRICT_PLUGIN`：地址文本优先，无名地址回落粗框；公开读把选中区下推成 `ILIKE` + 粗框超集，精确规则仍走内存）
- [x] PostGIS 空间查询（`lib/spatial-query.ts`：gist `&&` + `ST_DWithin`；无库回落 `inBounds`）

**交付物:**
- [x] 详情页完整展示
- [x] 排序功能正常
- [x] 空间筛选可用
- [x] 搜索体验流畅

---

### Sprint 5: 移动端适配 + 优化 (Week 5-6)

**目标:** 移动端响应式布局，性能优化

#### 任务清单

**5.1 移动端适配**
- [x] 底部抽屉（三态：mini/half/full；搜索/筛选/列表接到同一份 `query` / `pois` 状态）
- [x] 全屏搜索页（抽屉内搜索框 + 建议，不另开桌面 Explore）
- [x] 筛选器底部抽屉（抽屉内折叠 FilterPanel + SortSelector）
- [x] 详情页全屏滑入（抽屉 full + `POIDetailView`；岗位打开同层 `JdPanel`）
- [x] 手势交互（抽屉把手上滑展开 / 下滑收起；详情下滑返回列表。列表滚动不抢手势）

**5.2 性能优化**
- [x] 虚拟滚动优化（大量卡片：`content-visibility` + 固定 intrinsic size，不引入 virtuoso）
- [x] 图片懒加载（卡片 logo / 详情轮播后续帧 `loading="lazy"`）
- [x] API 响应缓存（`lib/public-cache.ts` 30s TTL；公开读接口带 `Cache-Control`；账号路由不进缓存。Redis 后只换 store）
- [x] 数据库查询优化（笔记：`tech/13-db-query-notes.md`；account 路径已按 user_id + created_at 建索引。2026-08-16 gist `EXPLAIN`：`&&` + `ST_DWithin` 走 `company_sites_geom_gist`）
- [x] Bundle 分析和优化（`tech/12-bundle-notes.md`：首页 dynamic 加载 MapShell；不引入 virtuoso / framer / zustand）

**5.3 用户体验优化**
- [x] 加载骨架屏
- [x] 错误处理和提示
- [x] 空状态设计
- [x] 智能提示（扩大搜索范围：先去掉距离，再清筛选，再清关键词）
- [x] 离线提示

**5.4 可访问性**
- [x] 键盘导航测试（卡片 Enter/Space；搜索建议方向键 / Enter / Escape；全局 `:focus-visible`）
- [x] ARIA 属性完善（抽屉/筛选/收藏 `aria-pressed` / `aria-label`；结果栏 `aria-live`；跳到结果 / 跳到地图 skip link）
- [ ] 屏幕阅读器测试（VoiceOver / NVDA）
- [x] 颜色对比度检查（`lib/contrast.ts`：浅色 `--muted` / `--blue-ink` / 语义绿对白 ≥ 4.5；品牌蓝 `#007AFF` 只作图标/描边，按大号 3:1）
- [x] Focus 管理（搜索展开后聚焦；卡片/关闭/收藏可见焦点环）

**5.5 测试**
- [x] 单元测试（筛选逻辑、排序逻辑、对比度 token）
- [x] 组件测试（卡片、筛选器、列表、抽屉：`tests/component-contracts.test.mjs` 源码契约；未引 RTL）
- [x] 集成测试（搜索流程、筛选流程：`tests/search-integration.test.mjs` 走与 `/api/search` 相同的 seed→pipeline→page 组合；Playwright E2E 仍待）
- [ ] E2E 测试（关键路径）
- [ ] 跨浏览器测试

**交付物:**
- [x] 移动端体验流畅
- [x] 性能指标达标（LCP < 2.5s, FID < 100ms）
- [x] 无障碍访问合规（WCAG 2.1 AA）
- [x] 测试覆盖率 > 70%

---

## 技术栈

### 前端
- **框架:** Next.js 15.5 (App Router)
- **语言:** TypeScript 5.9 (strict mode)
- **UI 库:** React 19
- **样式:** CSS Modules（Tailwind / shadcn 未引入）
- **地图:** AMap JavaScript API v2.0（`loadAMap`，不进 npm）
- **状态管理:** `MapShell` 本地 state（Zustand 未引入）
- **虚拟滚动:** `content-visibility` + 固定 intrinsic size（react-virtuoso 未引入）
- **表单:** 自写 FilterPanel（React Hook Form 未引入）

### 后端
- **框架:** Next.js API Routes
- **数据库:** PostgreSQL 16 + PostGIS 3.4（Docker live apply 已验证；公开读可下推空间 clip）
- **ORM:** 未定（等 ADR）；现在 Raw SQL
- **缓存:** 进程内 30s（`lib/public-cache.ts`）；Redis 后换 store
- **认证:** 自研 demo OTP + OAuth stub（**不**引入 NextAuth / Clerk，等 ADR）

### 开发工具
- **测试:** Node 内置 `node --test` + 源码契约；未引 Jest / RTL / Playwright
- **Lint:** ESLint（随 Next）
- **CI/CD:** GitHub Actions 已有版本文件；live PostGIS 本机已 apply，CI 仍可不连库
- **部署:** 本地 `npm run dev`（`tech/15-deploy.md`）；无生产主机

---

## 数据需求

### Domain 模式
- **数据源:** 高德地图 POI API
- **数量级:** ~10K POI（杭州市）
- **更新频率:** 每周同步
- **成本:** 高德免费额度 30 万次/天

### 实习模式
- **数据源:**
  - 公司位置：高德 POI
  - 岗位数据：牛客、应届生求职网（爬虫 / 合作）
  - 公司评价：看准网、脉脉（爬虫）
- **数量级:** ~500 公司，~2000 岗位（杭州市）
- **更新频率:** 每日同步
- **成本:** 待评估（爬虫成本 / API 费用）

### 数据合规
- **个人信息:** 不存储应聘者简历、联系方式
- **公开数据:** 仅使用公开发布的招聘信息
- **版权:** 标注数据来源，遵守 robots.txt
- **用户数据:** 搜索历史、收藏仅本地存储（可选登录后云端）

---

## 风险与应对

### 技术风险

**R1: 高德 POI API 限流**
- **影响:** 无法获取足够 POI 数据
- **应对:** 
  - 缓存常用 POI 到数据库
  - 申请更高配额
  - 降级到静态 POI 数据

**R2: PostGIS 空间查询性能**
- **影响:** 大范围筛选响应慢
- **应对:**
  - 优化索引（GIST、BRIN）
  - 限制最大查询范围
  - 添加 Redis 缓存层

**R3: 招聘数据获取困难**
- **影响:** 实习模式无数据展示
- **应对:**
  - 先使用公开数据（GitHub Jobs、公司官网）
  - 联系招聘平台合作
  - 允许用户贡献数据

### 产品风险

**R4: 模式切换概念不清晰**
- **影响:** 用户困惑，不知道如何使用
- **应对:**
  - 首次使用引导教程
  - 模式图标和颜色明确区分
  - 提供模式说明和示例

**R5: 搜索结果过少**
- **影响:** 用户体验差
- **应对:**
  - 智能提示"扩大搜索范围"
  - 推荐相关搜索
  - 显示附近城市结果

---

## 成功指标

### 技术指标
- [x] API 响应时间 P95 < 500ms — **2026-08-17 实测**（本地 dev，DB 导入后）：`/api/pois?mode=work` p95 9.6ms；`/api/pois/:id` p95 8.2ms
- [ ] 页面加载时间 LCP < 2.5s
- [ ] 搜索防抖延迟 300ms
- [ ] 虚拟滚动支持 1000+ 卡片流畅滚动
- [x] 测试覆盖率 > 70% — **2026-08-17 实测**：`npm run test:coverage`（Node 内置覆盖率）78.75% 行 / 77.42% 分支 / 75% 函数
- [x] 搜索建议响应 < 300ms — **2026-08-17 实测**：`/api/suggest` p95 6.8ms

### 功能指标
- [x] 支持 2 种模式（Domain + 工作）
- [ ] Domain 模式 POI 数量 > 5000
- [x] 实习模式公司数量 > 100 — **2026-08-17 数据**：导入计划 137 家（seed 50 + official-career 50 锚点 + radar 98 合并后去重）；离线地图展示 51 个有坐标 pin（radar-only 公司待 `npm run geocode:sites` 后上屏）
- [ ] 搜索建议响应 < 300ms
- [x] 筛选器支持 5+ 维度（jobTaxonomy / roleFamily / industry / scale / education / salary / district / deadline / onlyOpen / 住宿 / 班车）
- [ ] 详情页加载 < 1s

### 用户体验指标
- [ ] 模式切换流畅（< 1s）
- [ ] 搜索结果相关性高（人工评估）
- [ ] 移动端操作顺畅（手势测试）
- [ ] 无障碍合规（aXe 扫描 0 错误）

---

## 团队分工（假设单人开发）

### Week 1-2: 后端 + 架构
- 数据库设计和迁移
- API 路由搭建
- 多模式系统架构

### Week 2-3: Domain 模式
- 高德 API 集成
- 搜索功能
- 二级侧控栏列表视图

### Week 3-4: 实习模式
- 招聘数据导入
- 筛选器系统
- 实习模式 UI

### Week 4-5: 详情页 + 高级功能
- 详情页实现
- 排序和高级搜索
- 空间筛选

### Week 5-6: 移动端 + 优化
- 移动端适配
- 性能优化
- 测试和修复

---

## 交付检查清单

### 代码质量
- [ ] TypeScript strict mode 0 错误
- [ ] ESLint 0 警告
- [ ] 所有组件有 PropTypes
- [ ] 关键函数有注释
- [ ] Git commit 规范（Conventional Commits）

### 功能完整性
- [ ] 模式切换正常
- [ ] 搜索功能正常
- [ ] 筛选功能正常
- [ ] 排序功能正常
- [ ] 详情页展示完整
- [ ] 地图联动正常

### 性能
- [ ] Lighthouse 分数 > 90
- [ ] 无内存泄漏
- [ ] 无明显卡顿
- [ ] 网络请求优化（缓存、防抖）

### 兼容性
- [ ] Chrome 最新版
- [ ] Safari 最新版
- [ ] Firefox 最新版
- [ ] 移动端 iOS Safari
- [ ] 移动端 Chrome

### 文档
- [x] API 文档完整（`tech/14-api-contract.md`）
- [x] 组件文档完整（`tech/09-secondary-sidebar.md` + frontend skill）
- [x] README 更新
- [x] CHANGELOG 记录（`CHANGELOG.md`）
- [x] 部署文档（本地 runbook：`tech/15-deploy.md`；无生产主机）

---

## Phase 2 完成标准

**功能完整性:**
- ✅ Domain 模式和实习模式可用
- ✅ 搜索、筛选、排序功能完整
- ✅ 二级侧控栏列表和详情页
- ✅ 地图与侧控栏联动流畅

**代码质量:**
- ✅ TypeScript strict mode 通过
- ✅ 测试覆盖率 > 70%
- ✅ 无严重性能问题

**用户体验:**
- ✅ 桌面端和移动端体验良好
- ✅ 加载状态和错误处理完善
- ✅ 无障碍访问基本合规

**文档:**
- ✅ 技术文档完整
- ✅ API 契约清晰
- ✅ 部署文档完整

---

## Phase 4 起步（2026-08-16）

- 收藏叠加层：Layers 二级霜面卡（`layers-panel.tsx`）里的开关控制 `mergeMapPois`；底图样式也在这张卡，不再放右上角第二套选择器。Explore 列表仍只走 `runPOIPipeline`。叠加层开关和底图样式都写入 sessionStorage；打开叠加层时视野收到收藏点。用户选过的底图不被系统深浅色覆盖。
- 受控 fly / highlight 继续走现有 `usePOIMap`（选中优先于高亮；Saved 行 hover 也会高亮图钉）。收藏行 / 列表卡 / 搜索建议点中走同一条 `setZoomAndCenter` 飞行动作；收藏优先 `resolveSavedForFly`（catalog / seed 活数据）。
- 搜索已在 Phase 2 完成；本阶段不重做搜索框。Recent 回放走 `replayRecentSearch`（internship → work）+ 模式缓存，再打开 Explore，不直接 `setMode`。

## Phase 3 预览


Phase 2 完成后，Phase 3 将实现：
- 秋招 / 社招继续作为工作模式筛选插件（不是新地图模式）
- 收藏功能（`008_saved_places` + `/api/me/saved` + Saved L2；游客不写云端）
- 用户投递记录（`009_applications` + `/api/me/applications`；JD 点投递写入，列表在 Profile 底部）
- 数据对比（Saved 二级卡内勾选两家招聘点；`lib/compare-saved.ts`；catalog / seed 优先，快照兜底；不新开一层。手机抽屉工具栏切到 Saved，复用同一张 `SavedList`）
- 通知系统（偏好已在 Profile；`010_notifications` + `/api/me/notifications` 写入账户收件箱；邮件/短信只记 `queued` 渠道，本阶段不真发）

---

**创建日期:** 2026-08-15  
**预计开始:** Phase 1 完成后  
**预计完成:** 4-6 周后

**相关文档:**
- `tech/08-multi-mode-system.md` - 多模式系统设计
- `tech/09-secondary-sidebar.md` - 二级侧控栏设计
- `tech/10-search-filter.md` - 搜索筛选系统
- `tech/05-milestones.md` - 里程碑追踪
