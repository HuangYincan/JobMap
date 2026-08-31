# 合并报告（2026-08-28）

## 结果总览

- 成功合并：`ws4-frontend` × 1。
- 失败/遗留分支：0。
- 基线：`dev == origin/dev == 673502d`，因此合并前未执行不必要的网络 pull。
- 目标：`feature/job-navigation-ws4-frontend`，已核对并合入指定 tip `ebd8bbe`。
- 合并提交：`4396876 feat(navigation): merge job navigation ws4 frontend`。
- 合并策略：`--no-ff`；无冲突，未触碰或暂存主工作树既有用户改动。

## 提交清单

- `e22c595 docs(development): dispatch job navigation ws4`：仅跟踪本批 README、prompt、report、boss-state、deferred-notes 与 merge-instructions。
- `648c2b1 feat(ws4-frontend): add MapView.createPolyline across three engines`
- `736debe feat(ws4-frontend): draw showRoute from session artifact GET`
- `c836614 feat(ws4-frontend): add commute filter, overlay bar, and compare table`
- `a5857e7 feat(ws4-frontend): show commute badges and 看路线 without geometry in the card`
- `d22f173 feat(ws4-frontend): wire Work commute chrome, source bar, and mobile trip tabs`
- `104b84a test(ws4-frontend): cover overlay contracts, commute i18n, and showRoute loading`
- `ebd8bbe docs(ws4-frontend): record approved §8 layout and estimate-only overlay`
- `4396876 feat(navigation): merge job navigation ws4 frontend`
- `docs(development): record job navigation ws4 merge`：本报告、VERIFY/MERGED 状态和 `tech/31` WS4/M3 状态收口所在提交。

## 门禁

| 门禁 | 实际结果 |
|---|---|
| `tests/agent-map-executor.test.mjs` + `tests/commute-filter.test.mjs` | 33 tests；33 pass / 0 fail / 0 skip |
| `npm test -- --test-concurrency=1` | 1835 tests；1832 pass / 0 fail / 3 skip |
| `npm run typecheck` | 通过 |
| `make docs-check` | 通过；`Documentation policy check passed.` |
| `git diff --check` | 通过 |

专项与全量均串行独立执行；未与其他重任务并行。worker 汇报写过「1835 通过」一处，独立复核为 **1832 pass / 3 skip**（tests 总数 1835）。

## 冲突与主树保护

- 合并由 `ort` 完成，无冲突、无人工取舍。
- 既有 `server/next-env.d.ts` 保持未暂存，内容 blob hash 始终为
  `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`。
- 既有未跟踪 `.agents/`、`AGENTS.md`、`server/tech/`、旧批次与质量扫描目录均未暂存、
  未清理、未重置或改写；本批目录按授权显式跟踪。
- 未触碰两个 `feature/job-navigation-ws0-review-*` worktree 或分支。
- 未修改已跟踪的 WS2/WS3 批次文件。

## 明确遗留

- Live provider：生产仍只注册显式 `estimate`；高德/腾讯/百度的选择顺序、账号权限、条款、
  配额、缓存/展示、商业许可和真实 key 冒烟仍待人工确认。当前没有真实道路 geometry、
  实时路况、live traffic 或 provider arrival-by。实线 overlay 仅在同会话未过期 provider
  artifact GET 200 时出现。
- UI / WS5：会话内主动建议与三场景演示闭环仍属 WS5；Playwright 桌面/移动截图仍待合并后补。
- Persistence：产品分析事件 persistence、同意、删除、访问控制和留存期限仍未决；不落库、
  不复用 `audit_events`。
- Env-only：未运行 live provider、DB migration apply、seed/import apply、geocode 或任何需
  key/数据库的动作。
- 用户研究：M0 的 5–8 人任务访谈仍无证据。

## 最终 dev 状态

- WS4/M3 用户体验闭环已完成并合并；生产仍 estimate-only，无 live traffic。下一开发依赖为
  WS5；不自动派 live provider。
- `dev` 只在完整门禁和状态文档复验全绿后推送到 `origin/dev`；绝不推送 `main` 或 force-push。

门禁: ALL_GREEN
结论: MERGED_ALL
