# Agent 工作规范

你是 Domain Map Platform 项目的 AI 开发者。本文档定义了你的职责、工作流程和协作规范。

## 核心原则

1. **插件化思维**:一切功能皆插件,一切数据皆可换源
2. **文档先行**:代码变更必须同步更新文档(tech/ 和 docs/)
3. **测试驱动**:关键模块使用 TDD,确保覆盖率 > 80%
4. **角色协作**:按现代化团队角色维护文档(产品/开发/测试/运维/安全)

## 项目结构

```
domain-map/
├── tech/              # 技术文档(架构/数据模型/插件系统/工作流/决策)
├── docs/              # 面向公众的文档网站 + 角色协作文档
├── server/            # Next.js 前后端
├── crawler/           # Python 爬虫
├── db/                # 数据库 migrations
├── tests/             # 测试代码
└── scripts/           # 自动化脚本
```

详见 `tech/01-architecture.md`

## 工作流程

### 1. 接到新任务时

1. **理解需求**:
   - 阅读相关 PRD:`docs/roles/product/PRD/*.md`
   - 查看架构文档:`tech/01-architecture.md`
   - 确认数据模型:`tech/02-data-model.md`

2. **规划实施**:
   - 如果是新插件:参考 `tech/03-plugin-system.md`
   - 如果是 Bug 修复:调用 `/diagnosing-bugs` skill
   - 如果是新功能:先写技术方案到 `docs/roles/development/implementation/`

3. **选择开发方式**:
   - 关键模块(实力评分/推荐算法):使用 `/tdd` skill
   - UI 原型验证:使用 `/prototype` skill
   - 领域模型设计:使用 `/domain-modeling` skill
   - 一般开发:直接实现

### 2. 开发过程中

1. **前端开发铁律**:
   - ⚠️ **任何前端代码编写之前,必须先创建文字符号布局图让用户审查**
   - 使用 ASCII 艺术或简单文字符号创建布局示意图
   - 标注关键尺寸、颜色、交互、组件说明
   - 通知用户:"布局示意图已创建,请审查"
   - 等待用户反馈/修改/批准
   - **只有在用户明确批准后,才能开始编写前端代码**
   - 这条规则无例外:从页面到组件,从 UI 调整到新功能

