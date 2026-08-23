# Batch 20260823-boss-map-source-lock

> 目标(用户 2026-08-23):三家底图切换时有各种 POI 消失的 bug → 禁用腾讯与百度底图
> (不删代码,只是不让用户用);收藏图层默认改为不开启。

## Workstream 表

| ws | 分支 | worktree | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|---|
| ws-map-source | feature/map-source-lock | /Users/acccan/dm-wt-map-source | 禁用腾讯/百度底图:ENGINE_PRIORITY 只留 amap | server/src/lib/map-engine/engine-registry.ts、server/tests/component-contracts.test.mjs(仅 773 行断言) | 引擎实现代码(tencent/baidu 引擎原样保留)、layers-panel UI 结构、use-map-engine 逻辑 |
| ws-saved-default | feature/saved-layer-default-off | /Users/acccan/dm-wt-saved-default | 收藏图层默认关:useState(false) + readSavedOverlayPref(false) | server/src/hooks/use-saved-layer.ts(46/50 行)、server/tests/hooks-contracts.test.mjs(105 行断言) | saved-overlay.ts 纯函数、map-shell 接线、layers-panel |

## 合并顺序

1. ws-map-source
2. ws-saved-default

(无依赖,任意序;red 则停)

## 门禁(两个 ws 相同)

```bash
cd /Users/acccan/dm-wt-<ws>/server && npm test        # 全量 1487 测试,须全绿
cd /Users/acccan/dm-wt-<ws>/server && npm run typecheck
cd /Users/acccan/dm-wt-<ws> && make docs-check && git diff --check
```

## 关键结论(boss 探索,worker 直接采用)

- 底图切换唯一事实源 = `server/src/lib/map-engine/engine-registry.ts` 的
  `ENGINE_PRIORITY`:`MapSourceSection`(layers-panel.tsx)按它渲染 chip、
  `resolveEngine`(mount.ts)按它回落、`use-map-engine` 挂载重试按它取
  configured 列表、`readEnginePreference` 的 sessionStorage 历史值也经它过滤。
  改为 `['amap']` 后:UI 无腾讯/百度入口、解析与回退恒为高德、历史偏好自动回落,
  三家引擎实现代码一行不删。
- 收藏图层默认值在 `server/src/hooks/use-saved-layer.ts`:useState(true) +
  readSavedOverlayPref(true)。改为 false 后:首次渲染关,挂载后读
  sessionStorage `domain-map:saved-overlay`——显式开过的用户('1')保持开,
  未存过/显式关的用户默认关。符合「默认不开」。
- .env.local 已配齐三家 key(AMap 配置齐全,禁用无风险)。
