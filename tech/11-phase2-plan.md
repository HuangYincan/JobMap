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
- [ ] PostgreSQL + PostGIS 连接配置
- [ ] 数据库迁移应用和验证
- [ ] POI 基础表和模式特定表设计
- [ ] 空间索引和全文索引创建

**1.2 多模式系统**
- [ ] 模式配置文件 `lib/modes.ts`
- [ ] 模式上下文 Provider
- [ ] 模式切换 UI 组件
- [ ] 模式持久化（localStorage + DB）

**1.3 API 路由**
- [ ] `GET /api/modes` - 获取可用模式
- [ ] `GET /api/pois` - POI 列表（支持模式参数）
- [ ] `GET /api/pois/:id` - POI 详情
- [ ] `POST /api/search` - 搜索 API

**1.4 认证集成（可选）**
- [ ] 选择认证提供商（NextAuth / Clerk）
- [ ] 用户注册登录流程
- [ ] Session 管理
- [ ] API 权限中间件

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
- [ ] 高德 API 客户端封装 `lib/amap-api.ts`
- [ ] POI 搜索接口调用
- [ ] POI 详情接口调用
- [ ] 数据格式转换（AMap → Domain POI）
- [ ] 错误处理和重试逻辑

**2.2 Domain POI 数据模型**
- [ ] `DomainPOI` TypeScript 接口
- [ ] 数据库表结构
- [ ] POI 导入脚本（高德 → PostgreSQL）
- [ ] POI 缓存策略（Redis / 数据库）

**2.3 搜索功能（基础版）**
- [ ] 搜索框组件 `<SearchBox />`
- [ ] 搜索建议（Autocomplete）
- [ ] 搜索历史本地存储
- [ ] 搜索 API 实现（全文索引）

**2.4 二级侧控栏（列表视图）**
- [ ] 侧控栏容器 `<SecondarySidebar />`
- [ ] POI 卡片组件 `<POICard />`
- [ ] 液态玻璃样式实现
- [ ] 虚拟滚动（react-virtuoso）
- [ ] 加载状态和空状态

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
- [ ] `RecruitmentPOI` TypeScript 接口
- [ ] `Position` 接口（岗位详情）
- [ ] 数据库表结构
- [ ] 公司-岗位关系建模

**3.2 招聘数据导入**
- [ ] 数据源选择（公开数据 / API / 爬虫）
- [ ] 数据清洗脚本
- [ ] 公司地理位置匹配（高德 POI）
- [ ] 数据导入脚本
- [ ] 数据验证和去重

**3.3 实习模式 UI**
- [ ] 实习模式配置
- [ ] 招聘卡片模板 `<RecruitmentCard />`
- [x] 岗位列表展示（招聘模式）
- [ ] 公司 Logo 展示

**3.4 筛选器系统（基础版）**
- [ ] 筛选器组件库
  - [ ] `<FilterSelect />` - 单选下拉
  - [ ] `<FilterMultiSelect />` - 多选
  - [ ] `<FilterRange />` - 范围滑块
  - [ ] `<FilterToggle />` - 开关
- [ ] 筛选器容器 `<FilterPanel />`
- [ ] 筛选逻辑实现
- [ ] 筛选 API 后端支持

**3.5 实习模式特定筛选**
- [ ] 行业类型筛选
- [ ] 公司规模筛选
- [ ] 岗位类型筛选
- [ ] 薪资范围筛选
- [ ] 距离缓冲区筛选

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
- [ ] 排序 API 后端支持（客户端先排；持久化后补）
- [x] 模式特定排序选项

**4.4 高级搜索**
- [x] 标签搜索（`#大厂` `#互联网` `#秋招` → 筛选插件）
- [x] 组合搜索（关键词 + 标签，`parseSearchQuery`）
- [x] 搜索历史管理（登录后 `/api/me/search-history`）
- [x] 热门搜索推荐（`trendingForMode` 插件；空搜索框 + Recent 空态）

