# Workstream 2 — tech/ 顶层编号文档修正 (fix/tech-docs)

## 背景

仓库文档维护批次。tech/ 顶层文档存在事实漂移（版本/迁移号/分支名/计数），部分规划文档未标注完成状态，两篇 00-* 历史报告内容重复。你是 headless worker：**worktree 已预建**（/Users/acccan/dm-wt-ws2，分支 fix/tech-docs），只改 worktree 内文件，**不要 merge/push/切分支**。提交用 Conventional Commits。

## 现状事实（以此为准，可自行验证）

- 栈：Next.js 16.3.1、React 19.2.8、CSS Modules（**未采用 Tailwind**）、TS 5.9.3、Node 22
- 迁移：001–016 已 live apply（当前基线 `dev`，旧分支 feature/phase-2-multi-mode 与 feature/phase-1-platform-baseline 均已并入/删除）
- 测试：server 488（486 pass / 2 skip）；crawler 计数以 `make test-unit` 实测为准
- 数据口径：杭州试点 137 公司/240 岗位（05-milestones 口径）；全国 import plan 以 `npm run import:seed` 输出为准
- 模块规范：Domain 读路径走 `/api/pois/domain-local`（hz_pois ILIKE）；maxTier 值域 0..21；侧控栏 420px 基准

## 任务（按文档逐篇，仅改有漂移处；无漂移的文档不动）

### 1. tech/01-architecture.md — **最过时，全面更新为现状**
- Next.js 15.5 → 16.3.1；「API routes 计划于 Phase 2」→ 已实现（/api/pois、/api/search、/api/suggest 等）；「live PostGIS 尚不存在」→ 001–016 已 live apply；基线分支 → dev；技术选型注明 CSS Modules（非 Tailwind）
- 保留架构方向/目录结构等仍有效内容

### 2. tech/02-data-model.md
- 迁移范围 001–004 → 001–016、标注已 live apply；「未对 live PostGIS 验证」→ 已验证
- canonical vs overlay/tenancy/provenance 建模边界保留

### 3. tech/04-workflow.md
- 修「dev 已与 feature/phase-2-multi-mode 同步」表述 → 分支已并入，当前基线 dev（worktree 先行规则保留）

### 4. tech/06-decisions.md
- ADR-003 更新：实际栈为 CSS Modules + Next 16（Tailwind 从未采用），标注为已定案事实；其余 ADR 不动

### 5. tech/11-phase2-plan.md
- 头部加状态标注：「已实施完成（Phase 2 已并入 dev），本文档为历史计划记录；当前实现规范见 08/09/10」；正文不改

### 6. tech/13-db-query-notes.md
- 迁移范围 001–010 → 001–016

### 7. tech/15-deploy.md
- 跑 `npm run import:seed`（**plan 模式，无 DB 副作用**；node_modules 已 symlink）拿权威公司/岗位计数，更新 runbook 中「137 公司/241 岗位/0 dropped」（与 05 的 240 有 1 条漂移）；若命令跑不通，按 05 全国口径（669/1440/877）修正并注明「杭州试点为历史口径」

### 8. tech/18-national-scale-plan.md
- 头部状态：WS1–4 里程碑已全部完成，仅余「全国验收」待 AMap 配额；§1 的 D1/A1/B1/D2 用户决策标注为权威记录（被 05/17 引用）

### 9. tech/20-development-plan.md
- 状态列更新：B3 已于 2026-08-19 批准并实现（见 tech/21）；A5/A7 卡 AMap 配额 → 2026-08-21 geocode-quota 批已处理（见批次目录 20260821-boss-geocode-quota）；删/改旧分支语境表述

### 10. tech/README.md（索引）
- 文档清单补 11-phase2-plan 状态标注（已实施完成）；17 标注（提案已存档，其数据口径为当前 catalog 口径）

### 11. 00-* 历史报告
- **00-phase1-closure-summary.md 与 00-phase1-frontend-completion.md 重复**：先 `git diff` 两文件核对独有内容，以 closure-summary 为主合并（frontend-completion 的独有段落并入对应位置），然后删除 frontend-completion，并在 closure-summary 头部注明「合并自 00-phase1-frontend-completion.md」；删除用 `git rm`
- 00-final-documentation-audit.md：头部加注「部分结论已过时（2026-08-21），当前契约以 01-22 与 agent.md 为准」；正文不改（历史文档）

## 文件边界
- 只改上述 `tech/*.md`（顶层）；不碰 `tech/roles/**`、根文档、代码
- tech/17 提案**保留不动**（含最新数据口径）

## 门禁（全部通过才算 OK）
1. `make docs-check`（worktree 根）→ 通过
2. `git diff --check` → 无空白错误
3. 一致性 grep：`grep -rn "Next\.js 15\|Next 15" tech/*.md` 仅允许出现在 00-*/11/12 的历史上下文；`grep -rn "001–004\|001–010\|001–013" tech/*.md` 无残留（历史上下文除外）
4. 00-* 合并后：`git log --diff-filter=D --oneline` 确认仅删了 frontend-completion；closure-summary 中保留了两篇的全部独有内容

## 回报
写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-docs-maintenance/reports/ws2.md`：
- 每篇文档做了什么（一句）、import:seed 实测计数（若跑了）
- 遇到的问题段（如 00-* 合并时的独有内容清单）
- 末两行精确 token：
```
门禁: PASSED
结论: OK
```
（失败则 `门禁: FAILED` + `结论: BLOCKED: <一句话>`）
