# q-read — 公共读路径性能与输入边界

## 路径

- worktree: `/Users/acccan/dm-wt-q-read`
- branch: `fix/quality-public-read`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-read.md`
- scan findings: #6 #14 #15 #19

## 任务

1. `domain-local` 浏览端点必须拒绝缺失、非法或超出允许杭州范围的 bounds，避免百万 `hz_pois` 的无边界 count/sort；保留现有合法 bbox 行为。按现有 DB wrapper 能力增加可测的查询超时/硬上限，不能靠注释。
2. 将单 POI 详情从“加载全目录再 find”改成按 slug/site id 的参数化定向 SQL，只返回目标公司/站点/岗位与必要 aggregate；保持 API shape 与 404 语义。
3. 将 Work suggest 公司/岗位匹配下推 SQL，使用受限前缀/trigram 方案与 `LIMIT 10`，避免每个 cache miss 物化全 catalog。复用现有索引；若缺索引需 migration，则先给可用的受限 SQL，不抢 q-db migration 编号。
4. POST `/api/search` 的 page/pageSize 与 GET 公共契约一致：必须是有限正整数、范围合法，非法返回 400，不静默 floor/NaN。
5. 新增查询参数/SQL 调用回归测试，证明无 bounds 不触发 store、by-id/suggest 不走全量 loader、合法响应兼容。
6. 只更新公共读路径专属文档；不改 UI。

## 边界

- 不修改 recruitment import 写路径、DB schema/migration、现有 UI 设计。
- 不运行数据库/迁移/导入；测试必须可在 no-DB gate 下通过。

## 门禁与提交

- `cd server && npm test`
- `cd server && npm run typecheck`
- `make docs-check`
- `git diff --check`
- 小步 Conventional Commits；不要 merge，不要 push。

## 回报

给出每个旧全量路径被替换的证据、API 兼容性与测试结果。末两行：

`门禁: PASSED` 或 `门禁: FAILED`

## Boss 裁决附录（续作重派）

上一轮 worker 因 API 提供商瞬时错误中断，**已提交 `919c709 fix(q-read): bound public domain POI reads`**，另有未提交改动：`server/src/app/api/{search,suggest}/route.ts`、`server/src/lib/{recruitment-store,server-catalog}.ts`、测试与 3 个 tech 文档。请先审阅 `git log` + `git status` / `git diff`：保留已提交成果与范围内正确的未提交改动并补完，缺漏则补齐/修正。随后继续小步 Conventional Commit、跑门禁、写报告。不要重做已完成的核对，不要创建空提交。

`结论: OK` 或 `结论: BLOCKED: <一句话>`
