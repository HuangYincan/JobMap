# 20260819-boss-fix-polish — Boss 修复+完善批次

> **创建**:2026-08-19(boss-agent)
> **目标**:修复 2 个用户 bug + 按开发计划完善功能(boss 自主确定)
> **根因**:3 个并行 Explore 已定位(见各 prompt「背景/根因」段)

## 目标

1. **Bug1**:视角拖动后工作 POI 不及时更新;杭州↔上海切换常出现整城无 POI(含 marker 泄漏)
2. **Bug2**:公司无对应 icon(670/672 家全 🏢 默认徽章)
3. **功能完善**:Profile「我的投递」岗位行可点击跳转岗位详情(桌面/移动),收件箱通知行同类处理

## Workstream 表

| WS | 分支 | 主题 | prompt | 汇报 | 不碰 |
|---|---|---|---|---|---|
| ws1 | fix/work-viewport-blank | Bug1 视口:noMore 闩锁 / 挂载对齐加载 / 空批次语义 | prompts/ws1.md | reports/ws1.md | marker 控制器层(use-poi-map.ts)、account-panel、logo 链路 |
| ws2 | fix/marker-leak | Bug1 伴生:marker 泄漏(控制器与地图失同步) | prompts/ws2.md | reports/ws2.md | viewport-search.ts、视口加载逻辑(ws1 区域)、account-panel |
| ws3 | fix/company-icons | Bug2:DB 读路径 logo 解析链 + import 合并 logo + favicon 可达 | prompts/ws3.md | reports/ws3.md | map-shell.tsx、视口/marker 层、account-panel |
| ws4 | feat/profile-applications-open | 已投递/通知行可点击跳岗位(桌面+移动) | prompts/ws4.md | reports/ws4.md | 视口加载逻辑、marker 层、logo 链路 |

## 合并顺序(merger 按此逐个 --no-ff,红则停)

1. **ws1**(视口加载逻辑,map-shell.tsx 核心区) → 2. **ws2**(marker 层,依赖 ws1 的替换语义基调) →
3. **ws3**(logo 链路,独立) → 4. **ws4**(account-panel 接线,最后避开 map-shell 冲突)

冲突集中点:`server/src/components/map-shell.tsx`(ws1 视口逻辑段 vs ws4 profile 接线段)。
ws2 只动 use-poi-map.ts / map-markers.ts(必要时 map-shell marker 引用行);ws3 不碰 map-shell。

## 门禁(每 WS 必须全绿)

```bash
cd /Users/acccan/<worktree>/server && npm test && npm run typecheck
cd /Users/acccan/<worktree> && make docs-check && git diff --check
```

## 汇报契约

`reports/<ws>.md`:改动文件清单 + 门禁结果 + 遇到的问题 + 末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
