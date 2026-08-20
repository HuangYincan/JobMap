# 质量扫描报告(2026-08-19 · scope: docs)

> 状态追踪见 20260820-all 复核段(quality-scans/20260820-all/scan-report.md「上轮复核」+「修复状态回填」)。

## 摘要

- 扫描对象与规模:仓库全部文档资产 —— `tech/**` 61 个 .md、根文档(agent/CLAUDE/README/CHANGELOG/CONTRIBUTING/Makefile)、`.claude/**` 16 个 md、`server/README.md` + `server/docs/*`、3 个批次目录(`parallel-sessions/20260819-*`)、`crawler/tests` 与 `server/tests` 计数核对。合计约 85 个文档/契约文件。
- 发现总数:**27**,按严重度 **High 7 / Medium 10 / Low 10**。
- 按类别:文档 27(纯 docs scope)。主要矛盾集中在:README/CONTRIBUTING/tech-README/agent.md 仍停留在「脚手架/Phase 2 分支」旧态,与已并入 `dev` 的 Phase 2/3/4 + 全国规模现状不符;数字(测试数/迁移数/import plan 规模)与实现不一致。

## 发现清单(按严重度排序)

| # | 严重度 | 类别 | 位置(file:line) | 问题 | 建议 |
|---|--------|------|-----------------|------|------|
| 1 | High | docs | README.md:24 | 「No external source acquisition has occurred. xiaozhao-radar remains an import candidate pending license review」与同文件 :14-15 及 CHANGELOG 2026-08-17(radar + official-career 采集已实现且已审查)自相矛盾 | 改为「radar/official 已审查并实现,nowcoder/shixiseng/boss 仍为 stub」 |
| 2 | High | docs | README.md:19 | 「185 tests pass」过时;实际 288(server/tests 实测 288 个 test/describe;CLAUDE.md:43 亦记 288) | 更新为 288(2026-08-19) |
| 3 | High | docs | README.md:17 | 「migrations 001–010」过时;db/migrations 实为 001–013(011 national / 012 tier / 013 hz_pois) | 更新迁移范围至 001–013 |
| 4 | High | docs | CONTRIBUTING.md:3,8,30-42 | 仍称「documentation/scaffold stage」「does not yet contain a runnable application」「Only the documentation-scaffold commands are supported」;与已发货应用 + Makefile + CHANGELOG 矛盾 | 重写状态/命令清单,反映现有 app 与命令 |
| 5 | High | docs | tech/README.md:3 | 「当前仓库处于文档/脚手架阶段」过时;项目已是 Phase 2/3/4 complete 并含真实数据 | 更新阶段描述与索引 |
| 6 | High | docs | server/README.md:179,224-226,245-251,290-319 | 「mock data places array hardcoded」「No authentication」「Automated Tests (TODO for Phase 2)」「Phase 2 Integration Points」全部描述 Phase 2 前状态 | 重写为当前实现(真实 catalog/认证/288 tests) |
| 7 | High | docs | agent.md:332-344 | 「当前工具与命令」只列 5 个 scaffold make target,并称迁移/导入/测试命令属未来;但 Makefile 已定义 test-unit/db-migrate/test-integration/crawl-official/refresh-radar/geocode-sites,package.json 已定义 import:seed:apply/geocode:sites:apply/audit:pins/import:hz:pois:apply 且 CHANGELOG 记录均已运行 | 同步命令清单与现状 |
| 8 | Medium | docs | README.md:11 | 状态「Phase 2/3/4 complete on feature/phase-2-multi-mode」;工作已并入 `dev`(CLAUDE.md:25) | 状态改指向 `dev` |
| 9 | Medium | docs | README.md:68-82 | Repository Layout 仍写 db/server/scripts 「reserved for future」,三者均已含真实实现 | 更新 layout 描述 |
| 10 | Medium | docs | README.md:15 | 把「137 companies / 241 positions」表述为 import plan;全国规模后 plan 为 669 companies / 1440 sites / 877 positions(data-quality.md:19) | 补充全国规模口径或标注 Hangzhou-only |
| 11 | Medium | docs | tech/05-milestones.md:9,17,23,50-56 | P2/P3 仍 Planned、P4 In progress、Phase 1「in progress on feature/phase-1-platform-baseline」、迁移 001-010、importer 31 tests;与 README「Phase 2/3/4 complete」矛盾 | 更新阶段状态与迁移/测试数 |
| 12 | Medium | docs | tech/14-api-contract.md:3,13,16 | 「MapShell does not use these routes for the live Domain list」过时(杭内现走 /api/pois/domain-local);maxTier「0..20」与契约 0..21(tech/19/migration 012)不符;「Domain: seed names」过时(现查 hz_pois ILIKE) | 更新 Domain 读路径与 maxTier 值域 |
| 13 | Medium | docs | agent.md:134-137 | 指令使用 liquid-glass-react/shadcn/ui/framer-motion/react-icons;server/package.json dependencies 仅 next/pg/react/react-dom,实际为 CSS Modules | 删除未安装依赖指令,改写为现有设计系统 |
| 14 | Medium | docs | tech/README.md:7-15 | 文档清单仅列 01–07,缺 08/09/10/11/12/13/14/15/16/17/18/19/20/21/22 共 15 篇 | 补全索引 |
| 15 | Medium | docs | agent.md:100,239-240 | 引用 `tech/roles/product/PRD/*.md`、`tech/roles/operations/monitoring/incident-log.md`、`tech/roles/security/<red/blue>-team/*.md`,目录均不存在(仅各自 README) | 标注为 planned 或改为实际路径 |
| 16 | Medium | docs | agent.md:317 | `cat server/.env.local \| grep DATABASE_URL` 指示打印 DB 连接串,与「不打印 .env」硬性规则冲突 | 改为「确认 DATABASE_URL 已配置,不输出内容」 |
| 17 | Medium | docs | tech/roles/development/README.md:19 | 引用 `code-review/review-checklist.md`,该文件不存在(仅有 phase1-code-review.md) | 修正为实际文件或补建清单 |
| 18 | Low | docs | README.md:14 / tech/05-milestones.md:13 | 声称 importer「31 unit tests」;crawler/tests 现有 41 个 `def test_*`(acquisition 27 / imports 6 / map_access 5 / manifest 3),待 `make test-unit` 复核 | 复核后更新计数 |
| 19 | Low | docs | agent.md:106,110-113,205 | 引用 /tdd、/prototype、/domain-modeling、/diagnosing-bugs、/code-review skills,`.claude/` 下均不存在 | 删除或补建对应 skill |
| 20 | Low | docs | tech/09-secondary-sidebar.md:57,204,537 | 侧控栏「380px 固定宽度」;merge-report 20260819-b2-u1-u6:42 指出这些行相对 420px 基准已过期(WS-U1 汇报) | 按 420px 基准修正 |
| 21 | Low | docs | tech/10-search-filter.md:241-242 | 示例片段仍展示 `filters.industry` / `updateFilter('industry')`,而 :81/:98/:437 已声明 industry/district/providesShuttle 移除 | 更新或删除过期示例片段 |
| 22 | Low | docs | parallel-sessions/20260819-b2-u1-u6/ | 批次仅含 merge-report.md,缺 README manifest/prompts/reports(merge-report:3 说明汇报系 /merge-agent 参数内联) | 按批次约定补齐 manifest 或加说明 |
| 23 | Low | docs | parallel-sessions/20260819-regression-fix/ | 有 README + prompts/w1-w5,但无 reports/ 与 merge-report.md(扫描时疑似 in-flight) | 主 Agent 确认批次状态,完成后补记录 |
| 24 | Low | docs | tech/roles/development/parallel-sessions/.DS_Store | macOS 垃圾文件被提交进文档树 | 移除并加入 .gitignore |
| 25 | Low | docs | agent.md:32-44 | 脚本表缺已实现的 server/scripts(audit-pin-locations.mjs / geocode-sites-apply.mjs / plan-site-geocode.mjs) | 补全脚本清单 |
| 26 | Low | docs | agent.md:180-183 | 测试位置映射(tests/unit|integration|e2e)与现状不符;单测实际在 server/tests + crawler/tests,根 tests/ 仅 integration/db/test_migrations.sh | 修正测试目录说明 |
| 27 | Low | docs | tech/roles/development/implementation/phase-2.md:4-5 | 状态仍「in-progress」、分支 feature/phase-2-multi-mode;工作 2026-08-17 已并入 dev | 更新状态 |

