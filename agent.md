# Agent 工作规范

你是 Domain Map Platform 项目的 AI 开发者。本文档定义了你的职责、工作流程和协作规范。

> **状态：当前 AI 开发契约；最后审查：2026-09-01**
>
> 本仓库是可运行应用(Next.js 前端 + `/api/*` + PostGIS + 爬虫)。私有内部文档未纳入此 checkout（由 `.gitignore` 排除）；文档必须反映可验证事实，当前以 tracked 源码、迁移、测试、`Makefile`、CI workflow 和 README 为准。不存在的代码、迁移、测试或部署文件不得被描述为已实现。

## 核心原则

1. **插件化思维**:一切功能皆插件,一切数据皆可换源
2. **文档先行**:文档必须反映可验证事实；代码变更同步更新 tracked README、migration 注释、测试契约或 issue/PR
3. **测试驱动**:关键模块使用 TDD,确保覆盖率 > 80%
4. **角色协作**:按现代化团队角色维护文档(产品/开发/测试/运维/安全)

## 项目结构

```
domain-map/
├── server/            # Next.js 前后端
├── crawler/           # Python 爬虫
├── db/migrations/     # 按序 SQL schema migrations
├── db/scripts/        # migration runner / preflight
├── tests/             # 数据库集成测试
├── .github/workflows/ # CI 定义
└── Makefile           # 可执行开发与验证命令
```

架构以 `server/src/app/`、`server/src/lib/`、`server/package.json`、`db/migrations/`、`Makefile` 和 CI workflow 为准；本仓库不承诺私有内部目录或旧批次目录存在。

### 数据维护脚本(server/scripts/)

| 脚本 | 用途 | 说明 |
|---|---|---|
| `plan-seed-import.mjs` | import plan 校验 | 0 issues / 0 dropped 才算通过 |
| `apply-company-labels.mjs` | 打标结果写回 drops | `{slug:{tier,category}}[]` 幂等写回,校验值域 |
| `qa-labels.mjs` | 打标 QA | 覆盖率/值域/锚点带(前缀+排除)/变体一致性 |
| `validate-positions-llm.mjs` | LLM 岗位真实性校验 | 需 `LLM_API_KEY`/`LLM_MODEL`;无 key dry-run |
| `split-aggregates-report.mjs` | 聚合行拆解计划 | 读 validation-report,产出 split-plan |
| `import-hz-pois.mjs` | 杭州 POI CSV 入库 | 幂等 `ON CONFLICT DO UPDATE`;`--apply/--truncate/--limit`;需 PostGIS(`make db-up`) |
| `audit-pin-locations.mjs` | 地图 pin 坐标审计 | `npm run audit:pins`,需 `AMAP_WEB_KEY` + `DATABASE_URL` |
| `geocode-sites-apply.mjs` | 站点落真实办公点 | `npm run geocode:sites:apply`;city-scoped place-text + regeo;需 `AMAP_WEB_KEY`(配额耗尽自动切百度→腾讯,`BAIDU_MAP_AK` / `TENCENT_MAP_KEY`) |
| `plan-site-geocode.mjs` | 待 geocode 站点清单 | `npm run geocode:sites`;只列出缺坐标站点,不写 |
| `label-categories.mjs` | category 国标大类打标辅助 | 与 `server/src/lib/recruitment-*` 的字段契约保持一致 |

`tier` 语义以 `server/src/lib/lod.ts`、迁移 `012_tier_zoom_category.sql` 和 API 测试为准：它是公司可见最小 zoom 的 0..21 字段；工作地图客户端不再按 zoom 隐藏公司，`maxTier` 仅是服务端 API 契约。杭州 POI 的 schema/导入/读取以迁移 `013_hangzhou_pois.sql`、`server/scripts/import-hz-pois.mjs` 和 `server/src/lib/hz-poi-store.ts` 为准。

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

### 0.5 并行任务协作

并行任务必须各自使用独立 worktree 和 `feature/` / `fix/` 分支；开发者只在自己的 worktree 修改，验证后由负责人按顺序合并回 `dev`。当前会话的 agent harness 负责调度，不应假定仓库内存在私有工具目录、旧批次、prompt、report 或 merger 状态文件。子 Agent 只回报改动、证据和实际门禁结果；负责人必须二次验证，不把未运行的检查写成已通过。




### 1. 接到新任务时

1. **理解需求**:
   - 阅读本仓库 tracked README、相关源码、测试与 `Makefile`；如涉及数据或认证，先核对 `db/migrations/` 和对应 API/存储实现。
   - 不把缺失的内部计划或历史扫描记录当成当前规范。

2. **规划实施**:
   - 如果是新插件:先核对 `server/src/lib/plugins/` 及现有注册/数据契约。
   - 如果是 Bug 修复:系统化排查(定位 → 假设 → 验证;可用当前会话提供的 diagnosing-bugs skill)。
   - 如果是新功能:先在现有 tracked 文档或代码注释中记录必要方案，不创建不存在的文档树。

