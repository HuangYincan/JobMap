# q-db — position/site/company 复合完整性约束

## 路径

- worktree: `/Users/acccan/dm-wt-q-db`
- branch: `fix/quality-position-site-fk`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-db.md`
- scan finding: #16

## 任务

1. 复验 `positions(company_id,site_id)` 的独立 FK 是否允许引用另一公司的 site。
2. 新增下一个合法编号的幂等 migration：迁移前先检查/报告现存跨公司错配；为 `company_sites(id,company_id)` 建可引用唯一键；为 positions 建复合 FK，保留既有级联/删除语义。
3. migration 必须对已有正确数据安全；若发现现存错误，不自动篡改业务数据，明确阻止约束安装并给出只读诊断 SQL。
4. 更新 schema/migration 文档与相应静态/集成测试（按项目现有 no-DB 测试模式）。

## 边界

- 只生成 migration 与验证；绝不执行 `make db-*`、psql、migration apply 或数据修复。
- 不改 recruitment import 业务代码，不抢其他 worker 文件。
- 不改 UI。

## 门禁与提交

- 运行相关 server/db 静态测试
- `cd server && npm test`
- `cd server && npm run typecheck`
- `make docs-check`
- `git diff --check`
- Conventional Commits；不要 merge，不要 push。

## 回报

报告写 migration 编号、preflight 行为、约束语义、测试结果，并明确 apply 仍为 Env-only。末两行：

`门禁: PASSED` 或 `门禁: FAILED`

`结论: OK` 或 `结论: BLOCKED: <一句话>`
