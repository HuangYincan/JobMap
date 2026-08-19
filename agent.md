# Agent 工作规范

你是 Domain Map Platform 项目的 AI 开发者。本文档定义了你的职责、工作流程和协作规范。

> **状态：当前 AI 开发契约；最后审查：2026-08-19**
>
> 本仓库是可运行应用(Next.js 前端 + `/api/*` + PostGIS + 爬虫,Phase 2/3/4 已并入 `dev`)。文档必须反映可验证事实；不存在的代码、迁移、测试或部署文件不得被描述为已实现。

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
| `audit-pin-locations.mjs` | 地图 pin 坐标审计 | `npm run audit:pins`,需 `AMAP_WEB_KEY` + `DATABASE_URL` |
| `geocode-sites-apply.mjs` | 站点落真实办公点 | `npm run geocode:sites:apply`;city-scoped place-text + regeo;需 `AMAP_WEB_KEY`(配额耗尽自动切百度) |
| `plan-site-geocode.mjs` | 待 geocode 站点清单 | `npm run geocode:sites`;只列出缺坐标站点,不写 |
| `label-categories.mjs` | category 国标大类打标辅助 | 见 `tech/19-company-labeling.md` |

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

### 0.5 并行角色 Skills(2026-08-18)

开启一批并行开发时,新会话通过触发 skill 得知自己的角色:

- **`/main-agent`**(派发者):接收一组目标,拆解为并行 workstream,生成每个开发会话的
  prompt 文件(含已批布局图/文件边界/门禁),写入批次目录并回报路径;只计划不开发。
- **`/workstream-agent`**(执行者):读主 Agent 的 prompt 文件,在独立 worktree 开发,
  写汇报文件,不 merge 回 dev。
- **`/merge-agent`**(合并者):本批全部完成后,读批次 manifest + 各开发汇报,按
  `parallel-development` 的 merge orchestration 逐个 merge 回 dev、处理冲突、写合并报告。
- **`/boss-agent`**(超级 Boss,总控/编排者,2026-08-19):由用户显式调用,自动跑完
  规划 → 预建 worktree → 并行派发 headless worker(`.claude/agents/boss-worker.md`)→
  收汇报/自主裁决 → 派 headless merger(`.claude/agents/boss-merger.md`)合并+push dev →
  按门禁结果自动决定 fix 批次或推进下一里程碑。全程无人值守、不打断用户;push dev
  自动、main 只提 PR 不等待;新 UI 按 Apple/liquid glass 设计系统自主开发,改现有 UI
  设计/Env-only 步骤跳过并记入 `deferred-notes.md`,结束时一次性总汇报。细则见
  `.claude/skills/boss-agent/SKILL.md`。
  boss 可派**只读质量扫描**(`boss-scanner`,干净上下文、严格只读、不修改任何文件)按 scope
  检查 文档过时/矛盾/缺失、代码冗余/死代码/可优化/健壮性/安全性、数据源正确性,写
  `scan-report.md`;boss 审批后把技术项拆成 fix 批次派 worker,需用户决策项(改现有 UI
  设计/Env-only/数据口径)记 `deferred-notes.md`。扫描报告存
  `tech/roles/development/quality-scans/<YYYYMMDD>-<scope>/`。
  **故障恢复**:所有 Agent 共用同一 API,一次欠费/故障会同时打掉所有会话;磁盘状态
  (`boss-state.md` + worktree/分支 + logs)不丢。恢复入口:
  `bash .claude/skills/boss-agent/bin/resume-boss.sh <批次目录> [--headless]`(探测 API
  就绪后自动按 --resume 对账协议幂等续跑),或手动 `/boss-agent --resume <批次目录>`。

批次目录约定:`tech/roles/development/parallel-sessions/<YYYYMMDD>-<slug>/`,内含
`README.md`(manifest:分支表/合并顺序)、`prompts/<ws>.md`(主 Agent 写,开发读)、
`reports/<ws>.md`(开发写,收尾读)、`merge-report.md`(收尾写)、`logs/`(boss 派发的
headless worker/merger 输出)、`boss-state.md`(boss 状态机)、`deferred-notes.md`
(boss 记录的需用户决策项)。skill 细则见
`.claude/skills/{main,workstream,merge,boss}-agent/SKILL.md`。

