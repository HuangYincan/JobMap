# 01 - 插件化架构全景

## 概述

Domain Map Platform 是一个**通用领域地图平台**,核心理念:**一切功能皆插件、一切数据皆可换源**。换数据源插件,产品就能从"秋招大厂地图" → "高考院校地图" → "保研项目地图" → "留学费用地图"。

## 技术栈

### 前端

- **框架**:Next.js 15(App Router)+ TypeScript + React 19
- **样式**:Tailwind CSS v4(CSS 变量 + 主题系统)
- **地图引擎**:可插拔,默认高德 JS API 2.0,预留 Mapbox GL JS / Leaflet 适配器
- **状态管理**:React Context + Zustand(复杂状态)
- **UI 组件**:shadcn/ui + Radix UI
- **图表**:ECharts / Recharts(用户画像雷达图)

### 后端

- **框架**:Next.js App Router(API Routes)
- **认证**:NextAuth.js v5(邮箱/GitHub OAuth)
- **ORM**:Drizzle ORM / Prisma(待定)
- **验证**:Zod

### 数据库

- **主数据库**:PostgreSQL 16
- **空间扩展**:PostGIS 3.4(核心竞争力)
- **全文搜索**:pg_trgm(模糊搜索公司名)
- **向量数据库**:pgvector(AI 推荐系统)

### 爬虫

- **语言**:Python 3.12
- **包管理**:uv(快速依赖管理)
- **框架**:自研插件化爬虫系统(基于 asyncio)
- **库**:httpx / BeautifulSoup4 / Playwright(动态页面)

### 部署

- **容器化**:Docker Compose(开发环境)
- **反向代理**:Caddy(自动 HTTPS)
- **监控**:Grafana + Prometheus(可选)

## 目录结构