2. **使用现代化组件库**:
   - ⚠️ **避免重复造轮子,优先使用已有的前端组件库**
   - 液态玻璃组件:使用 [liquid-glass-react](https://github.com/rdev/liquid-glass-react)
   - UI 组件:使用 [shadcn/ui](https://ui.shadcn.com/)
   - 动画:使用 [Framer Motion](https://www.framer.com/motion/)
   - 图标:使用 [React Icons](https://react-icons.github.io/react-icons/)
   - 详见 `tech/07-frontend-design-system.md`

3. **遵循 Apple 设计风格**:
   - 参考 [Apple Maps](https://maps.apple.com.cn/) 布局
   - 液态玻璃质感(半透明、毛玻璃、流动感)
   - 深色/浅色模式自动适应系统设置
   - 极简主义,去除冗余元素
   - 详见 `tech/07-frontend-design-system.md`

4. **遵循规范**:
   - 代码风格:ESLint + Prettier(前端),Black(Python)
   - 命名约定:组件用 PascalCase,函数用 camelCase,数据库表用 snake_case
   - 注释:复杂逻辑必须注释,简单代码不过度注释

5. **及时记录**:
   - 遇到问题记录到 `docs/roles/development/implementation/<phase>.md` 的"遇到的问题"章节
   - 技术决策记录到 `tech/06-decisions.md`(ADR 格式)
   - **布局示意图**记录到对应 Phase 的实施文档中

6. **编写测试**:
   - 单元测试:`tests/unit/`
   - 集成测试:`tests/integration/`
   - E2E 测试:`tests/e2e/`(关键流程必须有)

### 3. 完成后

1. **自我审查**:
   - 运行测试:`make test-unit test-integration`
   - 运行 linter:`npm run lint`(前端),`ruff check .`(Python)
   - 检查文档是否需要更新

2. **提交代码**:
   - 分支命名:`feature/<feature-name>` 或 `fix/<bug-description>`
   - Commit message 格式:`<type>(<scope>): <subject>`
     - type:feat/fix/docs/test/refactor/chore
     - scope:plugin-name 或 module-name
     - 示例:`feat(user-profile): add resume upload and AI parsing`

3. **更新文档**:
   - 同步技术文档:`tech/` 相关章节
   - 如果是新功能,写教程:`docs/zh-cn/tutorial/<feature>.md`
   - 更新角色文档:`docs/roles/development/implementation/<phase>.md`

### 4. Code Review

调用 `/code-review` skill 进行自我审查,检查:
- Standards:是否符合本文档规范
- Spec:是否实现了 PRD 要求
- Security:是否有安全漏洞
- Performance:是否有性能问题
- Testing:测试覆盖率是否达标

## 文档维护契约

### 何时更新 tech/(技术文档)

| 变更类型 | 需要更新的文档 |
|---|---|
| 数据库 schema 变更 | `tech/02-data-model.md` + migration 文件注释 |
| API 端点新增/修改 | `tech/01-architecture.md`(API 清单) |
| 新增插件 | `tech/03-plugin-system.md`(插件注册表) |
| 工作流程变更 | `tech/04-workflow.md` |
| 重大技术决策 | `tech/06-decisions.md`(ADR 格式) |

### 何时更新 docs/(公众文档+角色文档)

| 变更类型 | 需要更新的文档 |
|---|---|
| 新功能上线 | `docs/zh-cn/tutorial/<feature>.md`(使用教程) |
| 功能说明变更 | `docs/zh-cn/features/<feature>.md` |
| 部署流程变更 | `docs/zh-cn/deployment/*.md` |
| 产品需求确定 | `docs/roles/product/PRD/<feature>.md` |
| 开发过程记录 | `docs/roles/development/implementation/<phase>.md` |
| 测试发现 Bug | `docs/roles/testing/test-reports/bug-reports.md` |
| 部署/运维操作 | `docs/roles/operations/monitoring/incident-log.md` |
| 安全漏洞发现 | `docs/roles/security/<red/blue>-team/*.md` |

### 文档同步检查清单

每次提交代码前,问自己:
- [ ] 我改了数据库 schema 吗?→ 更新 `tech/02-data-model.md`
- [ ] 我加了新 API 端点吗?→ 更新 `tech/01-architecture.md`
- [ ] 我实现了新功能吗?→ 写 `docs/zh-cn/tutorial/<feature>.md`
- [ ] 我修了 Bug 吗?→ 记录到 `docs/roles/testing/test-reports/bug-reports.md`
- [ ] 我遇到技术问题吗?→ 记录到 `docs/roles/development/implementation/<phase>.md`
- [ ] **我写了前端代码吗?→ 检查布局示意图是否已获用户批准**

## 插件开发规范

新增领域插件完整清单(以"高考院校"为例):

### 1. 定义 schema
在 `tech/02-data-model.md` 增加领域定义:
```markdown
## 高考院校插件(domain='gaokao')
- entity_type: 'university'
- item_type: 'major'
- 特殊字段:type(985/211)/rank/score_line/tuition
```

### 2. 后端插件
创建 `server/src/lib/plugins/gaokao/`:
- `schema.ts`:领域 schema 定义
- `seed.ts`:种子数据加载器

### 3. 前端组件
创建 `server/src/components/Plugins/gaokao/`:
- `UniversityCard.tsx`:大学卡片
- `MajorList.tsx`:专业列表

### 4. 爬虫插件
创建 `crawler/app/plugins/gaokao/`:
- `schema.py`:数据类(Entity=University, Item=Major)
- `seed/`:种子数据 JSON
- `sources/`:爬虫脚本(可选)

### 5. 注册插件
- 数据库:写入 `domain_schemas` 表
- 代码:在 `server/src/lib/plugins/registry.ts` 注册

### 6. 文档
- 更新 `tech/03-plugin-system.md`:插件清单
- 写教程:`docs/zh-cn/tutorial/gaokao-map.md`

## 与子 Agent 协作

当主 Agent 派发任务给你时,你会收到明确的:
- **背景**:项目架构/数据模型
- **任务**:具体要实现什么
- **交付物**:代码文件 + 测试 + 文档
- **验收标准**:功能要求 + 测试覆盖率
- **依赖**:前置条件/API 已就绪
- **时间线**:预期完成时间

你的职责:
1. 按要求完成任务
2. 编写充分的测试
3. 更新相关文档
4. 遇到问题及时汇报(不要卡住不说)
5. 完成后汇报:已完成内容 + 测试结果 + 遇到的问题

## 故障排查指南

### 数据库连接失败
```bash
# 检查 PostgreSQL 是否运行
docker compose ps db

# 检查连接配置
cat server/.env.local | grep DATABASE_URL
```

### 地图不显示
1. 检查高德 API key 是否配置:`server/.env.local` 的 `NEXT_PUBLIC_AMAP_KEY`
2. 检查浏览器控制台是否有 CORS 错误
3. 检查 entities 表是否有数据:`psql -c "SELECT COUNT(*) FROM entities;"`

### 推荐列表为空
使用 `/diagnosing-bugs` skill,系统化排查:
1. 用户画像是否保存成功?
2. 实力评分是否计算?
3. 推荐算法是否被触发?
4. 候选公司集是否为空?

## 工具与命令

### Makefile 命令
```bash
make dev              # 启动开发环境
make test             # 运行测试(单元+集成)
make test-e2e         # 运行 E2E 测试
make lint             # 代码检查
make verify           # 完整验证(测试+lint+构建)
```

### 数据库管理
```bash
cd db
bash scripts/apply.sh     # 执行所有 migrations
bash scripts/reset.sh     # 重置数据库(危险!)
```

### 爬虫管理
```bash
cd crawler
uv run python -m app.cli plugin:seed recruitment  # 加载招聘插件种子
uv run python -m app.cli crawl --source xiaozhao  # 运行增量爬虫
```

## 记住

- **不要猜测,要验证**:不确定时读代码/查数据库/运行测试
- **不要沉默,要沟通**:卡住时及时汇报,不要浪费时间
- **不要跳过,要完整**:测试和文档是交付物的一部分,不是可选项
- **不要孤立,要复用**:新代码前先搜索是否已有类似实现
- **🎨 前端代码必须先过布局示意图审查**:这是硬性规则,无任何例外
- **🧩 使用现代化组件库,避免重复造轮子**:liquid-glass-react + shadcn/ui
- **🍎 遵循 Apple 设计风格**:参考 Apple Maps 布局,液态玻璃质感

祝编码愉快!🚀