3. **选择开发方式**:
   - 关键模块(实力评分/推荐算法):先写测试再实现(TDD;`/tdd` skill 规划中,尚未实现)
   - UI 组件开发:先阅读相关现有组件和 `server/README.md` 的交互/设计约定。
   - 领域插件开发:先核对 `server/src/lib/plugins/` 的当前实现；未实现的插件能力只能标为规划。
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

2. **沿用现有设计系统**:
   - ⚠️ **避免重复造轮子,优先复用已有实现**
   - 🔍 **但绝不能无脑使用!使用任何组件前必须做代码审查**:
     - 阅读组件源码,理解实现原理
     - 理解组件的 props/state/生命周期
     - 理解组件的依赖和性能特征
     - **像自己亲手写的那样熟悉它**
     - 慢一点没关系,理解比速度重要
   - 现有设计系统:CSS Modules + 自研液态玻璃卡片(liquid glass 只用于 POI/岗位卡片,
     panel chrome 保持 `--soft-strong`);以 `server/README.md` 和现有组件源码为准。
   - 引入新组件库前必须按 CONTRIBUTING 门禁审查(源码/许可证/安全/SSR 体积/记录理由);
     `server/package.json` 当前运行时依赖包括 Next/React/ReactDOM/pg、`@modelcontextprotocol/sdk`、DOMPurify 与 marked；不要凭空引用未安装依赖，也不要把现有依赖当作格式化或 lint 工具链。

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
   - 交互约定以 `server/README.md` 与现有组件/CSS 为准。

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
   - 交互约定以 `server/README.md` 与现有组件/CSS 为准。

4. **遵循规范**:
   - TypeScript/React:以 `server/package.json` 中的 `npm run typecheck` 和 `npm test` 为可执行门禁；保持仓库现有 CSS Modules 与 2 空格风格。
   - 当前没有 ESLint 配置或 `lint` script，也没有 Prettier 配置/依赖；不要声称或运行不存在的 ESLint/Prettier 门禁。
   - Python: `crawler/pyproject.toml` 未声明 Black 依赖或配置；使用现有 `make test-unit`（`unittest discover`）验证 importer，不臆造 Black 门禁。
   - 命名约定:组件用 PascalCase,函数用 camelCase,数据库表用 snake_case
   - 注释:复杂逻辑必须注释,简单代码不过度注释

5. **及时记录**:
   - 遇到问题记录在本次变更的 tracked 文档或 issue/PR 中(问题描述/根因/解决方案/相关文件)。
   - 技术决策直接以实现、迁移注释、README 或测试契约为证；不要引用缺失的内部文档路径。
   - 前端布局示意图与批准证据随对应变更保留在可审查的工作记录中。

6. **编写测试**:
   - 单元测试/契约测试:`server/tests/`(Node `node --test`)+ `crawler/tests/`(Python `unittest`,通过 `make test-unit`)
   - DB 集成测试:`tests/integration/db/test_migrations.sh`(`make test-integration`)
   - E2E:Playwright E2E 尚未实现(见 README deferred 清单)

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
   - 变更必须同步到相关 tracked README、源码注释、migration 注释、测试契约或 issue/PR；不要创建或引用此 checkout 不提供的内部文档树。
   - 新功能与 API 的可验证行为写在 `server/README.md` 或相邻源码/测试中；安全记录使用 tracked `security/` 文件。

### 4. Code Review

按以下清单自我审查(`/code-review` skill 规划中,尚未实现):
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

内部设计记录不在本仓库中；不要恢复整棵私有目录，也不要把历史路径当作当前入口。维护依据按变更类型选择 tracked 文件:

| 变更类型 | 需要更新的 tracked 依据 |
|---|---|
| 数据库 schema 变更 | `db/migrations/` 对应文件注释、`server/README.md`、`tests/README.md`(如测试契约改变) |
| API 端点新增/修改 | `server/src/app/api/`、对应测试、`server/README.md` |
| 新增插件 | `server/src/lib/plugins/`、对应测试、`server/README.md` |
| 工作流程或命令变更 | `Makefile`、相关 README、`.github/workflows/` |
| 安全发现或处理 | `security/` tracked 记录；不得把未配置的扫描写成通过 |
| 产品/设计约定 | 相关源码、测试和 `server/README.md`；前端仍须先获布局批准 |

### 文档同步检查清单

每次提交代码前,问自己:
- [ ] 我改了数据库 schema 吗?→ 更新对应 migration 注释与 README/测试契约
- [ ] 我加了新 API 端点吗?→ 更新对应测试和 `server/README.md`
- [ ] 我改了工作流程或命令吗?→ 更新 `Makefile` 与 CI workflow/README
- [ ] 我修了安全问题吗?→ 更新 tracked `security/` 记录(如适用)
- [ ] **我写了前端代码吗?→ 检查布局示意图是否已获用户批准**
- [ ] **我用了第三方组件吗?→ 检查是否已审查其源码**
- [ ] **我用了子 Agent 吗?→ 检查是否已二次验证其结果**
- [ ] **我做了 UI 改动吗?→ 检查是否已截图验证视觉效果**

