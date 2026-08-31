# Batch Manifest — 20260821-boss-map-engine

## 目标

地图引擎「一切皆插件」:前端底图(高德/腾讯/百度)与后端 geocode 链按 key 存在性驱动——只配任意一家可用、三家同配可用(自动按 AMap→腾讯→百度 选一 + UI 手动可切)。技术方案与设计决策见 boss 计划(`/Users/acccan/.claude/plans/baidu-ai-map-skill-skill-indexed-pearl.md`)。

## 冲突防护(硬约束)

项目当前有**两个活跃批次**并行修改:
- `20260821-boss-qqdoc-jobs`(worktree `dm-wt-qqj`,数据+ETL 文档)— **不碰**:`server/data/recruitment/qqdoc-jobs/`、`qq-doc-official-tabs.png`、`tech/roles/data/etl/qqdoc-official.md`
- `20260821-docs-maintenance`(worktrees `dm-wt-ws1..3`,tech/ 文档+agent.md)— **不碰**:`tech/01-architecture.md`、`tech/03-plugin-system.md`、`tech/06-decisions.md`、`agent.md`(重叠文件全部 defer 到该批次之后的独立文档批次,记 deferred-notes)

dev 基线:`786fc99`(qqdoc-official 批次已入库)。所有 worktree 从该 dev 切出;轮间 worktree 从合并后的 dev 切。

## Workstreams

| ws | 分支 | worktree | 主题 | 轮次 |
|---|---|---|---|---|
| a | feature/map-engine-backend | /Users/acccan/dm-wt-eng-a | 后端 geocode 配置化:注册表+formatter+脚本 REPORT+文档 | 轮1 |
| b | feature/map-engine-core | /Users/acccan/dm-wt-eng-b | 引擎内核:types/registry/preference/script-loader/coord-utils+测试 | 轮1 |
| c | feature/map-engine-amap | /Users/acccan/dm-wt-eng-c | AMap 引擎+map-shell 迁移(最大风险) | 轮2 |
| d | feature/map-engine-tencent | /Users/acccan/dm-wt-eng-d | 腾讯引擎 | 轮2 |
| e | feature/map-engine-baidu | /Users/acccan/dm-wt-eng-e | 百度引擎(bd09 边界转换) | 轮2 |
| f | feature/map-engine-ui | /Users/acccan/dm-wt-eng-f | UI 切换入口(图层面板地图源 section) | 轮3 |
| g | feature/map-engine-docs | /Users/acccan/dm-wt-eng-g | 文档收尾(仅零重叠项)+ 删 map-adapter.ts | 轮4 |

## 派发轮次与合并顺序

```
轮1: a、b 并行(worktree 已预建) → 合并 a→b
轮2: c、d、e 并行(worktree 从轮1合并后 dev 切) → 合并 c→d→e
轮3: f → 合并
轮4: g → 合并
每轮合并后 push origin/dev(门禁绿即自动,由 merger 执行)
```

文件边界:ws 之间互不相交(见各 prompt);轮内并行 ws 定期 `git merge dev` 保持分叉小。

## 门禁(每 WS、每轮合并)

- `cd <worktree>/server && npm test`(基线 549:547 pass / 2 skip,零漂移)+ `npm run typecheck`
- `cd <worktree> && make docs-check` + `git diff --check`
- 契约测试断言:engine-registry env 名/优先级、map-shell 无 `new window.AMap.Map`(轮2+)

## 合并后(boss/merger)

- 全部绿 → 派 merger → push origin/dev
- 本批次目录自身 commit 入库(既有模式)
- deferred-notes.md 项在最终总汇报告知用户
