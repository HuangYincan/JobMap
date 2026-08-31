# q-recruit — 招聘真实性、记录级来源与导入审计

## 路径

- worktree: `/Users/acccan/dm-wt-q-recruit`
- branch: `fix/quality-recruitment-integrity`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-recruit.md`
- scan findings: #4 #5 #9 #20

## 任务

1. 复验并修复 embodied-jobs 的 `embj-*` position 是否被真实性规则整源过滤。不要继续扩大脆弱的散落前缀判断；优先使用现有来源注册/provenance 作为真实性依据，并加入整源回归测试。
2. 修复跨源同 slug 合并导致 site/position provenance 被首家公司 source 覆盖：来源下沉到记录级，合并和落库按每条 site/position 的真实 source 写 `source_id`。
3. 利用现有 `import_runs` / `source_records` 和 position 时间字段，建立招聘导入可审计链：批次状态、parser/hash/记录来源、retrieved/expires 等应有确定写入与失败状态；禁止伪造不存在的抓取时间。
4. 加强投递 URL 的语义校验，拒绝 `/./`、HTML 文件后继续拼接另一文件等明显坏链；修复扫描列出的两条施耐德数据，并加数据 fixture 回归。
5. 更新招聘导入/数据质量专属文档；不要改全局状态文档。

## 边界

- 不处理 #11 BOSS 外链口径与 #21 Tactus 实体判断。
- 不执行 `import:seed:apply`、migration apply、geocode 或任何采集。
- 优先不新增 migration；若现有 schema 无法实现 #9，写 `结论: BLOCKED` 并给出最小 schema 需求，不抢 q-db 的 migration 编号。
- 不改 UI。

## 门禁与提交

- 运行相关定向测试，再运行 `cd server && npm test`
- `cd server && npm run typecheck`
- `make docs-check`
- `git diff --check`
- 小步 Conventional Commits；不要 merge，不要 push。

## 回报

报告必须给出 plan/apply authenticity 回归、跨源 DeepSeek provenance 断言、import audit 证据、坏链修复与测试结果。末两行：

`门禁: PASSED` 或 `门禁: FAILED`

## Boss 裁决附录（续作重派）

上一轮 worker 因 API 提供商瞬时错误中断，未提交、未写报告。**工作树保留大量未提交改动**：`server/src/lib/{freshness,recruitment-import,recruitment-source,types}.ts`、新增 `server/src/lib/recruitment-provenance.ts`、`server/tests/recruitment-import.test.mjs`，以及两条施耐德 qqdoc JSON 修复。请先审阅 `git status` / `git diff`：保留范围内且内容正确的改动并补完，缺漏则补齐/修正。随后小步 Conventional Commit、跑门禁、写报告。不要重做已完成的核对，不要创建空提交。

`结论: OK` 或 `结论: BLOCKED: <一句话>`