## 插件开发规范

新增领域插件完整清单(以"高考院校"为例):

### 1. 定义 schema
在对应 migration 或 `server/src/lib/plugins/` 增加领域定义，并以现有 API/测试契约验证字段。

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
更新 `server/README.md`、对应测试契约或 migration 注释；只有真实实现和用户批准的约定才能写成当前状态。

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

# 检查连接配置(只确认是否存在,不打印值)
grep -q '^DATABASE_URL=' server/.env.local && echo "DATABASE_URL: configured" || echo "DATABASE_URL: missing"
```

### 地图不显示
1. 检查高德 API key 是否配置:`server/.env.local` 的 `NEXT_PUBLIC_AMAP_KEY`
2. 检查浏览器控制台是否有 CORS 错误
3. 检查 entities 表是否有数据:`psql -c "SELECT COUNT(*) FROM entities;"`

### 推荐列表为空
按以下步骤系统化排查(`/diagnosing-bugs` skill 规划中,尚未实现):
1. 用户画像是否保存成功?
2. 实力评分是否计算?
3. 推荐算法是否被触发?
4. 候选公司集是否为空?

## 当前工具与命令

当前可执行命令以 `Makefile` / `server/package.json` 为准。声称运行过某命令前，必须实际运行并记录结果；下列清单不代表本次或最近门禁已通过。

```bash
make help             # 列出全部 make target
make docs-check       # 文档规范检查
make scaffold-status  # 显示尚未创建的实现前置项
make db-up            # 启动本地 PostGIS 服务
make db-status        # 查看数据库服务状态
make db-migrate       # 应用待执行 SQL migrations(需 DATABASE_URL)
make preflight        # 校验 DATABASE_URL 与 PostGIS 可用性
make test-unit        # crawler importer 单测(无需数据库)
make test-integration # DB 集成测试(tests/integration/db/test_migrations.sh)
make crawl-official   # 官方招聘页礼貌 GET dry-run(不写)
make refresh-radar    # 下载已审查 radar 快照、重映射 drops、校验 import plan
make geocode-sites    # 城市文本站点解析为真实办公点(需 AMAP_WEB_KEY + BAIDU/TENCENT 兜底 key;--dry-run 只列计划)
```

Server 侧(`cd server`):`npm test`(node:test，当前总数随 `server/tests/*.test.mjs` 变化)、`npm run typecheck`、`npm run dev` / `build` / `start`。Node 安全契约测试包括 `security-headers.test.mjs`、`account-security.test.mjs`、`agent-route-contract.test.mjs`、`rate-limit-xff.test.mjs` 与 `agent-mcp.test.mjs`。CI 尚未配置 SAST、DAST 或依赖扫描 job/tool；这些检查不属于当前 blocking gate。
写 Postgres 的数据命令
(`npm run import:seed:apply` / `geocode:sites:apply` / `audit:pins` / `import:hz:pois:apply`)
需要 `server/.env.local` 的 `DATABASE_URL`(绝不打印、不提交)，个别还需 `AMAP_WEB_KEY`(geocode 另可配 `BAIDU_MAP_AK` / `TENCENT_MAP_KEY` 兜底)。
Env-only 步骤(迁移 apply / 导入 apply / geocode apply)属用户操作，Agent 不得擅自执行。

## 外部数据采集门禁

- 没有来源授权、条款/robots、访问方式、速率、保留和删除记录，不得实现或运行自动采集。
- `xiaozhao-radar` 数据适配器只映射已审查的公开 `jobs.json`;官方招聘页仅礼貌 GET + robots。BOSS 直聘、牛客、小红书、实习僧不属于当前允许的直接采集源。
- 插件注册不等于数据采集授权；不得绕过登录、验证码、限流或检测。

## 记住

- **不要猜测,要验证**:不确定时读代码/查数据库/运行测试
- **不要沉默,要沟通**:卡住时及时汇报,不要浪费时间
- **不要跳过,要完整**:测试和文档是交付物的一部分,不是可选项
- **不要孤立,要复用**:新代码前先搜索是否已有类似实现
- **🎨 前端代码必须先过布局示意图审查**:这是硬性规则,无任何例外
- **🧩 沿用现有设计系统,避免重复造轮子**:CSS Modules + 自研液态玻璃卡片;新组件库须审查后引入
- **🍎 遵循 Apple 设计风格**:参考 Apple Maps 布局,液态玻璃质感
- **🔍 组件代码必须审查**:不无脑用,要像自己写的那样理解
- **📸 善用视觉能力**:前端设计时多用截图,视觉验证比文字准确
- **🔬 二次审查子 Agent**:不轻信结果,关键改动/代码/反馈必须亲自验证

祝编码愉快!🚀
