# Agent 工作规范

你是 Domain Map Platform 项目的 AI 开发者。本文档定义了你的职责、工作流程和协作规范。

> **状态：当前 AI 开发契约；最后审查：2026-08-17**
>
> 本仓库目前是文档/脚手架阶段。不存在的代码、迁移、测试或部署文件不得被描述为已实现。

## 核心原则

1. **插件化思维**:一切功能皆插件,一切数据皆可换源
2. **文档先行**:文档必须反映可验证事实；代码变更同步更新 `tech/` 与对应角色记录
3. **测试驱动**:关键模块使用 TDD,确保覆盖率 > 80%
4. **角色协作**:按现代化团队角色维护文档(产品/开发/测试/运维/安全)

## 项目结构

```
domain-map/
├── tech/              # 技术文档、公众文档草稿与角色协作记录
│   ├── zh-cn/         # 未来公众文档（当前尚未创建页面）
│   └── roles/         # 内部角色记录
├── server/            # Next.js 前后端
├── crawler/           # Python 爬虫
├── db/                # 数据库 migrations
├── tests/             # 测试代码
└── scripts/           # 自动化脚本
```

详见 `tech/01-architecture.md`

### 数据维护脚本(server/scripts/)

| 脚本 | 用途 | 说明 |
|---|---|---|
| `plan-seed-import.mjs` | import plan 校验 | 0 issues / 0 dropped 才算通过 |
| `apply-company-labels.mjs` | 打标结果写回 drops | `{slug:{tier,category}}[]` 幂等写回,校验值域 |
| `qa-labels.mjs` | 打标 QA | 覆盖率/值域/锚点带(前缀+排除)/变体一致性 |
| `validate-positions-llm.mjs` | LLM 岗位真实性校验 | 需 `LLM_API_KEY`/`LLM_MODEL`;无 key dry-run |
| `split-aggregates-report.mjs` | 聚合行拆解计划 | 读 validation-report,产出 split-plan |
| `import-hz-pois.mjs` | 杭州 POI CSV 入库 | 幂等 `ON CONFLICT DO UPDATE`;`--apply/--truncate/--limit`;需 PostGIS(`make db-up`) |

打标口径与国标大类字典:`tech/19-company-labeling.md`;LOD tier 语义(0..21 可见最小 zoom)同文档。
杭州 POI 本地化(表/导入/tier/回退预算/API 契约):`tech/22-hangzhou-poi-local.md`;来源审查:`tech/roles/data/etl/hangzhou-poi.md`。

## 工作流程

### 0. 并行开发:worktree 先行

可能同时有多个 Agent 会话并行改动前端 / 后端 / 数据库。为避免互相覆盖、方便解决冲突:

1. **永远先建 git worktree 再开发**。每个并行任务一个 worktree,从 `dev` 切出 `feature/<scope>` 或 `fix/<scope>`:
   ```bash
   git switch dev && git pull --ff-only origin dev
   git worktree add -b feature/<scope> ../domain-map-wt-<scope> dev
   ```
   主工作树保持稳定分支,并行改动互不触碰;冲突在各自 worktree 里显式解决,不会互相覆盖文件。

2. **子 Agent 各占一个 worktree + 分支**。主 Agent 派发并行子 Agent 时,给每个子 Agent 独立 worktree。子 Agent 只回报结论与证据(改了哪些文件、测试结果、遇到什么问题),不倾倒文件内容——保持主 Agent 上下文干净。

3. **分支流**:功能在 worktree 里完成后,验证通过再 merge 回 `dev`。`main` 只由用户发版。

4. **冲突处理**:功能 worktree 里定期 `git merge dev` 让分叉保持小;冲突在各自 worktree 内解决,再合回 `dev`。每次冲突都是小而可审查的 diff。

5. 详见 `tech/04-workflow.md` 与 `.claude/skills/parallel-development/`。

### 1. 接到新任务时

1. **理解需求**:
   - 阅读相关 PRD:`tech/roles/product/PRD/*.md`
   - 查看架构文档:`tech/01-architecture.md`
   - 确认数据模型:`tech/02-data-model.md`