```
domain-map/
├── agent.md                           # AI Agent 工作规范
├── README.md                          # 项目首页
├── LICENSE                            # MIT 许可
├── Makefile                           # 自动化命令
├── docker-compose.yml                 # PostgreSQL + PostGIS
│
├── DOCS/                              # 技术文档(开发者)
│   ├── README.md                      # 文档索引
│   ├── 01-architecture.md             # 本文档
│   ├── 02-data-model.md               # 抽象数据模型
│   ├── 03-plugin-system.md            # 插件开发指南
│   ├── 04-workflow.md                 # 贡献工作流
│   ├── 05-milestones.md               # 项目里程碑
│   └── 06-decisions.md                # 架构决策记录(ADR)
│
├── docs/                              # 面向公众的文档网站
│   ├── .vitepress/                    # VitePress 配置
│   ├── zh-cn/                         # 中文文档
│   │   ├── index.md                   # 首页
│   │   ├── guide/                     # 指南(介绍/快速开始/FAQ)
│   │   ├── tutorial/                  # 教程(招聘地图/租房地图/通勤分析)
│   │   ├── features/                  # 功能说明(地图交互/插件系统)
│   │   ├── developers/                # 开发者(架构/API 参考)
│   │   └── deployment/                # 部署指南
│   └── roles/                         # 角色协作文档(内部)
│       ├── README.md                  # 角色体系说明
│       ├── product/                   # 产品经理(PRD/路线图)
│       ├── development/               # 开发(架构/实施记录)
│       ├── testing/                   # 测试(测试计划/Bug 报告)
│       ├── operations/                # 运维(部署/监控/故障记录)
│       ├── security/                  # 安全(红队/蓝队)
│       └── data/                      # 数据(ETL/数据质量)
│
├── server/                            # Next.js 前后端
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── .env.local                     # 环境变量
│   └── src/
│       ├── app/                       # App Router
│       │   ├── layout.tsx             # 全局布局(Providers)
│       │   ├── page.tsx               # 首页(公共地图列表)
│       │   ├── map/[mapId]/page.tsx   # 地图详情页
│       │   ├── profile/               # 用户画像页面
│       │   ├── recommendations/       # 推荐列表页面
│       │   └── api/                   # API Routes
│       │       ├── maps/route.ts      # 地图 CRUD
│       │       ├── entities/route.ts  # 实体查询(bbox/domain 过滤)
│       │       ├── items/route.ts     # 条目查询(entityId)
│       │       ├── profile/route.ts   # 用户画像 CRUD
│       │       ├── recommendations/route.ts  # 推荐列表
│       │       ├── spatial/route.ts   # PostGIS 空间查询
│       │       ├── plugins/           # 插件相关 API
│       │       │   ├── route.ts       # 插件清单
│       │       │   └── ai/route.ts    # AI 助手对话
│       │       └── auth/[...nextauth]/route.ts  # NextAuth
│       ├── components/
│       │   ├── Map/                   # 地图组件
│       │   │   ├── MapView.tsx        # 地图容器
│       │   │   ├── MapEngineAdapter.tsx  # 引擎抽象层
│       │   │   ├── CityBubbleLayer.tsx   # 城市气泡层
│       │   │   ├── EntityLayer.tsx       # 实体 POI 层
│       │   │   └── EntityDrawer.tsx      # POI 详情抽屉
│       │   ├── UI/                    # 通用 UI 组件
│       │   │   ├── ThemeToggle.tsx    # 主题切换
│       │   │   ├── MapEnginePicker.tsx  # 地图引擎切换
│       │   │   ├── SearchBox.tsx      # 搜索框
│       │   │   └── FloatingPanel.tsx  # 悬浮面板基础组件
│       │   └── Plugins/               # 插件前端组件
│       │       ├── recruitment/       # 招聘插件
│       │       │   ├── JobCard.tsx
│       │       │   └── CompanyBadge.tsx
│       │       ├── housing/           # 租房插件
│       │       ├── user-profile/      # 用户画像插件
│       │       │   ├── ProfileForm.tsx
│       │       │   ├── ResumeUploader.tsx
│       │       │   └── StrengthRadar.tsx
│       │       └── recommendation/    # 推荐系统插件
│       │           └── RecommendationList.tsx
│       └── lib/
│           ├── db.ts                  # 数据库连接
│           ├── queries.ts             # 查询函数
│           ├── types.ts               # TypeScript 类型
│           ├── auth.ts                # NextAuth 配置
│           ├── map-engines/           # 地图引擎适配器
│           │   ├── base.ts            # 统一接口定义
│           │   ├── amap.adapter.ts    # 高德实现
│           │   ├── mapbox.adapter.ts  # Mapbox 占位
│           │   └── leaflet.adapter.ts # Leaflet 占位
│           └── plugins/
│               ├── registry.ts        # 插件注册表
│               └── recruitment/       # 招聘插件后端逻辑
│                   ├── schema.ts
│                   └── seed.ts
│
├── crawler/                           # Python 爬虫
│   ├── pyproject.toml                 # uv 项目配置
│   ├── .env                           # 环境变量
│   └── app/
│       ├── __init__.py
│       ├── cli.py                     # 命令行入口
│       ├── main.py                    # 调度器
│       ├── db.py                      # 数据库连接
│       ├── geocode.py                 # 地理编码
│       ├── core/                      # 核心抽象
│       │   ├── base_crawler.py        # 抽象爬虫(幂等 upsert)
│       │   └── plugin_loader.py       # 插件动态加载
│       └── plugins/                   # 领域插件
│           ├── recruitment/           # 招聘插件
│           │   ├── schema.py          # 数据类
│           │   ├── seed/              # 种子数据
│           │   │   ├── companies_seed.json
│           │   │   ├── offices_seed.json
│           │   │   └── load_xiaozhao.py  # 校招雷达加载器
│           │   └── sources/           # 爬虫脚本
│           │       ├── xiaozhao_radar.py
│           │       └── ats.py         # ATS 系统爬虫
│           ├── housing/               # 租房插件
│           ├── university/            # 院校插件(示范)
│           └── user_profile/          # 用户画像插件
│               └── strength_score.py  # 实力评分算法
│
├── db/                                # 数据库
│   ├── migrations/                    # SQL 迁移脚本
│   │   ├── 001_core.sql               # 核心抽象表
│   │   ├── 002_recruitment.sql        # 招聘插件(可选视图/索引)
│   │   ├── 003_user_profile.sql       # 用户画像插件
│   │   ├── 004_housing_metro.sql      # 租房+地铁插件
│   │   └── 005_recommendation.sql     # 推荐系统插件
│   └── scripts/
│       ├── apply.sh                   # 执行所有 migrations
│       └── reset.sh                   # 重置数据库(危险)
│
├── tests/                             # 测试代码
│   ├── README.md                      # 测试运行指南
│   ├── pytest.ini / jest.config.js
│   ├── fixtures/                      # 测试数据
│   ├── unit/                          # 单元测试
│   │   ├── backend/                   # Python 单测
│   │   └── frontend/                  # TypeScript 单测
│   ├── integration/                   # 集成测试
│   ├── e2e/                           # 端到端测试(Playwright)
│   ├── performance/                   # 性能测试(Locust)
│   ├── security/                      # 安全测试
│   └── smoke/                         # 冒烟测试(< 2min)
│
├── scripts/                           # 自动化脚本
│   ├── dev.sh                         # 启动开发环境
│   ├── verify.sh                      # 完整验证(测试+lint)
│   └── new-plugin.sh                  # 生成新插件脚手架
│
├── static/                            # 静态文件
│   ├── screenshots/                   # 教程截图
│   └── resumes/                       # 用户上传的简历
│
├── .claude/                           # Claude Code 配置
│   ├── skills/                        # 自定义 skills
│   │   ├── doc-maintenance/
│   │   ├── domain-map-env/
│   │   └── plugin-dev/
│   └── plans/                         # 规划文档
│
└── .github/
    └── workflows/
        ├── test.yml                   # CI 测试流水线
        └── deploy.yml                 # CD 部署流水线
```

