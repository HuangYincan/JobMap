# Domain Map Platform

> 🌍 通用领域地图平台 - 一套代码,多个领域(秋招大厂/高考院校/保研/留学/医院/任意 POI)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-3.4-green.svg)](https://postgis.net/)

## ✨ 核心特性

- 🔌 **插件化架构**:换数据源插件 = 换产品(招聘 → 院校 → 租房 → 医院)
- 🗺️ **全屏霸屏式地图**:参考高德官网,100vh 地图 + 所有 UI 悬浮
- 🧠 **AI 深度集成**:简历解析 → 实力评分 → 智能推荐 → AI 助手直接操作地图
- 📍 **PostGIS 空间分析**:最近大厂 / 5km 缓冲圈找房 / 地铁沿线筛选 / 通勤时间计算
- 🎨 **可插拔地图引擎**:高德(国内)/ Mapbox(国外)/ Leaflet,运行时切换
- 👤 **用户画像系统**:上传简历 → AI 解析 → 6 维实力评分(算法/工程/研究/领导力/软实力/匹配度)
- 📊 **混合推荐算法**:实力匹配 + 意向匹配 + 空间偏好 + 协同过滤 + 时间衰减
- 🏢 **多租户**:用户可创建多个地图,公共/私有,上传自定义数据
- 📚 **完整文档**:技术文档 + 使用教程 + 角色协作文档 + API 参考

## 🚀 快速开始

### 前置要求

- Node.js 26+
- Python 3.12+
- Docker(用于 PostgreSQL + PostGIS)
- 高德地图 API Key(免费申请:[https://console.amap.com](https://console.amap.com))

### 启动项目

```bash
# 克隆仓库
git clone https://github.com/HuangYincan/JobMap.git
cd JobMap

# 启动数据库
docker compose up -d db

# 执行数据库迁移
cd db && bash scripts/apply.sh && cd ..

# 配置环境变量
cp server/.env.example server/.env.local
# 编辑 server/.env.local,填入数据库连接和高德 API Key

# 安装依赖并启动前端
cd server
npm install
npm run dev

# (可选)启动爬虫
cd ../crawler
uv sync
uv run python -m app.cli plugin:seed recruitment
```

访问 [http://localhost:3000](http://localhost:3000)

详见 [docs/zh-cn/guide/quick-start.md](docs/zh-cn/guide/quick-start.md)

## 📖 文档

- **使用文档**:[https://map.nvc.ac/doc/zh-cn](docs/zh-cn/) - 快速开始/功能说明/使用教程
- **技术文档**:[DOCS/](DOCS/) - 架构设计/数据模型/插件开发
- **开发指南**:[agent.md](agent.md) - AI Agent 工作规范
- **API 参考**:[docs/zh-cn/developers/api-reference.md](docs/zh-cn/developers/api-reference.md)

## 🧩 插件系统

Domain Map Platform 的核心是**插件化**。目前官方提供:

| 插件 | 领域 | Entity | Item | 说明 |
|---|---|---|---|---|
| 🏢 招聘插件 | recruitment | 公司 | JD | 互联网大厂/央国企招聘信息 |
| 🏠 租房插件 | housing | 房源 | 挂牌 | 与招聘/留学联动,通勤分析 |
| 🎓 院校插件 | university | 大学 | 专业 | 高考志愿填报参考 |
| 👤 用户画像 | user-profile | - | - | 简历上传 → AI 解析 → 实力评分 |
| 🤖 推荐系统 | recommendation | - | - | 5 策略融合推荐 |
| 💬 AI 助手 | ai-assistant | - | - | 对话 → 筛选/高亮/飞行地图 |

**扩展到新领域**:复制插件模板 → 定义 schema → 加载数据 → 完成!(详见 [DOCS/03-plugin-system.md](DOCS/03-plugin-system.md))

## 🏗️ 技术栈

**前端**: Next.js 15 + TypeScript + Tailwind CSS v4 + 高德/Mapbox 地图  
**后端**: Next.js API Routes + NextAuth.js  
**数据库**: PostgreSQL 16 + PostGIS 3.4 + pgvector  
**爬虫**: Python 3.12 + uv + BeautifulSoup4 + Playwright  
**部署**: Docker Compose + Caddy(自动 HTTPS)

详见 [DOCS/01-architecture.md](DOCS/01-architecture.md)

## 🗂️ 项目结构

```
domain-map/
├── server/         # Next.js 前后端(TypeScript)
├── crawler/        # Python 爬虫(插件化)
├── db/             # PostgreSQL migrations
├── tests/          # 单元/集成/E2E 测试
├── docs/           # 公众文档 + 角色协作文档
├── DOCS/           # 技术文档(开发者)
└── scripts/        # 自动化脚本
```

## 🎯 路线图

- [x] **P0**(进行中):项目初始化与文档脚手架(1天)
- [ ] **P1–P2**:插件化基础设施 + 招聘插件 MVP(~5天)
- [ ] **P3–P5**:爬虫系统 + 用户系统 + 租房插件(~5天)
- [ ] **P6–P7**:AI 插件(用户画像 + 推荐系统)+ 院校插件(~5天)
- [ ] **P8–P10**:霸屏式 UI 精修 + 插件管理系统 + RAG 问答(~5天)
- [ ] **P11–P13**:文档网站搭建与内容撰写(~3.5天)

**预计发布时间**:2026-02-10(v1.0)

详见 [DOCS/05-milestones.md](DOCS/05-milestones.md)

## 🤝 贡献

欢迎贡献代码/文档/插件!

1. Fork 本仓库
2. 创建功能分支:`git checkout -b feature/amazing-plugin`
3. 提交代码:`git commit -m 'feat(plugin): add amazing plugin'`
4. 推送分支:`git push origin feature/amazing-plugin`
5. 提交 Pull Request

详见 [DOCS/04-workflow.md](DOCS/04-workflow.md)

## 📄 许可

[MIT License](LICENSE) © 2026 Yincan Huang

## 🙏 致谢

- [PostGIS](https://postgis.net/) - 强大的空间数据库
- [高德地图](https://lbs.amap.com/) - 国内最佳地图服务
- [Next.js](https://nextjs.org/) - 优秀的全栈框架
- [shadcn/ui](https://ui.shadcn.com/) - 精美的 React 组件库

## 📬 联系

- 作者:Yincan Huang
- 邮箱:Yincan_Huang@zju.edu.cn
- GitHub:[@HuangYincan](https://github.com/HuangYincan)
- 项目主页:[https://map.nvc.ac](https://map.nvc.ac)
- 文档:[https://map.nvc.ac/doc/zh-cn](https://map.nvc.ac/doc/zh-cn)

---

**⭐ 如果这个项目对你有帮助,请给一个 Star!**
