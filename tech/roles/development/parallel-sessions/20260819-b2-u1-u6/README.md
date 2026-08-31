# 批次 20260819-b2-u1-u6(补录 manifest)

> **补录说明(2026-08-19):** 本批开发时无 manifest 目录(各分支回报由用户在
> `/merge-agent` 参数内联提供),仅留 `merge-report.md`。按 CLAUDE.md 批次约定
> (`README.md` manifest + `prompts/` + `reports/`)补录本 manifest;prompts/reports
> 原始文件已不可考,内容以 `merge-report.md` 与 git log 为准。

## 目标

- WS-B(B2.1):修复 LLM 校验 fail(移除 4 条 / 修正标题 3 条 / 标注聚合 3 条)
- WS-U1:侧控栏 chrome 对齐(380px 基准;批次内「420px」为当时过期误记,2026-08-20 已核实修正,见 merge-report.md:42 补注)
- WS-U2:筛选器细化(refine)
- WS-U3:suggest 修复(距离显示等)
- WS-U4:Profile 重构
- WS-U5:移动端抽屉跟手物理
- WS-U6:poi-mixing 跨模式污染修复

## Workstream 表

| WS | 分支 | merge commit | 内容 |
|---|---|---|---|
| WS-B | `fix/b2-1-validation-fails` | `6be84b9` | LLM 校验 fail 修正 + 移除/标题/聚合标注 |
| WS-U1 | `feature/sidebar-chrome` | `8c650aa` | 侧控栏 chrome 对齐 |
| WS-U2 | `feature/filter-refine` | `f1c3887` | 筛选器细化 |
| WS-U3 | `feature/suggest-fix` | `73b2155` | suggest 修复 |
| WS-U4 | `feature/profile-redesign` | `f0152cc` | Profile 重构 |
| WS-U5 | `feature/mobile-drawer-physics` | `7afe414` | 移动端抽屉跟手 |
| WS-U6 | `fix/poi-mixing` | `490d388` | poi 跨模式污染修复 |

所有分支同基 `400f1e4`。合并顺序:WS-B → U1 → U2 → U3 → U4 → U5 → U6(按回报顺序)。

## 合并与门禁

- 7/7 分支 `--no-ff` 串行合并,每步 `npm test` + `npm run typecheck` + `make docs-check` +
  `git diff --check` 全绿,每步 push `origin dev`。
- 合并前基线 278 tests / 276 pass / 2 skip;合并后 **288 tests / 286 pass / 2 skip**。
- 冲突解决清单(6 次 CHANGELOG + secondary-sidebar.tsx + map-shell.tsx + U5 amend 去重)
  详见 `merge-report.md` §冲突解决清单。

## 遗留

- Env-only 步骤(迁移 apply / import:seed:apply / geocode)未执行,归用户。
- 测试计数已随 2026-08-19 后续批次漂移,以 `README.md` / `CLAUDE.md` 的
  **423 tests / 421 pass / 2 skip** 为权威值(merge-report.md:41 的建议已落实)。
- 其余遗留(portal-megvii-campus 去留、8 fail + 1 error 拆解、hz-poi-local worktree
  清理)见 `merge-report.md` §遗留问题。
