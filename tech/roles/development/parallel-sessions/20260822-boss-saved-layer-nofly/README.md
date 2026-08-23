# 20260822-boss-saved-layer-nofly — 打开收藏图层不跳视角

## 目标
用户反馈(2026-08-22):打开收藏图层时视角跳转(相机 fit 收藏外接框),**不要跳转**。
行为变更:打开/关闭收藏图层均不移动相机——只切换 pin 可见性与列表(互斥语义,上批已实现)。

## 现状
- `use-saved-layer.ts:86-108`:打开时 `map.setBounds(收藏外接框)` + 状态机置位(「收藏相机同步」)。
- `lib/saved-camera-sync.ts` + `use-work-viewport.ts` 消费 + `tests/saved-layer-sync.test.mjs`(6 个回归):
  第一批次(20260822-boss-saved-layer-toggle)为抑制 setBounds 动画事件清空 catalog 而建。
  **去掉 setBounds 后状态机无输入,应为死代码。**
- 保留:「空批次不置空 catalog」(use-work-viewport.ts:222 附近,独立加固,防任何空批次清池)。
- 上批互斥语义(20260822-boss-saved-layer-mutex)不动:开=只显示收藏+列表切收藏,关=恢复。

## Workstream
| ws | 分支 | worktree | 主题 | 门禁 |
|---|---|---|---|---|
| ws-1 | fix/saved-layer-nofly | ../dm-wt-saved-nofly | 收藏 toggle 不跳视角 + 状态机死代码清理 | typecheck + npm test + docs-check + 回归测试 |

## 合并顺序
1. ws-1(唯一)
