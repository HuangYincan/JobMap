# Workstream c — feature/scan-docs-factsync(文档事实同步)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-scan-c`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix/reports/ws-c.md`(末两行 token,见文末)。

## 背景

全库扫描(2026-08-23)报告:`tech/roles/development/quality-scans/20260823-all/scan-report.md`(通读 #5 #6 #7 #8 详情段)。扫描发现文档事实漂移互斥。**已由 boss 实跑获取权威数字**(见下),不要臆造。

## 权威数字(boss 已于 2026-08-23 实测,直接用)

- **npm test 权威计数**:由你在本 worktree 跑 `cd /Users/acccan/dm-wt-scan-c/server && npm test` 取得(输出 "Tests: N passed / M skipped" 或等价;此为唯一真实值,用于写回 6 处;若与扫描所示 1464 顶层 test() 不一致,以 npm test 输出为准)。
- **seed import 实跑数**(boss 已跑 `npm run import:seed` dry-run,2026-08-23):`companies: 1040 / sites: 2351 / positions: 12932 / dropped: 0 / issues: []`。
- **drops 文件数**(扫描已计数,你可用 find 复核):radar 646、official-career 78、qqdoc-official 142、qqdoc-jobs 163、embodied-jobs 46。
- **migrations**:001–018(ls `db/migrations/` 复核)。

## 任务(按扫描发现号)

### #5 [Medium] server/README.md 大段事实过时
按实际重写状态段:Next.js 版本(以 `server/package.json` 为准,现 16.x)、`npm run lint` 不存在(删除该描述或改真实命令)、地图引擎=三引擎+切换(tech/23)、OTP 已真发(删除 `000000` demo stub 描述)、写路径失败=抛 DbUnavailableError 503(设计如此,非加固项)、测试计数用权威值、Last Updated 2026-08-23。过时大段可重写为「当前状态」+指向根 README/tech 文档;不要保留与代码矛盾的断言。

### #6 [Medium] 测试计数 6 处互斥且滞后
用权威 npm test 数字,统一写回:`CLAUDE.md:43`、`agent.md:360`、`CONTRIBUTING.md:49`、`README.md:19`、`CHANGELOG.md:13`、`tech/05-milestones.md:11`、`server/README.md:249`。格式对齐现有写法(如 `568 tests(566 pass / 2 skip,2026-08-21)` 风格,数字与日期用实测)。

### #7 [Medium] CHANGELOG 缺 2026-08-22/23 条目
按现有格式补 2026-08-22 条目(§ 或「- 」风格参照现有),覆盖已合入工作:OAuth 登录(tech/27)、阿里云短信 OTP(tech/26)、Agent Memory(migration 018)、头像上传(migration 017)、收藏图层开关、i18n 选项标签、loading-hang 修复、地图引擎三引擎切换/POI 徽章系列(可引用批次目录 `tech/roles/development/parallel-sessions/20260822-*` 与 migrations 017/018 作证据)。08-23 若已有合入(engine-polish-2 轮1-10)也补一行。**只写有证据的事实**;不确定的批次宁可不列。

### #8 [Medium] README/data-quality 数据口径停在 08-17 pilot
`README.md:14-17,:75` 与 `tech/roles/data/data-quality.md:19` 更新为:数据源清单补齐(以 `tech/roles/data/etl/` 与批次目录为证:qqdoc-official/qqdoc-jobs/embodied-jobs 等;feishu ATS 若有确证则列,无证据不列)、drops 计数(上述实测)、migrations 001–018、DB 派生计数(companies 1040 / sites 2351 / positions 12932 / dropped 0,注明为 2026-08-23 plan-seed-import dry-run)。删除「0 dropped」「001–016」等过期断言;无法从 evidence 得到的信息写「待下次 apply 后回填」。

## 文件边界

- **可以改**:`server/README.md`、`README.md`、`CLAUDE.md`、`agent.md`、`CONTRIBUTING.md`、`CHANGELOG.md`、`tech/05-milestones.md`、`tech/roles/data/data-quality.md`。
- **不碰**:`server/src/**`、`server/data/**`、`crawler/**`、`db/migrations/**`、`tech/23*.md` 等 map-engine 文档(4195c9b5 会话活跃区)、`tech/15/27`(ws-a 拥有);不新增/删除文档文件。

## 门禁

1. `cd /Users/acccan/dm-wt-scan-c && make docs-check`、`git diff --check`
2. `cd /Users/acccan/dm-wt-scan-c/server && npm test`(只跑一次取权威计数,不要求改代码;必须全绿,若红则 BLOCKED 汇报)
3. 小步 commit(Conventional Commits,按发现号分组)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix/reports/ws-c.md`:每个发现号改动内容、实测测试数字、写入位置清单;**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
