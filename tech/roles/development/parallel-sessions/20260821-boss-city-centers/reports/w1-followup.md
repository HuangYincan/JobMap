# w1-followup 汇报(2026-08-21)

## 实际改动

- `server/src/lib/recruitment-adapters/embodied-jobs.ts` → 新建。embodied-jobs fileDrop 适配器(读 `data/recruitment/embodied-jobs/`,EMBODIED_JOBS_DIR 可覆盖),对每个 drop 归一化:
  - `industries`:缺失/非数组/空数组 → `industriesOf(name)`(复用 `qqdoc-official.ts` 导出的共享启发式,未知 → `'other'`,永不空,不触发 validateSourceCompany「need at least one」);
  - `scale`:缺省 `'enterprise'`(qqdoc 先例,per-company 规模无法从 drop 推导);
  - 其余字段(slug/name/source/careerUrl/sites/positions)透传;positions 过滤无 externalId 的行。
- `server/src/lib/recruitment-source.ts` → `RecruitmentSourceKind` 联合追加 `'embodied-jobs'`。
- `server/src/lib/recruitment-import.ts` → `SOURCE_META` 改导出并注册 `'embodied-jobs'`(published-github-file,originUri 指向 Octoday-Hub/Embodied-AI topics/02-jobs.md);`planSeedImport` 接入 `embodiedJobsAdapter().list()`,spread 首位(真实 drops 优先于 seed)。
- `server/tests/embodied-jobs.test.mjs` → 新建 7 条测试:fixture 镜像真实 embj-* drop 形状(显式断言无 industries/scale 字段);透传、归一化(industries == industriesOf(name)、scale 缺省)、回归(dedupeSourceCompanies → cloneCompany 不抛 + planRecruitmentImport/validateSourceCompany 零 issues)、空/缺失目录返回 []、kind 注册、SOURCE_META 注册、union 包含。

## 门禁结果

- npm test: 670 通过 / 0 失败 / 2 skip(668 pass;基线 670 含新增 7 条;此前 6 个 planSeedImport 红测试已不在本 worktree 存在——ws2 红 merge 983b161 未进本分支历史,回归由新测试覆盖)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- 提示中 `server/src/lib/recruitment-adapters/embodied-jobs.ts` 与 `server/tests/embodied-jobs.test.mjs` 在本 worktree 均不存在:983b161(ws2 红 merge,含裸 fileDropAdapter 版适配器)只在本机 local dev、未 push,本分支基座(origin/dev @ 1af75a6)只有 ws1 drops 数据。→ 按 ws2-followup 裁决方案 A 全新建适配器 + 归一化 + 接入 planSeedImport,而非修一个已存在的文件。此修复与 local dev 上已绿过的 feature/embodied-jobs-source 参考实现(b83c1d5)逐行一致,后续合并若有重叠由 merger 处理。
- 未改 `server/README.md` 测试计数(提示文件边界未列,且本分支无该计数基线;计数以门禁实际输出为准)。
- 未新增 `tech/roles/data/etl/` 文档:本提示任务范围仅适配器+测试,ETL 来源记录由 20260821-boss-embodied-jobs 批次 ws2 负责(其分支已含),不在本 WS 边界。

## 证据

- 真实数据二次验证:`embodiedJobsAdapter().list()` 47/47 drops 加载,industries 缺失/空 = 0;`dedupeSourceCompanies`(cloneCompany 路径)不抛;`validateSourceCompany` 零 issues;`planRecruitmentImport` dropped 0 / issues 0。
- `node --test tests/embodied-jobs.test.mjs` → 7 pass / 0 fail。
- 提交:`b85c63e` feat(recruitment) 适配器 + 归一化 + 接入;`a554b40` test(recruitment) 真实形状 fixture + 回归测试。

门禁: PASSED
结论: OK