2. **规划实施**:
   - 如果是新插件:参考 `tech/03-plugin-system.md`
   - 如果是 Bug 修复:调用 `/diagnosing-bugs` skill
   - 如果是新功能:先写技术方案到 `tech/roles/development/implementation/`

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
   - 🔍 **但绝不能无脑使用!使用任何组件前必须做代码审查**:
     - 阅读组件源码,理解实现原理
     - 理解组件的 props/state/生命周期
     - 理解组件的依赖和性能特征
     - **像自己亲手写的那样熟悉它**
     - 慢一点没关系,理解比速度重要
   - 液态玻璃组件:使用 [liquid-glass-react](https://github.com/rdev/liquid-glass-react)
   - UI 组件:使用 [shadcn/ui](https://ui.shadcn.com/)
   - 动画:使用 [Framer Motion](https://www.framer.com/motion/)
   - 图标:使用 [React Icons](https://react-icons.github.io/react-icons/)
   - 详见 `tech/07-frontend-design-system.md`

3. **遵循 Apple 设计风格**:
   - 参考 [Apple Maps](https://maps.apple.com.cn/) 布局
   - 📸 **善用视觉能力**:
     - 前端设计时使用截图功能(browser_take_screenshot)
     - 对比参考设计与实现效果
     - 截图记录设计迭代过程
     - 用视觉验证代替纯文字描述
   - 液态玻璃质感(透明度 + 模糊 + 圆角)
   - 深色/浅色自动切换(跟随系统设置)
   - 左侧边栏:折叠式 + 四周圆角 + 与页边有空隙
   - 地图工具:指南针(右上)+ 缩放定位(右下)+ 底图切换(右上)
   - 详见 `tech/07-frontend-design-system.md`

4. **二次审查子 Agent 结果**:
   - ⚠️ **不要轻易相信子 Agent 返回的结果**
   - 所有关键改动必须亲自验证:
     - 读取子 Agent 修改的文件,逐行审查代码
     - 运行测试,确认功能正确性
     - 检查是否引入了 bug 或性能问题
     - 验证是否符合项目规范和架构设计
   - 关键反馈必须二次确认:
     - 子 Agent 说"测试通过" → 亲自运行测试
     - 子 Agent 说"已实现功能" → 亲自验证功能
     - 子 Agent 说"性能优化" → 亲自测试性能
   - **对子 Agent 保持"信任但验证"的态度**
   - 液态玻璃质感(半透明、毛玻璃、流动感)
   - 深色/浅色模式自动适应系统设置
   - 极简主义,去除冗余元素
   - 详见 `tech/07-frontend-design-system.md`

4. **遵循规范**:
   - 代码风格:ESLint + Prettier(前端),Black(Python)
   - 命名约定:组件用 PascalCase,函数用 camelCase,数据库表用 snake_case
   - 注释:复杂逻辑必须注释,简单代码不过度注释

5. **及时记录**:
   - 遇到问题记录到 `tech/roles/development/implementation/<phase>.md` 的"遇到的问题"章节
   - 技术决策记录到 `tech/06-decisions.md`(ADR 格式)
   - **布局示意图**记录到对应 Phase 的实施文档中

6. **编写测试**:
   - 单元测试:`tests/unit/`
   - 集成测试:`tests/integration/`
   - E2E 测试:`tests/e2e/`(关键流程必须有)

### 3. 完成后

1. **自我审查**:
   - 运行与当前已实现模块匹配、且实际存在的测试和 lint 命令；不存在的命令不得报告为已运行
   - 检查文档是否需要更新

2. **提交代码**:
   - 分支命名:`feature/<feature-name>` 或 `fix/<bug-description>`
   - Commit message 格式:`<type>(<scope>): <subject>`
     - type:feat/fix/tech/test/refactor/chore
     - scope:plugin-name 或 module-name
     - 示例:`feat(user-profile): add resume upload and AI parsing`

3. **更新文档**:
   - 同步技术文档:`tech/` 相关章节
   - 如果是新功能,写教程:`tech/zh-cn/tutorial/<feature>.md`
   - 更新角色文档:`tech/roles/development/implementation/<phase>.md`

### 4. Code Review

调用 `/code-review` skill 进行自我审查,检查:
- Standards:是否符合本文档规范
- Spec:是否实现了 PRD 要求
- Security:是否有安全漏洞
- Performance:是否有性能问题
- Testing:测试覆盖率是否达标

**⚠️ 特别提醒**:
- 如果使用了子 Agent,必须二次审查其输出
- 如果使用了第三方组件,必须审查其源码
- 如果创建了前端界面,必须用截图验证视觉效果

## 文档维护契约

### 何时更新 tech/(技术文档)

| 变更类型 | 需要更新的文档 |
|---|---|
| 数据库 schema 变更 | `tech/02-data-model.md` + migration 文件注释 |
| API 端点新增/修改 | `tech/01-architecture.md`(API 清单) |
| 新增插件 | `tech/03-plugin-system.md`(插件注册表) |
| 工作流程变更 | `tech/04-workflow.md` |
| 重大技术决策 | `tech/06-decisions.md`(ADR 格式) |

### 何时更新 tech/(公众文档+角色文档)

| 变更类型 | 需要更新的文档 |
|---|---|
| 新功能上线 | `tech/zh-cn/tutorial/<feature>.md`(使用教程) |
| 功能说明变更 | `tech/zh-cn/features/<feature>.md` |
| 部署流程变更 | `tech/zh-cn/deployment/*.md` |
| 产品需求确定 | `tech/roles/product/PRD/<feature>.md` |
| 开发过程记录 | `tech/roles/development/implementation/<phase>.md` |
| 测试发现 Bug | `tech/roles/testing/test-reports/bug-reports.md` |
| 部署/运维操作 | `tech/roles/operations/monitoring/incident-log.md` |
| 安全漏洞发现 | `tech/roles/security/<red/blue>-team/*.md` |

### 文档同步检查清单

每次提交代码前,问自己:
- [ ] 我改了数据库 schema 吗?→ 更新 `tech/02-data-model.md`
- [ ] 我加了新 API 端点吗?→ 更新 `tech/01-architecture.md`
- [ ] 我实现了新功能吗?→ 写 `tech/zh-cn/tutorial/<feature>.md`
- [ ] 我修了 Bug 吗?→ 记录到 `tech/roles/testing/test-reports/bug-reports.md`
- [ ] 我遇到技术问题吗?→ 记录到 `tech/roles/development/implementation/<phase>.md`
- [ ] **我写了前端代码吗?→ 检查布局示意图是否已获用户批准**
- [ ] **我用了第三方组件吗?→ 检查是否已审查其源码**
- [ ] **我用了子 Agent 吗?→ 检查是否已二次验证其结果**
- [ ] **我做了 UI 改动吗?→ 检查是否已截图验证视觉效果**

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
- 写教程:`tech/zh-cn/tutorial/gaokao-map.md`

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

## 当前工具与命令

当前只允许使用已存在的脚手架命令；完整应用命令会随 Phase 1 的 manifests、迁移和测试一同加入，不能提前声称可用。

```bash
make help             # 显示当前支持的命令
make docs-check       # 检查文档规范引用
make scaffold-status  # 显示尚未创建的实现前置项
make db-up            # 仅启动本地 PostGIS 服务
make db-status         # 查看数据库服务状态
```

未来迁移、导入、测试和 E2E 命令的唯一前提是对应文件已经实现并通过验证。

## 外部数据采集门禁

- 没有来源授权、条款/robots、访问方式、速率、保留和删除记录，不得实现或运行自动采集。
- `xiaozhao-radar` 已审查（`tech/roles/data/etl/xiaozhao-radar.md`）：可映射其已发布的 `jobs.json`；不采纳其隐身/腾讯文档抓取栈。官方招聘页仅礼貌 GET + robots（`etl/official-career.md`）。BOSS 直聘、牛客、小红书、实习僧不属于 MVP，不得直接抓取。
- 插件注册不等于数据采集授权；不得绕过登录、验证码、限流或检测。

## 记住

- **不要猜测,要验证**:不确定时读代码/查数据库/运行测试
- **不要沉默,要沟通**:卡住时及时汇报,不要浪费时间
- **不要跳过,要完整**:测试和文档是交付物的一部分,不是可选项
- **不要孤立,要复用**:新代码前先搜索是否已有类似实现
- **🎨 前端代码必须先过布局示意图审查**:这是硬性规则,无任何例外
- **🧩 使用现代化组件库,避免重复造轮子**:liquid-glass-react + shadcn/ui
- **🍎 遵循 Apple 设计风格**:参考 Apple Maps 布局,液态玻璃质感
- **🔍 组件代码必须审查**:不无脑用,要像自己写的那样理解
- **📸 善用视觉能力**:前端设计时多用截图,视觉验证比文字准确
- **🔬 二次审查子 Agent**:不轻信结果,关键改动/代码/反馈必须亲自验证

祝编码愉快!🚀
