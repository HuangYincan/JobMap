# 06 - 架构决策记录(ADR)

## ADR-001:采用插件化架构而非硬编码领域

**日期**:2026-08-15  
**状态**:已接受  
**决策者**:Yincan Huang

**背景**:
产品需求是"互联网大厂招聘地图",但扩展需求包括高考院校/保研/留学等多个领域。

**决策**:
采用带来源、地图覆盖层和租户授权的抽象数据模型，而非仅依赖硬编码表。插件 schema 与数据源授权必须分离。

**理由**:
- 一套代码支持任意领域,换数据源=换产品
- 降低维护成本(不需要为每个领域写一套系统)
- 用户可上传自定义数据创建私有插件

**代价**:
- 开发初期需要额外抽象层设计
- 查询性能略低于硬编码表(但 PostGIS 索引可优化)

**替代方案**:
- 硬编码招聘领域表 → 扩展性差,被否决

---

## ADR-002:选择 PostgreSQL + PostGIS 而非 MongoDB

**日期**:2026-08-15  
**状态**:已接受

**背景**:
需要空间查询(最近点/缓冲区/地铁沿线)+ 事务 + 全文搜索。

**决策**:
PostgreSQL 16 + PostGIS 3.4 是 MVP 硬约束；pgvector 延后，须另行验证镜像和 ADR。

**理由**:
- PostGIS 是业界最成熟的空间数据库(KNN/缓冲区/空间索引)
- 支持 ACID 事务(招聘数据一致性重要)
- pg_trgm 支持中文模糊搜索
- pgvector 支持 AI 推荐系统(向量检索)

**代价**:
- 需要学习 PostGIS 语法
- 部署需要 Docker(本地装 PostGIS 较复杂)

**替代方案**:
- MongoDB + geospatial → 空间查询功能弱,被否决
- MySQL + Spatial → 不支持 KNN,被否决

---

## ADR-003:前端采用 Next.js 全栈框架

**日期**:2026-08-15  
**状态**:已接受(2026-08-21 修订为已定案事实:实际落地为 CSS Modules + Next.js 16,Tailwind 从未采用)  
**决策者**:Yincan Huang

**背景**:
需要快速开发全栈应用(前端地图 + 后端 API + SSR)。

**决策**:
Next.js 16 App Router + TypeScript + **CSS Modules** 是实际技术栈(2026-08-21 修订:
初始计划版本为 15.x(2026-08-20 已升级至 16.3.1)并计划 Tailwind CSS v4,但实现全程
采用 CSS Modules,Tailwind 从未引入,本决策以实际落地为准)。见
[01-architecture.md](01-architecture.md)。

**理由**:
- App Router 简化 API 开发(不需要单独后端)
- SSR 优化 SEO(公开地图可被搜索引擎收录)
- CSS Modules 作用域隔离 + 与组件同构,配合设计系统 token 变量(主题系统更灵活)
- 与 React 生态完全兼容(大量地图组件可用)

**代价**:
- Next.js 学习曲线(App Router 新特性较多)
- 部署需要 Node.js 环境(比纯静态站点复杂)

**替代方案**:
- React SPA + Express 后端 → 开发效率低,被否决
- Vue + Nuxt → 团队不熟悉,被否决

---

## ADR-004:爬虫采用 Python + uv 而非 Node.js

**日期**:2026-08-15  
**状态**:已接受

**背景**:
需要支持多个**合规的数据接入方式**，但当前仓库尚未批准或实现任何自动采集。`xiaozhao-radar` 的 `jobs.json` 是 MVP 导入候选；BOSS 直聘和小红书明确不纳入 MVP。

**决策**:
Python 3.12 + uv 是目标导入运行时；具体库和采集方式须逐来源审查后决定。

**理由**:
- Python 爬虫生态成熟(BeautifulSoup/Playwright/Scrapy)
- uv 速度快(比 pip 快 10–100 倍)
- 与前端分离,避免依赖冲突

**代价**:
- 需要维护两套语言栈(Python + TypeScript)
- 数据库连接需要两套驱动(psycopg3 + pg)

**替代方案**:
- Node.js + Cheerio → 动态页面支持差,被否决
- Scrapy → 对简单爬虫过重,被否决

---

## ADR-005:AI 推荐系统采用混合策略

**日期**:2026-08-15  
**状态**:已接受

**背景**:
需要根据用户背景推荐合适的公司/岗位。

**决策**:
候选混合策略：实力匹配、意向匹配、空间偏好、协同过滤、时间衰减。权重未接受，须在有数据和评估集后决定。

