# ws2 汇报(2026-08-21)

分支 `fix/tech-docs`,worktree `/Users/acccan/dm-wt-ws2`。13 个小步 commit,共改 14 个文件(全为顶层 `tech/*.md`;`00-phase1-frontend-completion.md` 删除)。

## 实际改动(每篇一句)

1. **tech/01-architecture.md** → 全面更新为现状:Next.js 16.3.1 / React 19.2.8 / TS 5.9.3 / Node 22,注明 CSS Modules(非 Tailwind);「API routes 计划于 Phase 2」→ 已实现(列出 /api/pois、/api/pois/domain-local、/api/search、/api/suggest、/api/modes、/api/filter-options、/api/auth/*、/api/me/*);「live PostGIS 尚不存在」→ 001–016 已 live apply;基线分支 → dev;「Proposed API Contract」→「API Contract(已实现)」;目录结构去「planned」;Phase 1 决策节标注已解决项。
2. **tech/02-data-model.md** → 迁移范围 001–004 → 001–016(Authority + Implementation Evidence 列全),「未对 live PostGIS 验证」→ 已验证(live apply + test-integration);canonical vs overlay/tenancy/provenance 建模边界保留。
3. **tech/04-workflow.md** → Branch state 更新:phase-1/2 分支已并入 dev 并删除,当前基线 dev;worktree 先行规则保留。
4. **tech/06-decisions.md** → ADR-003 修订为已定案事实:实际栈为 CSS Modules + Next.js 16(15.x→16.3.1 升级出处保留),Tailwind 从未采用;其余 ADR 未动。
5. **tech/11-phase2-plan.md** → 头部加状态标注「已实施完成(Phase 2 已并入 dev),本文档为历史计划记录;当前实现规范见 08/09/10」;正文未改。
6. **tech/13-db-query-notes.md** → 迁移范围 001–010 → 001–016(头部 + Docker 验收清单两处)。
7. **tech/15-deploy.md** → runbook「137 companies / 241 positions / 0 dropped today」→ **2026-08-21 import plan 实测 688 companies / 1959 sites / 11602 positions / 0 dropped**(plan 模式实跑,无 DB 副作用);`make db-migrate` 注释 001–010 → 001–016。
8. **tech/18-national-scale-plan.md** → 头部状态:WS1–4 里程碑已全部完成并并入 dev,仅余「全国验收」待 AMap 配额(注明 2026-08-21 geocode-quota 批已加配额短路 + 腾讯兜底);§1 D1/A1/B1/D2 标注为权威记录(被 05/17 引用)。
9. **tech/20-development-plan.md** → B3 状态 → ✅ 2026-08-19 批准并实现(见 tech/21,触发阈值 zoom ≤ 8);A5 → ✅ 2026-08-21 geocode-quota 批处理(配额短路 + 腾讯三级兜底,迁移 012 已随 001–016 live apply);A7 → ⏳ 待执行(配额阻塞已解除);「当前阻塞与建议」两段同步更新。未发现旧分支语境表述(全文 grep 无 分支/feature/branch)。
10. **tech/README.md** → 11 标注「已实施完成,历史计划记录」;17 标注「提案已存档,其数据口径为当前 catalog 口径」。
11. **00-* 合并** → 以 closure-summary 为主合并 frontend-completion 全部独有内容后 `git rm` 删除 frontend-completion;closure-summary 头部注明「合并自 00-phase1-frontend-completion.md(2026-08-21)」。**附带** tech/05-milestones.md:48 的悬空引用同步为 closure-summary(必要;见问题 2)。
12. **00-final-documentation-audit.md** → 头部加注「部分结论已过时(2026-08-21),当前契约以 01-22 与 agent.md 为准」;正文未改。

**import:seed 实测计数(2026-08-21,plan 模式):`{"companies": 688, "sites": 1959, "positions": 11602, "dropped": 0, "issues": []}`**

## 门禁结果

- `make docs-check`:通过
- `git diff --check`:无空白错误
- 一致性 grep `001–004|001–010|001–013` tech/*.md:无残留
- 一致性 grep `Next.js 15|Next 15` tech/*.md:命中 00-initialization-report / 00-phase1-closure-summary / 11 / 12(均历史上下文,允许);**05-milestones:35,90 为既有历史记录**(见问题 1)
- `git log --diff-filter=D --oneline`:本批仅删 00-phase1-frontend-completion.md
- npm test:536 通过 / 0 失败 / 2 skip(基线)
- npm run typecheck:通过

## 遇到的问题

1. **05-milestones 两处「Next.js 15」命中(35/90)** — 均为本批之前就存在的**带日期历史记录**(35:「2026-08-20 由 Next 15.5.23 / React 19.0.8 升级」出处注记;90:Phase 2 明确标注「实施期记录」的历史段)。2026-08-20 scan 批(boss 批准)已明确决定保留这两处(见 20260820-boss-scan-optimize/reports/docs.md:34)。改动它们会篡改带日期历史事实,故未动。ADR-003 我新写的文字本含「Next.js 15」字面量,已重写为「15.x(2026-08-20 升级至 16.3.1)」避免在非历史文档引入新命中。
2. **05-milestones:48 悬空引用** — 原引「Full evidence in tech/00-phase1-frontend-completion.md」,删除该文件后必断链;05 是顶层 tech/*.md 且为必要合并后果,做了单行同步(指向 closure-summary 并注明合并)。如需回退此单行可 `git revert` 仅该 commit 的文件部分。
3. **00-* 合并的独有内容清单** — frontend-completion 独有、已并入 closure-summary 的段落:① Executive Summary;② Core Components 实现证据(map-shell 功能明细/CSS 明细/i18n/map-adapter);③ Features Implemented(桌面/移动/地图控件/响应式明细,含 58→276px、767px 断点、灵敏度 0.13/0.15);④ Animation Quality;⑤ Browser Verification 明细(已测/未测清单);⑥ map-adapter TS 代码片段;⑦ No Direct Data Access;⑧ Tenant Boundary;⑨ Code Quality Strengths(6 条);⑩ Issues 1–6 问题/修复/根因明细;⑪ 具体技术债清单(6 条);⑫ Security 补充(geolocation);⑬ Plugin Architecture Readiness(现状 + 4 项「一切皆插件」需求);⑭ Documentation 缺失清单(历史注记,后已补齐);⑮ Testing Recommendations for P2;⑯ Handoff Checklist for P2;⑰ Known Limitations 追加 4 条。全部经 20 个标记串逐项验证存在。
4. **tech/roles/development/phase1-code-review.md:349 仍引用 frontend-completion** — 该文件属 `tech/roles/**`(边界内「不碰」),且为 2026-08-15 带日期历史证据记录,保留原样。
5. **dev ref 滞后** — 本地 `dev` 引用落后 origin/dev(其他批次已合入);本批 13 个 commit 仅含上述 14 文件。未 merge/push,按 boss 流程由 merger 处理。

## 证据

- 13 个 commit:`18e0116`(01)…`06fb400`(06 措辞),见 `git log --oneline dev..HEAD`
- import plan 实测 JSON(上述);npm test 536 pass/2 skip;typecheck 0 错误
- 一致性 grep 输出(上述 3/4 段)

门禁: PASSED
结论: OK
