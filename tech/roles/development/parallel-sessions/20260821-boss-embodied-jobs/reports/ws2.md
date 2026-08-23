# ws2 汇报(2026-08-21)

## 实际改动
- `server/src/lib/recruitment-adapters/embodied-jobs.ts`(新增)→ 极简 fileDrop 适配器:`fileDropAdapter('embodied-jobs', dir)`,`EMBODIED_JOBS_DIR` 环境变量覆盖(对齐 RADAR_DIR),导出 `fileEmbodiedJobsAdapter` 单例
- `server/src/lib/recruitment-source.ts` → `RecruitmentSourceKind` union 加 `'embodied-jobs'`(行 12)
- `server/src/lib/recruitment-import.ts`:
  - SOURCE_META 加 `embodied-jobs` 条目(行 109-116):originUri `https://raw.githubusercontent.com/Octoday-Hub/Embodied-AI/main/topics/02-jobs.md`、authorizationBasis `published-github-file`、accessMethod `public-file`、attribution 注明 `community-maintained list; no LICENSE file`、retention `until-replaced`、deletion `delete-with-source`
  - `SOURCE_META` 加 `export`(供注册断言测试)
  - `planSeedImport` 接入:import(行 9)、Promise.all(行 266/275)、spread 首位(行 283,embj-* slug 命名空间不与其他 drops 撞 slug,现有 ordering 正则测试不破坏)
- `server/tests/embodied-jobs.test.mjs`(新增,6 个测试)→ 自包含 fixture(mkdtemp 写盘 2 个 SourceCompany 形状 drops + 1 个坏 JSON 文件):source 码/positions 透传、多城市 site、family 三值 social|campus|intern、空目录/缺失目录 → []、坏文件跳过、import 校验零 issues、注册断言(SOURCE_META 字段 + union 含 'embodied-jobs' + 单例 kind)
- `tech/roles/data/etl/embodied-jobs.md`(新增)→ 按 qqdoc-official.md 模板:快照日期 2026-08-21、URL + raw URL、sha256 `d862c540ed3d7ee7c0ed53dd2dbfb2b3798de6fa50b07fd45891df2e804d79ff`、无 LICENSE 事实(GitHub API `license: null`)、538 机会三节分布(国内 354 / 海外 85 / 专项 99,HR专属通道无岗位跳过)、类型→family 映射(社招→social/校招→campus/实习→intern)、同名公司追加说明(positions 以 embj- 前缀标识来源)、红线核对(零抓取/不涉 BOSS 牛客小红书实习僧)
- `tech/roles/data/data-sources.md` → 注册表加 embodied-jobs 行(Reviewed 2026-08-21 / Published GitHub file only(no LICENSE)/ evidence 指向新 ETL 文档)
- `server/README.md` → 测试计数 568→599(597 pass / 0 fail / 2 skip,实测值)

## 注册位置
- kind union: `server/src/lib/recruitment-source.ts:12`
- SOURCE_META: `server/src/lib/recruitment-import.ts:109-116`(条目)+ 行 59(export)
- planSeedImport: `server/src/lib/recruitment-import.ts:266,275,283`
- 适配器文件: `server/src/lib/recruitment-adapters/embodied-jobs.ts`

## 门禁结果
- npm test: **599 通过 / 0 失败 / 2 skip**(基线 README 写 568,实测 worktree 基线实为 593,疑上次批次未同步计数;新增 6 个测试全绿)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题
1. `.mjs` 测试文件不能带 TS 类型标注(Node 只对 `.ts` 剥类型)——`fixtureDir(): Promise<string>` 首跑 SyntaxError → 去掉标注后修复,对齐现有测试纯 JS 风格
2. 直接 `node --test` 需审批,门禁改用 `npm test` 跑通(最终计数以 `npm test` 实测为准);网络 curl(核实快照 sha256)同样需审批 → 改用批次目录 `source/embodied-02-jobs.md`(boss 已核快照)核对三节分布/类型词汇,文档事实与批次 README 一致
3. worktree 内无 WS-1 drops(未合并),测试全部自包含 fixture,未读 WS-1 worktree

## 证据
- `npm test` 摘要(最终):`ℹ tests 599 / pass 597 / fail 0 / skipped 2`;embodied-jobs 6 测试全 ✔(含 fixture 透传、SOURCE_META 注册、union 断言)
- `npm run typecheck`:tsc --noEmit 无输出(通过)
- `make docs-check`:Documentation policy check passed.
- `git diff --check`:无输出(含 `git diff HEAD~2..HEAD --check` 复查已提交改动)
- 提交: `a113230` feat(recruitment) adapter+注册 / `462aa1b` test(recruitment) fixture 测试 / `708268a` docs(data) ETL 记录+注册表+计数

门禁: PASSED
结论: OK

---

# ws2 FOLLOWUP 修复(2026-08-21,boss ADJUDICATE 续作重派)

> 根因(merger 证据链确认):真实 embj-* drops 有意精简、无 `industries`/`scale`,
> 裸 `fileDropAdapter` 零归一化 → `planSeedImport` → `dedupeSourceCompanies` →
> `cloneCompany` 对 `[...undefined]` spread 抛 `TypeError: company.industries is
> not iterable`(`recruitment-import.ts:222`),dev 上 6 个 planSeedImport /
> applyRecruitmentImport 相关测试红;worktree 内 fixture 恰带 industries 掩盖缺口。

## 实际改动(2 commits,分支 tip 708268a → 4f870e2)