**理由**:
- 单一策略容易偏颇(只看实力会推荐太难的,只看意向会推荐不匹配的)
- 混合策略平衡多个维度
- 权重可后期调优

**代价**:
- 计算复杂度高(需要缓存推荐结果)
- 冷启动问题(新用户无历史行为)

**替代方案**:
- 纯协同过滤 → 冷启动严重,被否决
- 纯基于规则 → 不够智能,被否决

---

## ADR-006:地图引擎采用可插拔设计

**日期**:2026-08-15  
**状态**:已接受

**背景**:
用户可能需要不同地图引擎(国内用高德,国外用 Mapbox)。

**决策**:
抽象统一接口,支持运行时切换引擎(高德/Mapbox/Leaflet)。

**理由**:
- 避免被单一厂商锁定
- 国内外用户需求不同(国内高德/国外 Mapbox)
- 未来可能有更好的地图引擎

**代价**:
- 需要维护多个 adapter
- 功能只能取交集(不能用某个引擎的特有功能)

**替代方案**:
- 硬编码高德 API → 不支持国外用户,被否决

---

## ADR-007:公司 favicon 服务采用 favicon.im(替代被墙的 Google s2)

**日期**:2026-08-19
**状态**:已接受
**决策者**:ws3(20260819-boss-fix-polish)

**背景**:
用户报「公司无对应 icon」。DB 实测 672 家公司 `logo_url` 100% 空、`logo_emoji`
99.7% 空;且此前 `faviconFromUrl` 生成的 `https://www.google.com/s2/favicons`
URL 在国内被墙,浏览器端即使有 URL 也加载失败 → 全部回退 🏢。

**决策**:
`faviconFromUrl` 改用 favicon.im:`https://favicon.im/{host}?size={size}`。
favicon.im 是国内运营的免费 favicon API(中文文档,CDN `a.favicon.im`),
面向国内用户设计,替代国内不可达的 Google s2。

**可达性验证(2026-08-19 本机 node fetch 实测,记录于批量日志
`20260819-boss-fix-polish/logs/ws3-favicon-probe.test.mjs`)**:

| 候选 | 状态 | Content-Type | 大小 | 耗时 | 结论 |
|---|---|---|---|---|---|
| google s2 (`/s2/favicons?sz=128`) | 200 | image/png | 1465B | 2672ms | 本机 egress 可达,但 boss/Explore 已实测国内浏览器被墙 → 弃 |
| **favicon.im** (`/alibaba.com?size=128`) | **200** | **image/x-icon** | **1406B** | **1288–2888ms** | **选定**(重复两轮稳定) |
| favicon.im 子域名 (`/talent.alibaba.com?size=128`) | 200 | image/x-icon | 1150B | 2965ms | 子域名可用(链的站点级输入) |
| favicon.im (`/careers.tencent.com?size=128`) | 200 | image/svg+xml | 257B | 3114ms | 返回站点自身图标(svg 浏览器可显示) |
| icon.horse (`/icon/alibaba.com`) | 200 | image/x-icon | 1406B | 246–1293ms | 可用但为国际 CDN,国内可达性未验证 → 备选 |
| faviconkit (`/alibaba.com/128`) | 200 | image/png | 70B | 2272ms | 返回 1×1 占位像素,图标缺失 → 弃 |
| api.iowen.cn | 404 | text/html | 479B | 131ms | 弃 |

**理由**:
- 国内可达:中文运营 + 国内 CDN,是国内社区常用免费图标服务;Google s2 已实测被墙
- URL 形态与旧实现同构(`{host}` + `?size=`),`faviconFromUrl` 签名不变
- 子域名直接可用(链上 `siteCareerUrl`/`companyCareerUrl` 多为招聘子域名)

**代价/风险**:
- 免费服务有速率限制/可用性风险;已留备选 icon.horse(实测 200),
  如 favicon.im 故障可一行切换
- 本机 egress 与真实国内浏览器网络不完全等价,上线后需在浏览器端抽查

**后续(2026-08-26, fix/brand-logo-landmark)**:
favicon.im 解决的是「生成了 URL 但国内被墙」,但很多公司 logo 仍是通用占位:
833 个 POI 中 822 个 logo 走 favicon,而大量 careerUrl 指向**第三方招聘托管平台**
(`*.mokahr.com` / `*.jobs.feishu.cn` / `*.zhiye.com` / `wecruit.hotjob.cn`),其 favicon
是平台默认图标,非公司品牌;大厂自有招聘域(join.qq.com / jobs.bytedance.com)favicon
也未必是品牌主 logo。→ 新增 `BRAND_LOGO_MAP`(公司名 → 品牌官网 host),在
`resolveCompanyLogo` 的 companyCareerUrl favicon 之前插入:命中则 favicon 指向品牌官网
(`https://favicon.im/<brand-host>?size=128`,source=`company`)。键全部取自离线目录
`p.name` 全集(仅收录实际存在且域名确定的知名大厂,不造表);只在公司层插入,站点层不插
> ⚠️ **2026-08-26 修订(严格 DB-only)**:该离线目录(seed 骨架 + 真实 drop)已移除,
> seed 示例数据归档 `tech/backup/seed-data`;`BRAND_LOGO_MAP` 静态表保留不变。
(站点可能只是招聘子站点,未必是主品牌)。无品牌映射的第三方托管平台维持平台 favicon。