## 发现详情

### #1 [High][docs] README 内部矛盾:采集未发生 vs 采集已实现
- 位置:README.md:24("No external source acquisition has occurred. `xiaozhao-radar` remains an import candidate pending license review")。
- 现状:同文件 :14-15 声称「reviewed polite acquisition (published xiaozhao-radar `jobs.json` mapping + official career-page GET with robots + blocked commercial hosts)」;CHANGELOG 2026-08-17 记录 `acquire.py`/`radar_jobs.py`/`official_refresh.py` 已实现并运行。
- 问题::24 与 :14-15 自相矛盾,读者无法判断采集是否被允许。
- 建议:改为「radar/official-career 已审查并实现;boss/nowcoder/shixiseng 仍为 stub,不采集」。
- 影响面:贡献者/Agent 的数据门禁判断。
- 需用户决策:否。

### #2 [High][docs] README 测试计数 185 vs 实际 288
- 位置:README.md:19。
- 现状:grep 统计 server/tests 共 288 处 `test(`/`describe(`;CLAUDE.md:43 记「288 测试(2026-08-19)」;merge-report 20260819-b2-u1-u6:10 记「288 tests / 286 pass / 2 skip」。
- 问题:README 写「185 tests pass」,落后 103 条,且与同仓文档冲突。
- 建议:更新为 288(或注明确切 pass/skip)。
- 影响面:外部读者/验收口径。
- 需用户决策:否。

