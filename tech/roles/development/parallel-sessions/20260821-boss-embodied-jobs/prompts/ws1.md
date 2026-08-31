# Workstream ws1 — feature/embodied-jobs-data(数据:解析脚本 + drops 生成)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree 内开发,不 merge、不 push、不碰主树。** 汇报写入批次目录 reports/ws1.md(末两行 token,见文末)。

## 开工前

- 先读 worktree 内 `CLAUDE.md`、`agent.md`。
- **幂等对账**:`git log --oneline -5` + `git status --short`。若分支 tip 已有本 WS 的 commit → 不重做,验证现有改动、补跑门禁、写报告;有未提交半成品 → 判断可用或 `git checkout -- <文件>` 丢弃后重做。
- 确认 `cd /Users/acccan/dm-wt-embd-a && ls server/node_modules` 是 symlink(npm test 可直接跑)。

## 背景

新数据源 `embodied-jobs` = github.com/Octoday-Hub/Embodied-AI `topics/02-jobs.md`(具身智能岗位聚合列表)。**纯解析任务,零网络抓取**(信息全部在快照内)。

- 快照:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-embodied-jobs/source/embodied-02-jobs.md`(400,992 bytes, sha256 `d862c540ed3d7ee7c0ed53dd2dbfb2b3798de6fa50b07fd45891df2e804d79ff`, 2026-08-21 快照;只读引用,勿改)
- 结构:HTML `<table>`(非 markdown 表),公司 `<td rowspan=N>` 一格 + N 个岗位行;5 列 = **公司/岗位/类型/地点/投递**;每岗行最后一个 `<td>` 内有一个 `<a href>` 投递链接(button 图 `../files/deliver-button.svg` 只是装饰,链接以 href 为准)
- 三节:`## 国内机会`(line 13)/ `## Overseas Opportunities`(line 2308)/ `## 人才计划`(line 2943);`## HR专属通道`(line 3674)无岗位,**跳过**
- 另有「链接直达」字母导航表(公司字母锚点),**跳过**(无表头 5 列)
- 页面自称 538 机会:国内 354 / 海外 85 / 专项 99

先例(drops 生成与 schema 的模板):
- `server/scripts/extract-qqdoc-jobs.mjs`(dev 已有)—— 同类「文档 → drops」提取脚本,风格对齐
- `server/data/recruitment/radar/*.json`(646 家)—— 带 positions 的 drops schema 参照
- 共享读取器 `server/src/lib/recruitment-adapters/file-drop.ts`:drops JSON 即 SourceCompany shape(`slug`+`name` 字符串、`sites`+`positions` 数组必须存在);校验在 `server/src/lib/recruitment-import.ts`(纯函数,无 DB,找到它用于测试断言)

## 任务 1:解析脚本 `server/scripts/extract-embodied-jobs.mjs`(新增)

Node 单文件、零依赖,读快照 md → 输出 drops。要求:

- 解析 rowspan:公司格 + 其下 N 个岗位行(跨节同名公司如「阿里巴巴」国内+人才计划各出现 → **合并为一个 drop**,岗位合并)
- 每岗行提取:岗位名 / 类型 / 地点 / href
- 类型 → JobFamily 映射:**社招→`social` 校招→`campus` 实习→`intern`**;类型格为空/无法映射 → 从岗位名关键词推断(实习/Intern/暑期/训练营→intern;校招/Campus/应届→campus),再兜底 `social` —— 兜底与推断计数写入脚本注释和汇报
- href:取第一个 http(s) 链接;非 http(s) 或空 → 该行无链接,岗位 applyUrl 用**该公司首个有效链接**兜底(计数);公司零链接 → 该 drop 不写 positions(`positions: []`),记入汇报
- 幂等:已存在的 `embj-<name>.json`(同名 slug)跳过;已匹配 drop 里 externalId 带 `embj-` 前缀的 positions 跳过
- 输出统计到 stdout:总公司数 / 三节各岗位数 / 新建 drops / 匹配追加 / 类型兜底计数 / 无链接计数