---

## ADR-008:求职导航的地图/路线边界与供应商保守默认

**日期**:2026-08-28
**状态**:已接受

**背景**:
求职导航需要同时处理浏览器地图呈现和服务端路线规划，但两者的权限、坐标、失败语义和
调用位置不同。路线供应商的产品权限、调用顺序、条款、配额、缓存/展示与商业授权仍需
人工确认。

**决策**:

1. 浏览器侧 `MapEngine` 与服务端 `RouteProvider` 是不同边界：前者只负责底图和覆盖物呈现；
   后者负责路线请求、供应商结果归一化，以及错误、超时和质量语义。
2. 在供应商产品权限、调用顺序、条款、配额、缓存/展示与商业授权经人工确认前，不选择、
   注册、配置或调用任何真实路线供应商。
3. WS1 在 provider 侧仅实现 provider-neutral 接口和显式 `estimate` adapter，并实现受校验的
   route service、进程内有界 artifact store 与薄 API；不实现或注册 live adapter，不得把估算
   伪装成 `provider_route`。
4. WS0/WS1 不持久化产品分析事件，不得复用 `audit_events`；后续事件 sink 与留存策略必须
   独立决策。

**当前状态**:

WS0 已实现导航契约、纯校验、离线 fixture 和供应商约束审查；WS1 已实现
`route-provider.ts`、`route-service.ts`、`estimate-provider.ts`、会话指纹与有界
`route-artifacts.ts`，以及两个 `no-store` navigation route handler。artifact store 同时限制
1,000 entries 与 50,000 aggregate geometry points；单条超预算拒绝，写入导致超预算时淘汰最老
entry。provider 成功结果只有在身份、数值、TTL、坐标系、geometry 点数/范围和起终点偏差通过
后，才由服务端 CSPRNG 签发 `routeId` 并写入会话隔离 artifact；estimate 始终没有 ID 或
geometry。独立 navigation cookie 为 host-only、HttpOnly、SameSite=Lax、`Path=/api`，供后续
Agent API 与 route handlers 共享；navigation 错误 JSON 遵循顶层 `{ code, message, retryable }`。

WS2 已合并 Agent 域工具（岗位搜索/详情、规划、比较、通勤过滤）、`showRoute` 格式校验，以及
`/api/agent/chat` 与 navigation handlers 共享的会话 cookie。

WS4 已实现 `MapView.createPolyline`、`MapBridge.drawRoute`、合法 `showRoute` 的同会话 GET 画线、
Work 通勤对比表组件与地图来源条。Explore 内页签（岗位 / 对比 / 行程）已于 2026-08-31 按用户要求移除；
Explore 不再展示起点/出行方式/上限分钟/严格命中粗筛头，列表不按通勤裁剪。生产构造器仍注册零个 live provider，因此 overlay 在生产中只能展示
直线估算或（若存在未过期 provider artifact 的）已签发折线；没有真实路况或供应商 arrival-by。

WS3 已实现可替换产品事件 sink（`createMemorySink` / `createJsonlSink`）和离线 eval runner
（playbook + 槽位/工具/非法动作/质量标注指标 + SQL/Python 报告）。sink 默认不接到生产 chat
或 RouteService；事件不落库，不复用 `audit_events`。

生产构造器仍注册零个 live provider，正常规划结果只是明确标注的直线估算；没有真实道路路线、
实时路况或供应商 arrival-by 能力。analytics persistence 与 live provider adapter 仍未实现。
前端 overlay 已实现，但不把估算伪装成道路。详细供应商事实与未核实项见
`tech/roles/development/architecture/navigation-route-provider-review.md`。

---

## 未来待决策

- **数据库 ORM 选型**:Drizzle vs Prisma
- **部署方案**:VPS Docker vs Vercel Serverless
- **缓存策略**:Redis vs PostgreSQL UNLOGGED 表
- **CI/CD 工具**:GitHub Actions vs GitLab CI

决策后补充到本文档。
