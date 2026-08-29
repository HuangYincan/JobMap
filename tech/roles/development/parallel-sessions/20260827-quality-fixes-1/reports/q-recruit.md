# q-recruit 汇报(2026-08-27)

## 实际改动

### 来源注册表与真实性(扫描 #4)
- `server/src/lib/recruitment-provenance.ts`(新增)→ 来源注册表 `SOURCE_META`:每源
  originUri/authorizationBasis/accessMethod/attribution/retention/deletion +
  **authenticity 策略**(`source` / `id-prefix` / `none`);`sourceMetadataFor` /
  `sourceAuthenticityPolicy` 供真实性判定与 sources 表落库共用。
- `server/src/lib/freshness.ts` → 新增 `isAuthenticPositionRecord({externalId, source})`:
  来源策略优先;`isAuthenticPositionId` 保留为无 source 历史行的身份兼容。embodied-jobs
  注册 `source` 策略 → `embj-*` 不再被前缀规则整源过滤。
- `server/src/lib/recruitment-import.ts` → apply 前真实性过滤改走
  `isAuthenticPositionRecord`,以「position.source ?? company.source ?? 'seed'」为来源。

### 记录级 provenance(扫描 #5)
- `server/src/lib/types.ts` / `server/src/lib/recruitment-source.ts` →
  `CompanySite.source` / `SourcePosition.source` 记录每条记录真实来源;公司级 `source`
  仅作缺省回退。
- `server/src/lib/recruitment-import.ts` → `cloneCompany` / `mergeCompany` 合并同 slug
  公司时逐条 `source: site.source ?? company.source` 下沉,跨源来源互不覆盖。
- 落库:site/position 均按各自记录的真实 source 写 `source_id`(site 循环内
  `sourceIdFor(site.source ?? company.source)`;position 用 `auditByPosition` 记录的
  `record.sourceCode`)。
- `server/src/lib/recruitment-source.ts` → `poiToSourceCompany` 克隆 site 对象(含
  location),消除测试/合并路径共享引用被篡改的隐患。

### 导入审计链(扫描 #9)
- `recruitment-import.ts` `applyRecruitmentImport` 建立可审计链:
  - `plugin_manifests`(`recruitment` 1.0.0);
  - `import_runs`(按 source 一批:`status` running→succeeded/failed、
    `input_version`=`recruitment-plan-v1`、`input_hash`=sha256、`parser_version`=
    `recruitment-import/2.0.0`、`record_count/success_count/failure_count`、`failures`
    jsonb);同一 input_hash 幂等 upsert;
  - `source_records`(每条 position:`source_id`、`import_run_id`、`external_id`、
    `record_version`=`<parser>:<contentHash[:24]>`、`retrieved_at`、`content_hash`=
    sha256({source, position})、`parser_version`、`original_payload`、`normalized_evidence`)。
  - `positions` 写入 `retrieved_at` / `expires_at`(来自 drop 的时间字段)。
- **禁止伪造抓取时间**:缺 `retrievedAt` 的 position 不写库、不写 source_record,进入该
  批次 failures(`missing-or-invalid-retrievedAt`),批次状态标记 `failed`;绝不写
  `now()` 冒充。事务回滚时先提交 run 行(短设置事务),再在独立事务把批次标记
  `failed` + `transaction-rolled-back`,失败可审计。
- 去重改为**按记录级来源** `DELETE ... WHERE source_id=$2 AND external_id=ANY($1)` 保
  MIN(id);**删除跨源迁移** `UPDATE positions SET source_id`(source_id 是审计事实,不是
  去重提示)。

### 投递 URL 语义校验与数据修复(扫描 #20)
- `recruitment-import.ts` `hasValidUrlScheme` 升级:拒绝重复 scheme、拒绝 `.` / `..`
  path segment、拒绝 **HTML 文件后继续拼接另一段路径**(`job.html/job.html`);
  可选 URL 字段缺省仍合法。
- 数据修复(HTML 拼接残片 → canonical 首段 HTML 路径):
  - 扫描列项 2 条施耐德:`qqj-施耐德电气.json`、`qqj-施耐德电气AI星火实习生计划.json`;
  - 新校验器额外暴露的同型坏链 9 家:radar 4(润石科技 / 芯朋微电子 / 毕马威 /
    mps芯源系统)、qqdoc-jobs 5(中科本原 / 兆芯 / 南京841研究所 / 圣邦微电子 /
    联合电子)。

