# q-docs — 当前状态、env 示例与真实质量门禁

## 路径

- worktree: `/Users/acccan/dm-wt-q-docs`
- branch: `fix/quality-docs-current`
- report: `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260827-quality-fixes-1/reports/q-docs.md`
- scan findings: #23 #24 #26

## 任务

1. 逐项用代码、migration 文件、测试输出/配置、最新 CHANGELOG 与数据台账复验 `tech/05-milestones.md` 等“当前状态”数字和架构描述。同步 strict DB-only、最新 migration 范围、测试基线、数据统计；不要凭扫描报告抄数字，必须找到可验证来源。
2. 修复 `server/docs/environment-variables.md` 的 `NEXT_PUBLIC_API_BASE_URL` 示例，避免客户端再拼 `/api` 形成 `/api/api`；搜索 `API_*` 开关真实消费者，对无消费者项删除或明确标记“未实现/保留”，不得宣称可用。
3. 复验 `agent.md` 的 ESLint/Prettier/Black 契约与 package/pyproject。选择最小真实方案：优先把契约改成仓库当前确实可执行的门禁；除非依赖已存在，否则不得安装/新增臆造工具链。
4. 尽量建立单一状态来源或减少重复数字；不要大范围重写历史文档。

## 边界

- 只改文档/现有检查脚本中与文档一致性直接相关的最小部分；不改产品代码、数据文件或 UI。
- 不运行 import/geocode/crawl/migration，不安装依赖。
- 其他 workstream 可能随后改变测试数；报告中把瞬时测试基线注明 commit，避免写“永远固定”。

## 门禁与提交

- `make docs-check`
- 如需验证 server 当前测试基线，可运行 `cd server && npm test`
- `git diff --check`
- Conventional Commits；不要 merge，不要 push。

## 回报

报告列出每个旧值→新值及证据位置、env 消费者搜索结论、质量契约选择。末两行：

`门禁: PASSED` 或 `门禁: FAILED`

`结论: OK` 或 `结论: BLOCKED: <一句话>`

## Boss 裁决附录（续作重派）

上一轮 worker 因 API 提供商瞬时错误（`invalid_request_error: reasoning_text … must be passed back`）中断，未提交、未写报告。**工作树仍保留 8 个文档文件的未提交修改**：

```
CLAUDE.md  CONTRIBUTING.md  README.md  agent.md
server/README.md  server/docs/environment-variables.md
tech/01-architecture.md  tech/05-milestones.md
```

请先审阅现有 `git status` / `git diff`：属于本任务范围且内容正确的改动保留并完成；缺漏或错误则补齐/修正。核对工作树是否只改了文档（不应触碰产品代码/数据/UI）。随后按任务要求小步 Conventional Commit、跑 `make docs-check` + `git diff --check`、写报告。不要重做已完成的核对，不要创建空提交。
