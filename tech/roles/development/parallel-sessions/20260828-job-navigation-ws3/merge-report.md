# 合并报告（2026-08-28）

## 结果总览

- 成功合并：`ws3-eval-events` × 1。
- 失败/遗留分支：0。
- 基线：`dev == origin/dev == 718c3f2`，因此合并前未执行不必要的网络 pull。
- 目标：`feature/job-navigation-ws3-eval-events`，已核对并合入指定 tip `d52f0b4`。
- 合并提交：`3ca3cb0 feat(navigation): merge job navigation ws3 eval events`。
- 合并策略：`--no-ff`；无冲突，未触碰或暂存主工作树既有用户改动。

## 提交清单

- `66bff3a docs(development): dispatch job navigation ws3`：仅跟踪本批 README、prompt、report、boss-state、deferred-notes 与 merge-instructions。
- `f278ea5 feat(ws3-eval-events): add event sink, policy, and offline eval runner`
- `5481c18 test(ws3-eval-events): cover sink, runner metrics, and python parity`
- `b02374a feat(ws3-eval-events): add SQL and Python offline eval reports`
- `d52f0b4 docs(ws3-eval-events): record offline eval sink, runner, and baseline`
- `3ca3cb0 feat(navigation): merge job navigation ws3 eval events`
- `docs(development): record job navigation ws3 merge`：本报告、VERIFY/MERGED 状态和 `tech/31` WS3 状态收口所在提交。

## 门禁

| 门禁 | 实际结果 |
|---|---|
| `tests/navigation-eval-runner.test.mjs` | 8 tests；8 pass / 0 fail / 0 skip |
| `npm test` | 1818 tests；1815 pass / 0 fail / 3 skip |
| `npm run typecheck` | 通过 |
| `make docs-check` | 通过；`Documentation policy check passed.` |
| `git diff --check` | 通过 |

专项与全量均串行独立执行；未与其他重任务并行。

## 冲突与主树保护

- 合并由 `ort` 完成，无冲突、无人工取舍。
- 既有 `server/next-env.d.ts` 保持未暂存，内容 blob hash 始终为
  `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`。
- 既有未跟踪 `.agents/`、`AGENTS.md`、`server/tech/`、旧批次与质量扫描目录均未暂存、
  未清理、未重置或改写；本批目录按授权显式跟踪。
- 未触碰两个 `feature/job-navigation-ws0-review-*` worktree 或分支。
- 未修改 `tech/roles/development/parallel-sessions/20260828-job-navigation-ws2/`。

## 明确遗留

- Live provider：生产仍只注册显式 `estimate`；高德/腾讯/百度的选择顺序、账号权限、条款、
  配额、缓存/展示、商业许可和真实 key 冒烟仍待人工确认。当前没有真实道路 geometry、
  实时路况或 provider arrival-by。本批 runner 只用 estimate / 注入 fake provider。
- UI：`tech/31` §8 尚未获用户明确批准，WS4 继续 blocked；未画 overlay、未改面板。
  真实用户样本与桌面/移动 UI 评测仍未实现。
- Env-only：未运行 live provider、DB migration apply、seed/import apply、geocode 或任何需
  key/数据库的动作。
- 数据与隐私：产品分析事件 persistence、同意、删除、访问控制和留存期限仍未决；WS3 sink
  可替换但不落库，不复用 `audit_events`。
- 口径：§7.3 指标是确定性策略 + 契约校验，不是线上 LLM 准确率；n=40 合成样本不能外推
  真实用户。
- M4：离线指标/报告已实现，UI/真实用户样本未实现。

## 最终 dev 状态

- WS3/M4 离线评测闭环已完成并合并；UI/真实用户样本仍未实现。下一开发依赖为用户批准
  `tech/31` §8 后的 WS4；不自动派 WS4/WS5。
- `dev` 只在完整门禁和状态文档复验全绿后推送到 `origin/dev`；绝不推送 `main` 或 force-push。

门禁: ALL_GREEN
结论: MERGED_ALL
