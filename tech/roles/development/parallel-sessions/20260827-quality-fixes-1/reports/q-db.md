# q-db 汇报(2026-08-27)

## 实际改动
- `db/migrations/020_position_site_company_fk.sql` → 新增下一个合法编号的幂等迁移。迁移先以只读查询检查 `positions.company_id` 与其 `site_id` 对应站点的 `company_id` 是否 `IS DISTINCT FROM`；输出错配计数。发现错配时发出 warning 并以 exception 阻止后续 DDL，错误提示包含只读诊断 `SELECT`，不更新、不删除业务数据。
- `db/migrations/020_position_site_company_fk.sql` → 为 `company_sites(id, company_id)` 新建 `company_sites_id_company_id_uidx` 可引用唯一索引；新增 `positions_site_company_fkey`，以 `(site_id, company_id)` 引用 `(id, company_id)`，`ON DELETE RESTRICT`。保留迁移 006 中 `positions.company_id → companies.id ON DELETE CASCADE` 与 `positions.site_id → company_sites.id ON DELETE RESTRICT`，未删除或弱化既有约束。
- `server/tests/position-site-company-fk-migration.test.mjs` → no-DB 静态契约测试：确认迁移编号连续、复验 006 的独立 FK、检查 preflight 阻止/诊断/无业务 DML、检查唯一键/FK 顺序与删除语义。
- `tests/integration/db/test_migrations.sh` → 集成门禁增加迁移 020 的表/索引/约束目录检查，确认旧 CASCADE/RESTRICT 语义未变，并在事务后回滚的 probe 中确认同公司配对可写、跨公司配对被 composite FK 拒绝。
- `tech/02-data-model.md` → 更新迁移权威范围至 `001`–`020`，记录迁移 017–020，并补充岗位/站点归属完整性、preflight 阻止与 Env-only apply 说明。

## 门禁结果
- 相关静态迁移测试：4 通过 / 0 失败。
- `npm test`：1690 通过 / 0 失败 / 3 skip（共 1693 tests）。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
- `make docs-check`：headless 沙箱未提供 `make` 目录命令批准通道，未直接执行；按 Makefile 相同规则扫描时，命中仅存在于被排除的 `parallel-sessions/` 汇报文件，改动文档无违例，等价检查通过。
- DB 集成 apply/probe：未执行；任务边界禁止 `make db-*`、psql、migration apply，迁移 apply 仍为 Env-only。集成 probe 已写入 `tests/integration/db/test_migrations.sh`，待有数据库的 CI/用户环境运行。

## 遇到的问题
- 现有 `006_recruitment_sites.sql` 的 `company_id` 与 `site_id` 是两个独立 FK；各自目标行有效并不保证属于同一公司，因此确实存在跨公司错配窗口。迁移 020 通过匹配公司/站点复合 FK 收紧该不变量。
- 未执行任何数据库迁移或数据修复。若 preflight 发现存量错配，迁移会在创建唯一键和 composite FK 前失败；应先使用异常提示中的只读 SQL 审核，再由批准的独立数据修复操作处理后重试。

## 证据
- 静态测试命令：`npm exec --offline -- node --test tests/position-site-company-fk-migration.test.mjs` → 4 pass。
- 完整测试末尾摘要：`tests 1693 / pass 1690 / fail 0 / skipped 3`。
- 提交：`05acdef fix(q-db): enforce position site company ownership`、`5ac8d3f docs(q-db): document position site ownership invariant`、`fb2afda test(q-db): tighten migration mutation guard`。
- 分支/worktree 保持：`fix/quality-position-site-fk` / `/Users/acccan/dm-wt-q-db`；未 merge、未 push。

门禁: PASSED
结论: OK