### 1. 接到新任务时

1. **理解需求**:
   - 阅读相关 PRD:`tech/roles/product/PRD/*.md`(规划路径,目录尚未建立)
   - 查看架构文档:`tech/01-architecture.md`
   - 确认数据模型:`tech/02-data-model.md`

2. **规划实施**:
   - 如果是新插件:参考 `tech/03-plugin-system.md`
   - 如果是 Bug 修复:系统化排查(定位 → 假设 → 验证;`/diagnosing-bugs` skill 规划中,尚未实现)
   - 如果是新功能:先写技术方案到 `tech/roles/development/implementation/`(现有 phase-1.md / phase-2.md;新 phase 文件按需建立)

3. **选择开发方式**:
   - 关键模块(实力评分/推荐算法):先写测试再实现(TDD;`/tdd` skill 规划中,尚未实现)
   - UI 组件开发:参考 `.claude/skills/frontend-component-dev/` 与 `.claude/skills/liquid-glass-components/`
   - 领域插件开发:参考 `.claude/skills/plugin-dev/`(`/domain-modeling` skill 规划中,尚未实现)
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
     panel chrome 保持 `--soft-strong`);组件开发技能见
     `.claude/skills/liquid-glass-components/` 与 `.claude/skills/frontend-component-dev/`
   - 引入新组件库前必须按 CONTRIBUTING 门禁审查(源码/许可证/安全/SSR 体积/记录理由);
     `server/package.json` 当前依赖仅 next/pg/react/react-dom,不要凭空引用未安装依赖
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
   - 遇到问题记录到 `tech/16-bug-fixes.md`(问题描述/根因/解决方案/相关文件)
   - 技术决策记录到 `tech/06-decisions.md`(ADR 格式)
   - **布局示意图**记录到对应 Phase 的实施文档中

6. **编写测试**:
   - 单元测试/契约测试:`server/tests/`(Next.js,`node --test`)+ `crawler/tests/`(pytest,`make test-unit`)
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
   - 同步技术文档:`tech/` 相关章节
   - 如果是新功能,写教程:`tech/zh-cn/tutorial/<feature>.md`
   - 更新角色文档:`tech/roles/development/implementation/`(phase-1.md / phase-2.md;新 phase 按需建立)

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
| 产品需求确定 | `tech/roles/product/PRD/<feature>.md`(规划路径,目录尚未建立) |
| 开发过程记录 | `tech/roles/development/implementation/`(phase-1.md / phase-2.md;bug 记录另见 `tech/16-bug-fixes.md`) |
| 测试发现 Bug | `tech/roles/testing/test-reports/bug-reports.md` |
| 部署/运维操作 | `tech/roles/operations/monitoring/incident-log.md`(规划路径,目录尚未建立) |
| 安全漏洞发现 | `tech/roles/security/<red/blue>-team/*.md`(规划路径,目录尚未建立) |

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

以下命令均已实现并验证；清单与 `Makefile` / `server/package.json` 对齐。声称运行过某命令前，必须先确认对应文件存在且已通过验证。

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
make geocode-sites    # 城市文本站点解析为真实办公点(需 AMAP_WEB_KEY;--dry-run 只列计划)
```

Server 侧(`cd server`):`npm test`(488 测试,2026-08-20)、`npm run typecheck`、
`npm run dev` / `build` / `start`。写 Postgres 的数据命令
(`npm run import:seed:apply` / `geocode:sites:apply` / `audit:pins` / `import:hz:pois:apply`)
需要 `server/.env.local` 的 `DATABASE_URL`(绝不打印、不提交)，个别还需 `AMAP_WEB_KEY`。
Env-only 步骤(迁移 apply / 导入 apply / geocode apply)属用户操作，Agent 不得擅自执行。

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
- **🧩 沿用现有设计系统,避免重复造轮子**:CSS Modules + 自研液态玻璃卡片;新组件库须审查后引入
- **🍎 遵循 Apple 设计风格**:参考 Apple Maps 布局,液态玻璃质感
- **🔍 组件代码必须审查**:不无脑用,要像自己写的那样理解
- **📸 善用视觉能力**:前端设计时多用截图,视觉验证比文字准确
- **🔬 二次审查子 Agent**:不轻信结果,关键改动/代码/反馈必须亲自验证

祝编码愉快!🚀