- `server/src/lib/recruitment-adapters/embodied-jobs.ts` → 弃裸 `fileDropAdapter`,改为
  qqdoc 同款归一化适配器(`embodiedJobsToSourceCompany` / `parseEmbodiedJobsPayload` /
  `listEmbodiedJobsFiles` / `embodiedJobsAdapter` 签名不变,`EMBODIED_JOBS_DIR` 覆盖不变):
  - `industries`:`industriesOf(name)`(自 `qqdoc-official.ts:56` 复用,已读确认兜底
    逻辑——未知公司名 → `['other']`,永不空,`validateSourceCompany`「need at least one」
    不触发;drop 若未来自带 industries 则原样透传)
  - `scale`:`drop.scale ?? 'enterprise'`(审计结论见下)
  - 其余字段(slug/name/source/careerUrl/sites/positions)原样透传,sites/positions
    结构校验同 file-drop(qqdoc 风格)
- `server/tests/embodied-jobs.test.mjs` → fixture 改为**真实 drops 形状**(去掉
  industries/scale,补 taxonomy/applySource/retrievedAt,location {} 空对象,province 空串;
  模块顶层断言 fixture 永不带 industries/scale 字段);7 个测试(原 6 → 7):
  1. 读取/透传(多城市 site、family 三值)—— 不变
  2. **新增**归一化断言:输出 industries == `industriesOf(name)` 非空、scale == 'enterprise'
  3. **回归测试(关键)**:真实形状 fixture → `embodiedJobsAdapter().list()` →
     `dedupeSourceCompanies`(cloneCompany 路径,从 `recruitment-import.ts` 导入)→
     `planRecruitmentImport` → `validateSourceCompany`——不抛异常、零 bad issues、
     dropped 0(替代原「fixture 通过 import 校验」测试)
  4. 空目录/缺失目录 → [] —— 不变
  5. 单例 kind / 6. SOURCE_META / 7. kind union —— 不变
- `server/README.md` → 测试计数 599→600(598 pass / 0 fail / 2 skip,实测)

## 必填字段审计结论(对照 `recruitment-source.ts` SourceCompany 接口)

- `industries`:**缺失(真实 47/47 drops 均无)**;`cloneCompany` 直接 spread → 必修。
  适配器层可推导(industriesOf,name 启发式 + 'other' 兜底)。✅ 已修
- `scale`:type 必填(接口无 `?`;`RecruitmentPOI.company.scale` 同,poi-card/poi-detail
  渲染规模徽章),但 **import 门禁不查**(validateSourceCompany 跳过、DB `?? null`、
  UI 徽章空值不崩)。真实 drops 无此字段、**无法逐公司推导**(47 家从创业公司到大厂混布,
  无任何规模数据)→ 按 qqdoc 先例(两适配器均 `scale: 'enterprise'`)用固定缺省
  'enterprise',代码注释注明口径。⚠️ 供 boss 知悉:对创业型公司(星动纪元等)该标签
  偏大,后续可在 drop 层补真实 scale(不属本 WS 边界)
- `tier` / `category` / `rating` / `logoUrl` / `summary` / `deadline`:可选,缺省合法 ✅
- sites / positions / careerUrl / siteId 引用:drops 自带且通过校验 ✅
- `dedupeSourceCompanies`/`cloneCompany` 其余触碰点(logoUrl/logoEmoji 非空不覆盖、
  sites 按 id 去重、positions 按 externalId 去重、majors/skills 可选 spread 已防御)→
  真实形状下无其他崩溃路径 ✅

## 门禁结果

- npm test: **600 通过 / 0 失败 / 2 skip**(worktree 基线 599→600;dev 基线 659→660,
  此前红的 6 个 planSeedImport / applyRecruitmentImport 测试根因已消除)
- typecheck: 通过;docs-check: 通过;`git diff HEAD~2..HEAD --check`: 无输出

## 遇到的问题

1. 无法在本 worktree 内跑「真实 47 drops 全量」验证:ws1 drops 未并入本分支,git 提取
   (archive/show 循环/checkout)与环境变量覆盖(EMBODIED_JOBS_DIR)均被本会话沙箱拒绝 →
   改为读取 dev 上 2 个真实 drop(优必选科技 / Figure AI,中文+英文、含 intern/social)
   逐字段核对形状,fixture 完全镜像;崩溃机制纯形状驱动(缺 industries → spread
   TypeError),回归测试以真实形状走完整崩溃路径,红→绿逻辑与 merger 证据链(merge-report
   行 21-29)一一对应
2. `scale` 缺省口径见上,建议 boss 决定是否记 deferred note(逐公司 scale 后续在 drop 层补)

## 证据

- 提交:`7996481` fix(recruitment) adapter 归一化 / `4f870e2` test(recruitment) 真实形状 fixture + 回归
- `npm test` 摘要:`ℹ tests 600 / pass 598 / fail 0 / skipped 2`;embodied-jobs 7 测试全 ✔
  (含 `✔ regression: real-shape drops survive dedupe/cloneCompany path with zero validation issues`、
  `✔ adapter normalizes real-shape drops: industries filled via industriesOf, scale defaulted`)
- 真实 drop 形状核对:优必选科技(单 site 单岗 social)、Figure AI(单 site 8 岗含 intern)——均无
  industries/scale,positions 带 taxonomy/applySource/retrievedAt,site 带 location {} / province 空串
- `npm run typecheck` 无输出;`make docs-check` Documentation policy check passed;
  `git diff HEAD~2..HEAD --check` 无输出;工作树仅 tmp/(gitignored)残留验证暂存文件

门禁: PASSED
结论: OK