## 核心抽象:插件化架构

### 数据模型抽象

**传统方式**(硬编码):
```sql
CREATE TABLE companies (...);  -- 只能存公司
CREATE TABLE jobs (...);       -- 只能存招聘岗位
```

**我们的方式**(抽象 + 插件):
```sql
CREATE TABLE entities (...);   -- 通用实体(可以是公司/大学/医院)
CREATE TABLE items (...);      -- 通用条目(可以是JD/专业/科室)
CREATE TABLE domain_schemas (...);  -- 领域插件配置(定义 entities/items 的字段)
```

换插件 = 换 `domain_schemas` 的一行配置 + 换数据源。详见 [02-data-model.md](02-data-model.md)

### 前端组件复用

**MapView.tsx**(通用地图容器)→ 所有领域复用  
**EntityLayer.tsx**(通用实体层)→ 根据 `domain_schemas` 动态渲染  
**EntityDrawer.tsx**(通用抽屉)→ 根据 `domain_schemas.item_fields` 动态生成表单

特殊领域可覆盖:
```tsx
if (domain === 'recruitment') return <JobCard />  // 招聘领域特殊渲染
else return <GenericItemCard />  // 其他领域通用渲染
```

### 爬虫插件化

**BaseCrawler**(抽象基类):
- 定义统一接口:`fetch() → parse() → upsert_entities() → upsert_items()`
- 提供幂等 upsert 逻辑(避免重复数据)

**领域插件**(如 `plugins/recruitment/`):
- 继承 `BaseCrawler`
- 实现 `parse()` 方法(解析该领域的数据)
- 注册到调度器

换领域 = 写一个新插件(复制 `recruitment` 模板改)。详见 [03-plugin-system.md](03-plugin-system.md)

## API 设计

### RESTful 端点

**地图相关**:
```
GET    /api/maps              # 用户地图列表
POST   /api/maps              # 创建地图
GET    /api/maps/:id          # 地图详情
PUT    /api/maps/:id          # 更新地图配置
DELETE /api/maps/:id          # 删除地图
```

**实体查询**:
```
GET    /api/entities          # 查询实体(bbox/domain/mapId 过滤)
  ?bbox=120.0,30.2,120.2,30.3   # 地图可视区域
  &domain=recruitment            # 领域过滤
  &mapId=1                       # 地图 ID
  
GET    /api/entities/:id      # 单个实体详情
```

**条目查询**:
```
GET    /api/items             # 查询条目
  ?entityId=123                  # 某实体的所有条目(如某公司的 JD)
  &mapId=1
  &isActive=true                 # 只看活跃条目
```

**空间分析**(PostGIS):
```
GET    /api/spatial/nearest   # 最近 N 个实体(KNN)
  ?lng=120.1&lat=30.28&domain=recruitment&limit=10
  
GET    /api/spatial/buffer    # 缓冲区内实体
  ?centerEntityId=123&radiusKm=5&targetDomain=housing
  
GET    /api/spatial/metro     # 地铁沿线实体
  ?lineName=1号线&distanceM=500&targetDomain=housing
```