## 任务 2:drops 生成(脚本产物,提交到 worktree)

**新建 drop**(公司名在现有 drops 中**无同名匹配**):`server/data/recruitment/embodied-jobs/embj-<公司名>.json`:

```json
{
  "slug": "embj-<公司名>",
  "source": "embodied-jobs",
  "name": "<公司名>",
  "careerUrl": "<公司首个有效投递链接>",
  "sites": [
    {
      "id": "embj-<公司名>-site",
      "name": "<公司名>",
      "city": "<岗位城市并集,空格分隔>",
      "province": "",
      "location": {}
    }
  ],
  "positions": [
    {
      "externalId": "embj-<公司名>-<n>",
      "title": "<岗位>",
      "siteId": "embj-<公司名>-site",
      "family": "social|campus|intern",
      "taxonomy": { "family": "social|campus|intern" },
      "status": "open",
      "applySource": "official",
      "applyUrl": "<投递链接>",
      "retrievedAt": "2026-08-21"
    }
  ]
}
```

- 海外/专项节照收(city 原样,如 "Toronto");地理位置待 Env geocode(不属本 WS)
- **同名匹配追加**:公司名与现有 drops 的 `name` 字段精确相等(在 `server/data/recruitment/{radar,official-career,qqdoc-official,qqdoc-jobs}/**` 内扫;boss/nowcoder/shixiseng 是空目录跳过)→ **不建 embj-* 重复 drop**,改为:positions(externalId 仍 `embj-<公司名>-<n>`,siteId 用该 drop **第一个 site 的 id**)追加进该现有 drop;若该 drop 有 `sources` 数组 → 追加 `'embodied-jobs'`,只有 `source` 单值 → 不动(如实记入汇报/ETL 文档)。包含式别名匹配(如「XX科技」vs「XX科技有限公司」)自行判断,每个判断记入汇报。
- 匹配不到的 → 新建 embj-* drop。

## 任务 3:测试(新增 `server/tests/`)

- `extract-embodied-jobs.test.mjs`(或等价命名,对齐现有 vitest):小段 fixture md(从快照裁一个公司 rowspan 组)→ 解析断言(公司/岗位/类型映射/链接/多城市)
- **drops 校验测试**:用 `server/src/lib/recruitment-import.ts` 的校验纯函数(无 DB)对**全部生成 drops**(含追加后的现有 drop)**断言零 bad issues**;test 失败=返回 BLOCKED 修复后再跑
- 风格对齐现有 vitest(看 `server/tests/` 里 qqdoc/radar 相关测试)

## 文件边界

- **只允许改**:`server/scripts/extract-embodied-jobs.mjs`(新增)、`server/data/recruitment/embodied-jobs/**`(新增)、`server/data/recruitment/{radar,official-career,qqdoc-official,qqdoc-jobs}/**`(**仅追加 positions / sources,不删改其他字段**)、`server/tests/`(新增测试)
- **不碰**:`server/src/**`、`tech/`、`db/`、`server/data/recruitment/{boss,nowcoder,shixiseng}/**`、`crawler/`
- `git add` 只加具体文件路径,绝不用 `git add -A` / `git add .`(node_modules symlink 勿收)

## 门禁(全部在 worktree 内,cwd=/Users/acccan/dm-wt-embd-a)

```bash
cd server && npm test && npm run typecheck
cd .. && make docs-check && git diff --check
```

- npm test 基线 568(566 pass / 2 skip);你新增的测试是**新增通过数**,基线不能掉
- 提交用 Conventional Commits,小步提交(如 `feat(recruitment): extract-embodied-jobs 解析脚本`、`data(recruitment): embodied-jobs drops N 家`)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-embodied-jobs/reports/ws1.md`。内容:实际改动列表、解析统计(公司/岗位/三节分布/新建 vs 匹配追加 vs 别名判断)、类型兜底与无链接计数、幂等记录、测试列表、遇到的问题。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
