# Manifest — 20260819-boss-cluster-viewport

## 目标

用户 /boss-agent 请求(2026-08-19):

1. **B3 城市聚合** → 用户批准布局图后修改,触发阈值改为 **zoom ≤ 8**
   (原方案 zoom ≤ 7 一直在等批准)。
2. **修复「工作 POI 不随视角改变而改变」**—— 首批修复(20260819-boss-fix-polish,dev
   `a79c941`)用户实测确认仍未解决,需二次修复。

## workstreams

| ws | 分支 | 主题 | 文件 | 状态 |
|---|---|---|---|---|
| ws-a | feat/city-clustering | B3 城市聚合(zoom ≤ 8 徽章 ↔ > 8 个体,点击下钻) | city-cluster.ts(新)、map-markers.ts(新增导出)、map-shell.tsx(聚合段)、city-cluster.test.mjs(新)、tech/21 | DONE |
| ws-b | fix/viewport-poi-update | 工作 POI 不随视角改变(根因:distance 圆心钉挂载 userLocation 永不更新) | map-shell.tsx(distanceOrigin 实时化 + 空批次裁空清理)、测试 | RUNNING |

## 合并顺序

1. ws-b → 2. ws-a(先合视口修复再合聚合,map-shell 段位不同,token 区不冲突)

## 报告

- reports/ws-a.md:`门禁: PASSED / 结论: OK`(411 tests,含 13 项聚合单测)
- reports/ws-b.md:待 worker 完成