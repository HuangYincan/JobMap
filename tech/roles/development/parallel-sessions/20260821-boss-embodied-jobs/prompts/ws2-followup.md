# Workstream ws2 裁决附录 — FOLLOWUP(feature/embodied-jobs-source 集成缺口修复)

> boss ADJUDICATE 2026-08-21。你的分支已合并过一版(983b161,本地未 push、门禁红)。本附录是修复指令,**续作重派**:分支 tip 仍是你的 708268a 成果,不要重做,在现有基础上修 bug。

## 根因(merger 证据链,已确认)

1. `SourceCompany.industries: string[]` 是**必填字段**(`recruitment-source.ts:42`),但 `validateSourceCompany` **不检查** industries(只查 sites/positions/careerUrl/logoUrl)→ ws1「全语料零 bad issues」无法发现缺失。
2. ws1 的 **47/47 个 `embj-*.json` drop 均无 `industries` 字段**(grep 0 命中)——这是**有意为之**(drops 保持精简,和 qqdoc-* drops 一致)。
3. 先例:qqdoc-official / qqdoc-jobs 适配器用 `industriesOf(name)` 补齐(`qqdoc-official.ts:56/97`、`qqdoc-jobs.ts:83`,已导出可复用)。
4. 你的 `embodiedJobsAdapter` 用了**裸 `fileDropAdapter`(零归一化)**,`cloneCompany` 对 `[...undefined]` spread 抛 `TypeError: company.industries is not iterable`(`recruitment-import.ts:222`),`dedupeSourceCompanies → planSeedImport` 路径炸,6 个既有测试红。
5. 你的 fixture 恰好带了 `industries: ['robotics']`(`embodied-jobs.test.mjs:23/65`)→ worktree 内全绿,真实数据 gap 未被发现。

## 修复任务(只改适配器与测试,不碰 drops)

1. **`server/src/lib/recruitment-adapters/embodied-jobs.ts`**:不再用裸 `fileDropAdapter` 直通;写归一化转换——读 drops 后为每个 SourceCompany **补齐 `industries`**(复用 `industriesOf(name)`;若它有默认兜底逻辑更好,读它确认行为),并**审计其余必填字段**(对照 `recruitment-source.ts` 的 `SourceCompany` 接口:`scale` 等是否必填、`dedupeSourceCompanies`/`cloneCompany`/`planSeedImport` 还会触碰什么)。门禁 = 修复后 6 个红测试 + 全套件绿。
2. **fixture 改为真实形状**:fixture drops **去掉 `industries` 字段**(镜像真实 embj-* drops:slug/name/source/careerUrl/sites/positions),断言适配器输出**补全后**的 SourceCompany 含 industries。
3. **回归测试**(关键):新增/改写一条测试——fixture 走 `embodiedJobsAdapter().list()` → `dedupeSourceCompanies`(或 `cloneCompany` 所在路径,从 `recruitment-import.ts` 导入)不抛异常,且 `validateSourceCompany` 零 bad issues。这条测试必须能在**真实 drops 形状**下红→绿,防止此类跨 WS 缺口再现。
4. 若审计发现 industries 之外还有必填字段缺失、且无法在适配器层推导 → **不要改 drops**,汇报 `结论: BLOCKED: <详情>` 回给 boss 裁决。

## 文件边界(同原 ws2 + 修改)

- 只允许改:`server/src/lib/recruitment-adapters/embodied-jobs.ts`、`server/src/lib/recruitment-source.ts`(仅必要)、`server/src/lib/recruitment-import.ts`(仅必要)、适配器注册入口、`server/tests/`(embodied-jobs 相关测试)
- **不碰**:`server/data/recruitment/embodied-jobs/**`(drops 保持精简,适配器补齐)、`tech/`、`db/`、`crawler/`、`server/README.md`(除非测试计数再变,如实更新)

## 门禁(worktree 内,cwd=/Users/acccan/dm-wt-embd-b)

```bash
cd server && npm test && npm run typecheck
cd .. && make docs-check && git diff --check
```

- 重点是之前红的 6 个测试(planSeedImport / applyRecruitmentImport 相关)全绿;基线含 ws1 合并后的测试(659 tests 基线,657 pass/2 skip)
- 小步 Conventional Commits(如 `fix(recruitment): embodied-jobs adapter industriesOf 归一化 + 真实形状回归测试`)

## 汇报

追加写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-embodied-jobs/reports/ws2.md`(保留原内容,追加「FOLLOWUP 修复」段)。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