### #3 [High][docs] README 迁移范围 001–010 vs 实际 013
- 位置:README.md:17。
- 现状:db/migrations 实际存在 001–013(011_national_scope / 012_tier_zoom_category / 013_hangzhou_pois)。
- 问题:README 称「ordered PostGIS migrations `001`–`010`…`001`–`010` in ledger」,遗漏 011/012/013。
- 建议:更新至 001–013,并同步 tech/05-milestones.md:13。
- 影响面:DB 迁移状态可信度。
- 需用户决策:否。

### #4 [High][docs] CONTRIBUTING 仍宣称脚手架阶段
- 位置:CONTRIBUTING.md:3,8,30-42。
- 现状:「does not yet contain a runnable application」「Only the documentation-scaffold commands are supported today」(make help/docs-check/scaffold-status/db-up/db-status)。
- 问题:与 README 描述的完整应用、Makefile 的 10+ target、CHANGELOG 的多次真实运行直接矛盾;新贡献者会被误导为仓库无应用。
- 建议:重写 Status 与「Current Supported Commands」,对齐现状。
- 影响面:贡献者入门体验。
- 需用户决策:否。

### #5 [High][docs] tech/README 阶段声明过时
- 位置:tech/README.md:3。
- 现状:「当前仓库处于文档/脚手架阶段;文档中的目标结构不代表代码已实现」,且索引只列 01–07。
- 问题:仓库已是 Phase 2/3/4 complete(真实 catalog/DB/前端),此声明与事实不符。
- 建议:更新为「Phase 2/3/4 已落地,技术文档为当前事实契约」。
- 影响面:所有从 tech/ 入口读文档的人。
- 需用户决策:否。

### #6 [High][docs] server/README 停留在 Phase 2 前
- 位置:server/README.md:179(mock data)、:224-226(No authentication)、:245-251(Test TODO for Phase 2)、:290-319(Phase 2 Integration Points)、:331(Phase 1 Complete)。
- 现状:前端现已使用真实 recruitment catalog + Postgres + 高德/hz_pois,认证/收藏/投递/提醒已实现,测试 288 条。
- 问题:README 仍描述「hardcoded places」「auth non-functional」「mock data awaits Phase 2」,严重误导。
- 建议:按当前实现重写 Features/Known Limitations/Testing/Integration 章节。
- 影响面:前端开发者、Agent 排障。
- 需用户决策:否。

### #7 [High][docs] agent.md 命令契约过时
- 位置:agent.md:332-344。
- 现状:只列 make help/docs-check/scaffold-status/db-up/db-status,称「未来迁移、导入、测试和 E2E 命令的唯一前提是对应文件已经实现并通过验证」。
- 问题:Makefile 已定义 test-unit/db-migrate/test-integration/crawl-official/refresh-radar/geocode-sites;package.json 已定义 import:seed:apply/geocode:sites:apply/audit:pins/import:hz:pois:apply;CHANGELOG 2026-08-17/18 均已记录真实运行。
- 建议:把「当前只允许脚手架命令」更新为完整可用命令清单。
- 影响面:Agent 执行权判断(可能拒绝运行已存在命令)。
- 需用户决策:否。

### #8 [Medium][docs] README 状态分支名过时
- 位置:README.md:11。
- 现状:「Phase 2/3/4 complete on `feature/phase-2-multi-mode`(2026-08-17)」;CLAUDE.md:25 已声明 dev 同步该分支。
- 建议:状态改指向 `dev`,保留历史分支说明。
- 需用户决策:否。