### 文档
- `tech/roles/data/data-quality.md` → 新增「招聘导入真实性与审计链(2026-08-27)」小节。
- `tech/roles/data/etl/embodied-jobs.md` → 补充真实性登记:SOURCE_META authenticity=source。
- 未改全局状态文档(README/CLAUDE/agent/05-milestones 等)。

## 门禁结果
- 定向测试(recruitment-import / embodied-jobs / embodied-jobs-drops / qqdoc-jobs):全绿。
- `npm test`:1693 通过 / 0 失败 / 3 skip(共 1696 tests)。
- `npm run typecheck`:通过。
- `make docs-check`:通过。
- `git diff --check`:通过。

## 遇到的问题
- **续作对账**:上一轮 worker 的未提交改动内容正确,但有三类缺漏/错误,已补齐:
  1. `embodied-jobs.test.mjs` 仍从 `recruitment-import.ts` 导入已迁移的 `SOURCE_META`
     → 改从 `recruitment-provenance.ts` 导入;
  2. `finalizeRuns` 在「有失败记录但事务成功」时把批次记为 `succeeded`
     → 改为 `failureCount > 0` 时记为 `failed`(审计意图:失败可见);
  3. `poiToSourceCompany` 复用 `poi.sites[0]` 引用,dedupe 测试篡改站点 id 污染后续
     用例(positions.siteId 连环失败)→ 克隆 site 对象。
- **URL 语义校验暴露存量坏链**:新校验器拒绝 `job.html/job.html` 等拼接残片后,除扫描
  列出的 2 条施耐德外,额外 9 家公司 drops 校验失败(会整家 drop 出 plan)。按「URL
  质量与数据修复」边界,一并 canonical 修复,plan 恢复 0 issue / 0 dropped。
- **沙箱残留 scratch 文件**:`server/tests/__debug-recruit.test.mjs`、
  `tmp-count-retrieved.cjs`、`tmp-count-retrieved.py`(上一轮 worker 遗留)在只读沙箱中
  无法 `rm`/`git clean`,已用 Write 置空为注释。均未跟踪、未纳入任何 commit,待合并方
  或用户删除。

## 证据
- **plan/apply 真实性回归**:`recruitment-import.test.mjs` →
  `authenticity uses registered source provenance for embodied jobs`(embj + embodied-jobs
  = true;embj + official-career = false;portal + official-career = true);
  `embodied-jobs plan records survive authenticity filtering as a whole source`(plan 全部
  positions 通过 `isAuthenticPositionRecord`,0 dropped)。
- **跨源 DeepSeek provenance 断言**:`dedupeSourceCompanies preserves site and position
  source per record`(official-career DeepSeek 站/岗 source=official-career,radar 站/岗
  source=xiaozhao-radar);`applyRecruitmentImport writes each site/position source
  provenance independently`(site params[11] 与 position params[17] 逐条 source 独立)。
- **import audit 证据**:`applyRecruitmentImport runs a transactional upsert`(断言
  INSERT INTO plugin_manifests / import_runs / source_records 与 UPDATE import_runs 存在,
  且 `UPDATE positions SET source_id` 不存在);`records missing retrieval time as a failed
  audit record`(positions=0、无 source_records、run status='failed'、无伪造时间)。
- **坏链修复与测试**:`hasValidUrlScheme rejects ... (scan #4 regression)` 新增
  `/./` 与 HTML 后拼接拒绝用例;`施耐德 drops use canonical apply URL`(两条施耐德数据
  applyUrl 已 canonical、无 `/./`、过校验);`全部生成 drops 零校验 issue` 全源重扫 0 issue。
- 提交:
  - `80e53c8 feat(recruitment): 来源注册表真实性判定 + 记录级 provenance + 导入审计链`
  - `0b2bc27 fix(data): 规范化投递 URL 语义坏链(施耐德 + 扫描新发现 9 家)`
  - `e530242 docs(data): 记录招聘真实性与导入审计链(扫描 #4 #5 #9 #20)`
- 分支/worktree 保持:`fix/quality-recruitment-integrity` / `/Users/acccan/dm-wt-q-recruit`;
  未 merge、未 push。

门禁: PASSED
结论: OK