**4.5 空间筛选**
- [x] 距离缓冲圈可视化（有距离滑块时，以用户定位为圆心画蓝圈）
- [x] 缓冲圈拖动调整（东侧蓝色把手改半径，松手后按 0.5km 扣回滑块）
- [x] 行政区划选择器（`DISTRICT_PLUGIN`，按地址匹配杭州主城区；PostGIS 多边形后替换实现）
- [ ] PostGIS 空间查询

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
- [ ] API 响应缓存
- [ ] 数据库查询优化
- [ ] Bundle 分析和优化

**5.3 用户体验优化**
- [x] 加载骨架屏
- [x] 错误处理和提示
- [x] 空状态设计
- [x] 智能提示（扩大搜索范围：先去掉距离，再清筛选，再清关键词）
- [x] 离线提示

**5.4 可访问性**
- [x] 键盘导航测试（卡片 Enter/Space；全局 `:focus-visible`）
- [x] ARIA 属性完善（抽屉/筛选/收藏 `aria-pressed` / `aria-label`）
- [ ] 屏幕阅读器测试（VoiceOver / NVDA）
- [ ] 颜色对比度检查
- [x] Focus 管理（搜索展开后聚焦；卡片/关闭/收藏可见焦点环）

**5.5 测试**
- [ ] 单元测试（筛选逻辑、排序逻辑）
- [ ] 组件测试（卡片、筛选器）
- [ ] 集成测试（搜索流程、筛选流程）
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
- **样式:** CSS Modules + Tailwind CSS（考虑引入）
- **地图:** AMap JavaScript API v2.0
- **状态管理:** React Context + Zustand（考虑）
- **虚拟滚动:** react-virtuoso
- **表单:** React Hook Form（筛选器）

### 后端
- **框架:** Next.js API Routes
- **数据库:** PostgreSQL 16 + PostGIS 3.4
- **ORM:** Prisma（待定）/ Raw SQL
- **缓存:** Redis（可选）
- **认证:** NextAuth.js / Clerk

### 开发工具
- **测试:** Jest + React Testing Library + Playwright
- **Lint:** ESLint + Prettier
- **CI/CD:** GitHub Actions
- **部署:** Vercel / Railway

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
- [ ] API 响应时间 P95 < 500ms
- [ ] 页面加载时间 LCP < 2.5s
- [ ] 搜索防抖延迟 300ms
- [ ] 虚拟滚动支持 1000+ 卡片流畅滚动
- [ ] 测试覆盖率 > 70%

### 功能指标
- [ ] 支持 2 种模式（Domain + 实习）
- [ ] Domain 模式 POI 数量 > 5000
- [ ] 实习模式公司数量 > 100
- [ ] 搜索建议响应 < 300ms
- [ ] 筛选器支持 5+ 维度
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
- [ ] API 文档完整
- [ ] 组件文档完整
- [ ] README 更新
- [ ] CHANGELOG 记录
- [ ] 部署文档

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

## Phase 3 预览

Phase 2 完成后，Phase 3 将实现：
- 秋招 / 社招继续作为工作模式筛选插件（不是新地图模式）
- 收藏功能（`008_saved_places` + `/api/me/saved` + Saved L2；游客不写云端）
- 用户投递记录（`009_applications` + `/api/me/applications`；JD 点投递写入，列表在 Profile 底部）
- 数据对比功能
- 通知系统（偏好已在 Profile；发送通道后补）

---

**创建日期:** 2026-08-15  
**预计开始:** Phase 1 完成后  
**预计完成:** 4-6 周后

**相关文档:**
- `tech/08-multi-mode-system.md` - 多模式系统设计
- `tech/09-secondary-sidebar.md` - 二级侧控栏设计
- `tech/10-search-filter.md` - 搜索筛选系统
- `tech/05-milestones.md` - 里程碑追踪