### #9 [Medium][docs] README Repository Layout 过时
- 位置:README.md:68-82。
- 现状:db/「reserved for future SQL migrations」、server/「reserved for future Next.js application」、scripts/「reserved for verified automation scripts」。
- 建议:更新为 db/ 含 001-013 migrations、server/ 为完整 Next.js app、scripts/ 已落地。
- 需用户决策:否。

### #10 [Medium][docs] README import plan 数字未随全国规模更新
- 位置:README.md:15。
- 现状:「137 merged in the import plan, 241 positions」;data-quality.md:19 / CHANGELOG 2026-08-17 记 import plan 已为 669 companies / 1440 sites / 877 positions。
- 建议:标注 Hangzhou-only 口径或升级为全国规模数字。
- 需用户决策:否。

### #11 [Medium][docs] tech/05-milestones 阶段状态过时
- 位置:tech/05-milestones.md:9,17,23,50-56,13。
- 现状:P2「Planned」、P3「Planned」、P4「In progress」、Phase 1「in progress on feature/phase-1-platform-baseline」、迁移 001-010、importer 31 tests。
- 建议:同步为 Phase 2/3/4 complete(dev)、迁移 001-013、按最新计数。
- 需用户决策:否。

### #12 [Medium][docs] API 契约 Domain 读路径与 maxTier 值域过时
- 位置:tech/14-api-contract.md:3,13,16。
- 现状::3「MapShell does not use these routes for the live Domain list」(杭内现已走 /api/pois/domain-local 本地批量);:13 maxTier「0..20」;:16「Domain: seed names」。
- 问题:CHANGELOG 2026-08-17/18 已把 Domain 读路径改为 hz_pois 优先;migration 012 / tech/19 定义 tier 0..21。
- 建议:更新 Domain 读路径描述与 maxTier 值域为 0..21。
- 需用户决策:否。

### #13 [Medium][docs] agent.md 指定使用未安装组件库
- 位置:agent.md:134-137。
- 现状:要求使用 liquid-glass-react/shadcn/ui/framer-motion/react-icons;server/package.json dependencies 仅 next/pg/react/react-dom。
- 问题:指令与仓库实际(CSS Modules + 自研 glass)不符,易诱导 Agent 引入不存在的依赖。
- 建议:改写为「沿用现有设计系统(CSS Modules + 液态玻璃卡片),新组件库需按 CONTRIBUTING 门禁审查后引入」。
- 需用户决策:否。

### #14 [Medium][docs] tech/README 索引缺失 15 篇文档
- 位置:tech/README.md:7-15。
- 现状:仅列 01–07;实际存在 08/09/10/11/12/13/14/15/16/17/18/19/20/21/22。
- 建议:补全索引表与快速导航。
- 需用户决策:否。

### #15 [Medium][docs] agent.md 引用不存在的角色路径
- 位置:agent.md:100(product/PRD/*.md)、:239(operations/monitoring/incident-log.md)、:240(security/<red/blue>-team/*.md)。
- 现状:这些目录/文件均不存在(各角色目录仅 README.md)。
- 建议:标注为 planned 路径,或改为实际记录位置。
- 需用户决策:否。

### #16 [Medium][docs] agent.md 排障命令打印连接串
- 位置:agent.md:317。
- 现状:`cat server/.env.local | grep DATABASE_URL`。
- 问题:与 CLAUDE.md 硬性规则「不打印 .env」冲突,连接串亦属敏感信息。
- 建议:改为「检查 DATABASE_URL 是否已配置(不输出值)」。
- 需用户决策:否。

### #17 [Medium][docs] 开发角色文档引用缺失的 review-checklist
- 位置:tech/roles/development/README.md:19。
- 现状:声称「code-review/review-checklist.md 包含 Code Review 检查清单」,该文件不存在(仅有 phase1-code-review.md)。
- 建议:修正路径或补建 checklist。
- 需用户决策:否。

## 建议修复批次(供 boss 审批)

- 批次 A(仓库状态对齐 — README/CONTRIBUTING):#1 #2 #3 #4 #8 #9 #10 #11
- 批次 B(契约文档更新 — agent/tech-README/Makefile):#5 #7 #13 #14 #15 #16 #17 #25 #26 #27
- 批次 C(技术细节修正 — API/设计文档):#6 #12 #20 #21
- 批次 D(批次目录与仓库卫生):#22 #23 #24 #18 #19
- 需用户决策(暂不派):#23(regression-fix 批次是否已完成,需主 Agent 确认而非改文档);#20(420px 侧控栏口径需与 WS-U1 汇报交叉确认)。其余均为纯文档修正,无需 UI/Env/数据口径决策。
