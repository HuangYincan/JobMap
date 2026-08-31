# Workstream ws2 — feature/embodied-jobs-source(适配器 + 注册 + 文档)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree 内开发,不 merge、不 push、不碰主树。** 汇报写入批次目录 reports/ws2.md(末两行 token,见文末)。

## 开工前

- 先读 worktree 内 `CLAUDE.md`、`agent.md` 及 `tech/roles/data/data-sources.md`。
- **幂等对账**:`git log --oneline -5` + `git status --short`;有本 WS commit → 不重做,验证后补门禁写报告。
- 确认 node_modules symlink 存在(npm test 可跑)。

## 背景

新数据源 `embodied-jobs`(github.com/Octoday-Hub/Embodied-AI `topics/02-jobs.md`,具身智能岗位聚合列表,2026-08-21 快照 538 机会)。drops 由并行 WS-1(分支 `feature/embodied-jobs-data`,**尚未合并**)生成于 `server/data/recruitment/embodied-jobs/*.json`——**本 worktree 里还没有这些文件,测试必须用自包含 fixture**,不得读 WS-1 的 worktree。

数据源授权事实(boss 已核,2026-08-21):GitHub API 返回 `license: null` —— **仓库无 LICENSE 文件**,社区维护列表;采集方式为读公开 GitHub 文件(快照),零网络抓取。

## 任务 1:适配器 `server/src/lib/recruitment-adapters/embodied-jobs.ts`(新增)

- 参照 `server/src/lib/recruitment-adapters/radar.ts` 的极简模式:用共享的 `fileDropAdapter('embodied-jobs', defaultDropDir('embodied-jobs'))`(见 file-drop.ts),`EMBODIED_JOBS_DIR` 环境变量可覆盖(对齐 RADAR_DIR 写法)
- drops schema 即 SourceCompany shape(WS-1 按此生成):slug `embj-*`、name、source `'embodied-jobs'`、careerUrl、sites(单 site,id `embj-<name>-site`)、positions(externalId `embj-*`、family social|campus|intern、status open、applyUrl 每岗链接、retrievedAt)
- **注册**:`server/src/lib/recruitment-source.ts` 的 `RecruitmentSourceKind` union 加 `'embodied-jobs'`;`server/src/lib/recruitment-import.ts` 的 `SOURCE_META` 加条目:
  - originUri: `https://raw.githubusercontent.com/Octoday-Hub/Embodied-AI/main/topics/02-jobs.md`
  - authorizationBasis: `published-github-file`(无 LICENSE 文件,社区维护列表——如实)
  - accessMethod: `public-file`
  - attribution: `Octoday-Hub/Embodied-AI contributors (community-maintained list; no LICENSE file); Domain Map field mapping`
  - retention: `until-replaced`;deletion: `delete-with-source`
- 适配器注册入口(索引/注册处,qqdoc-official/radar 同款已注册可参考,如 api.ts)同步加

## 任务 2:测试(新增 `server/tests/`,fixture 自包含)

- `embodied-jobs.test.mjs`(对齐现有 vitest):自建 2-3 个 fixture drops 文件(临时目录写盘,形状对齐上述 schema,含多城市 site 与 family 三值)→ `list()` 返回 SourceCompany 断言(source 码/positions 透传/空目录→[])
- 注册断言:SOURCE_META 含 `embodied-jobs`、kind union 含 `'embodied-jobs'`
- 风格对齐现有测试(看 qqdoc/radar 测试)

## 任务 3:文档

- 新增 `tech/roles/data/etl/embodied-jobs.md`—— 按 `tech/roles/data/etl/qqdoc-official.md` 模板(日期/来源 URL/采集方式/提取内容/质量评估/产出/红线核对),写入:快照日期 2026-08-21、URL、sha256 `d862c540ed3d7ee7c0ed53dd2dbfb2b3798de6fa50b07fd45891df2e804d79ff`、无 LICENSE 事实、538 机会三节分布、类型→family 映射、同名公司追加说明(positions 以 embj- 前缀标识来源)、红线核对(零抓取/不涉 BOSS 牛客小红书实习僧)
- `tech/roles/data/data-sources.md` 注册表加一行(Source | Review status | Acquisition allowed? | Required evidence),日期 2026-08-21,evidence 指向新 ETL 文档
- `server/README.md` 测试计数:若你新增测试改变了总数 → 按 `make docs-check` / agent.md 契约更新计数(写真实实测值)

## 文件边界

- **只允许改**:`server/src/lib/recruitment-adapters/embodied-jobs.ts`(新增)、`server/src/lib/recruitment-source.ts`、`server/src/lib/recruitment-import.ts`(仅 SOURCE_META 条目与必要注册)、适配器注册入口、`server/tests/`(新增测试)、`tech/roles/data/etl/embodied-jobs.md`(新增)、`tech/roles/data/data-sources.md`(加行)、`server/README.md`(计数,若变)
- **不碰**:`server/data/recruitment/**`(WS-1 拥有)、`tech/` 其余、`db/`、`crawler/`
- `git add` 只加具体文件路径,绝不用 `git add -A` / `git add .`

## 门禁(全部在 worktree 内,cwd=/Users/acccan/dm-wt-embd-b)

```bash
cd server && npm test && npm run typecheck
cd .. && make docs-check && git diff --check
```

- npm test 基线 568(566 pass / 2 skip),新增测试是新增通过数
- 提交用 Conventional Commits,小步提交(如 `feat(recruitment): embodied-jobs fileDrop adapter + SOURCE_META`、`docs(data): embodied-jobs ETL 来源记录`)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-embodied-jobs/reports/ws2.md`。内容:实际改动列表、注册位置(文件:行)、测试列表与新增计数、文档更新点、遇到的问题。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
