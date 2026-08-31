# Quality Fix Batch 1 — 2026-08-27

## 目标

基于只读扫描 `tech/roles/development/quality-scans/20260827-all/scan-report.md`，自动修复无需产品、数据源授权或部署拓扑裁决的技术问题。所有开发在独立 worktree 完成；worker 不 merge、不 push；最终由 boss-merger 按序合并回 `dev`。

## 基线

- base branch: `dev`
- base commit: `d899b3f`
- origin/dev: `d899b3f`
- 扫描结果: High 8 / Medium 15 / Low 3
- 本批批准落地: #2 #4 #5 #6 #7 #9 #10 #12 #14 #15 #16（仅 migration 文件与测试，不 apply）#17 #18 #19 #20 #22 #23 #24 #25 #26
- 暂缓并记录: #1 #3 #8 #11 #13 #16 migration apply #21

## Workstreams

| ws | branch | worktree | 扫描项 | 拥有范围 | 明确不碰 |
|---|---|---|---|---|---|
| q-agent | `fix/quality-agent-boundaries` | `/Users/acccan/dm-wt-q-agent` | #2 #18 | Agent SSE 边界、地图 action schema/bridge、对应测试 | CSP、记忆产品交互、现有 UI 设计 |
| q-csp | `fix/quality-csp` | `/Users/acccan/dm-wt-q-csp` | #22 | `next.config.ts` CSP 收紧、兼容地图 SDK、对应测试/文档 | UI 布局、Agent SSE |
| q-recruit | `fix/quality-recruitment-integrity` | `/Users/acccan/dm-wt-q-recruit` | #4 #5 #9 #20 | freshness、recruitment import、记录级 provenance、导入审计、URL 质量与数据修复、对应测试 | 数据源口径项 #11/#21、迁移 apply、全局状态文档 |
| q-auth | `fix/quality-auth-integrity` | `/Users/acccan/dm-wt-q-auth` | #7 #10 | account-store 事务、OAuth verified-email、失败注入测试 | client IP / 部署拓扑 #8、UI 流程 |
| q-read | `fix/quality-public-read` | `/Users/acccan/dm-wt-q-read` | #6 #14 #15 #19 | domain-local bounds、POI by-id 定向查询、suggest SQL 下推、严格分页、性能/边界测试 | UI 视觉、DB migration、import 写路径 |
| q-robots | `fix/quality-robots-groups` | `/Users/acccan/dm-wt-q-robots` | #12 | robots 同 UA 多组规则合并与 fixture | fail-open 策略 #13、Feishu UA #1、live crawl |
| q-front | `fix/quality-frontend-edges` | `/Users/acccan/dm-wt-q-front` | #17 #25 | 搜索引擎 readiness 重放、maxTier=0、对应测试 | 任何现有 UI 视觉/交互重设计 |
| q-db | `fix/quality-position-site-fk` | `/Users/acccan/dm-wt-q-db` | #16 code-only | 新 migration、只读 preflight/回归测试、schema 文档 | 执行 migration、业务导入代码 |
| q-docs | `fix/quality-docs-current` | `/Users/acccan/dm-wt-q-docs` | #23 #24 #26 | 当前状态文档、env 示例、真实可执行质量契约 | 产品/数据口径、代码功能、历史记录改写 |

## 合并顺序

1. q-db
2. q-recruit
3. q-auth
4. q-robots
5. q-agent
6. q-csp
7. q-read
8. q-front
9. q-docs

依赖说明：schema foundation 先；招聘写路径随后；独立安全/爬虫/读路径中间；全局文档最后。若任一分支门禁红，merger 在该分支停止，不补开发缺口。

## 通用门禁

- 每个 finding 先复验；不成立则写证据，不做推测性改动。
- 匹配周边代码风格，新增回归测试覆盖具体失败场景。
- `cd server && npm test`（涉及 server）
- `cd server && npm run typecheck`（涉及 TS）
- crawler 相关运行对应 Python 测试。
- `make docs-check`
- `git diff --check`
- 不运行 migration apply、数据 import/geocode/crawl、依赖安装。
- Conventional Commits，小步提交；不要 merge/push。