**用户画像**:
```
POST   /api/profile           # 创建/更新画像
GET    /api/profile           # 获取当前用户画像
POST   /api/profile/resume    # 上传简历(AI 解析)
GET    /api/profile/strength  # 获取实力评分
```

**推荐系统**:
```
GET    /api/recommendations   # 获取推荐列表
  ?limit=20                      # 返回 Top-N
```

**插件管理**:
```
GET    /api/plugins           # 可用插件清单
GET    /api/user/plugins      # 当前用户启用的插件
POST   /api/user/plugins/:code   # 启用/配置插件
PUT    /api/user/plugins/order   # 更新插件显示顺序
POST   /api/user/plugins/upload  # 上传数据创建自定义插件
```

**AI 助手**:
```
POST   /api/plugins/ai/chat   # AI 对话
  Body: { message: "我浙大CS,GPA 3.6,推荐大厂?" }
  Response: {
    message: "根据你的背景,推荐...",
    items: [...],
    map_action: { type: "filter_and_highlight", entity_ids: [...] }
  }
```

## 前端设计:霸屏式全屏地图

**核心理念**:地图占据 100vw × 100vh,所有 UI 组件以悬浮插件形式覆盖。

### 布局结构

```
┌─────────────────────────────────────────────────┐
│  [Logo]  [搜索框]  [主题] [地图引擎] [用户]     │ ← 顶部悬浮栏(毛玻璃)
├─────────────────────────────────────────────────┤
│  [侧边栏]                     [AI助手]          │ ← 左/右悬浮面板
│   - 最近大厂                  💬 对话框          │
│   - 我的收藏                  [列表]            │
│   - 插件列表                                    │
│                                                 │
│               地图画布(100%)                    │
│                                                 │
│  [比例尺] [测距] [图层]                         │ ← 左下角地图工具
│  [定位] [缩放 ± ]               [插件管理]      │ ← 右下角悬浮按钮
└─────────────────────────────────────────────────┘
```

参考:https://gaode.com (高德官网)

### 样式规范

- **颜色**:深色主题 `#0a0d12`,浅色 `#f8fafc`
- **毛玻璃**:`backdrop-filter: blur(12px)` + 半透明背景
- **圆角**:悬浮面板 `16px`,按钮 `8px`
- **阴影**:`box-shadow: 0 4px 24px rgba(0,0,0,0.12)`
- **动画**:面板折叠 `transition: transform 0.3s ease`,地图飞行 `flyTo` 用 easing

## 主题系统

Tailwind v4 + CSS 变量:

```css
:root {
  --color-bg-primary: #f8fafc;
  --color-text-primary: #0f172a;
  --color-accent-cool: #38bdf8;
  --color-accent-warm: #f97316;
}

:root[data-theme="dark"] {
  --color-bg-primary: #0a0d12;
  --color-text-primary: #f8fafc;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg-primary: #0a0d12;
    --color-text-primary: #f8fafc;
  }
}
```

`ThemeToggle.tsx` 切换 `<html data-theme="dark">`。

## 地图引擎抽象层

统一接口:
```typescript
interface MapEngine {
  init(container: HTMLElement, options: MapOptions): Promise<MapInstance>;
  addMarker(instance: MapInstance, marker: Marker): void;
  addCluster(instance: MapInstance, markers: Marker[]): void;
  geocode(address: string): Promise<{lng, lat}>;
  onZoomChange(instance: MapInstance, cb: (zoom: number) => void): void;
}
```

每个引擎一个 adapter:
- `amap.adapter.ts`:高德 JS API 2.0
- `mapbox.adapter.ts`:Mapbox GL JS(占位)
- `leaflet.adapter.ts`:Leaflet(占位)

`MapView` 根据 `mapConfig.engine` 动态加载对应 adapter。

## 开发流程

1. **启动数据库**:`docker compose up -d db`
2. **执行 migrations**:`cd db && bash scripts/apply.sh`
3. **启动前端**:`cd server && npm run dev`
4. **启动爬虫**(可选):`cd crawler && uv run python -m app.cli`

访问 http://localhost:3000

详见 [04-workflow.md](04-workflow.md)

## 下一步

- 阅读 [02-data-model.md](02-data-model.md) 理解抽象数据模型
- 阅读 [03-plugin-system.md](03-plugin-system.md) 学习如何开发新插件
- 查看 [05-milestones.md](05-milestones.md) 了解开发进度
