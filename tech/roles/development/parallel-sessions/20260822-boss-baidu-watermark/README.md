# Batch — 20260822-boss-baidu-watermark

## 目标

隐藏百度地图左下角水印(百度 API 自动注入的 `.anchorBL` 内的 `logo_hd.png`)。

## Workstream 表

| ws | 分支 | worktree | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|---|
| w1 | `fix/baidu-watermark` | `/Users/acccan/dm-wt-baidu-watermark` | 隐藏百度地图 anchorBL 水印(CSS 或配置层) | 百度地图相关样式/组件/配置 | 高德/腾讯地图样式、地图引擎核心逻辑、现有 UI 设计语义 |

## 合并顺序

1. w1(单 WS,无依赖)

## 门禁(每分支)

- `cd server && npm test && npm run typecheck`
- `make docs-check`
- `git diff --check`

## 纪律

- worktree 已预建,boss 统一合并;worker 不 merge/push,不碰主树。
- 提交 Conventional Commits,频繁小步 commit。
- 改现有 UI 设计 / Env-only / 口径问题 → 记入 `deferred-notes.md`。
