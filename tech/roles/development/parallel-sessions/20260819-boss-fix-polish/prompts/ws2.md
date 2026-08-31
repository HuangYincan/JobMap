# ws2 — Bug1 伴生:marker 泄漏(控制器与地图失同步)

## 背景(boss + Explore 已定位)

浏览器实测:杭州↔上海往返多次后,**同一批 2 个 marker 永久残留**(浙江省发展规划研究院
120.099,30.299 / 中国电建华东院 120.079,30.324,杭州坐标,屏幕外),而 catalog 已是上海 7 条;
`map.getAllOverlays('marker')` 计数 9 > catalog 7。残留 marker **不在控制器内部 markers Map 中**
(否则 setPOIs 差分会移除),与控制器创建/销毁或异步 amap ready 竞态有关
(`server/src/hooks/use-poi-map.ts:127-171`,map 从 null→instance 时创建控制器 + applySync 时序)。

相关代码:
- `server/src/lib/map-markers.ts` — setPOIs 差分(382-410)、removeMarker(306-315)、marker 创建
- `server/src/hooks/use-poi-map.ts` — 控制器生命周期(127-171)、applySync(149-154)
- map-shell 中 marker 渲染调用点(读,必要的最小改动)

## 任务(修复失同步,保持现有渲染语义)

1. 精确定位失同步路径:控制器创建/销毁时序、addMarker 后未入 Map 的分支、
   destroy() 未清地图 overlay、异步地图实例竞态。
2. 修复,目标不变式:**销毁后地图上无该控制器管理过的 overlay;`getAllOverlays('marker')`
   计数恒等于 catalog 数**(允许短暂过渡)。
3. 浏览器复现验证(dev server :3000,Playwright):杭州↔上海往返 ×2 后断言
   marker 计数 == catalog 数、无屏幕外残留。验证结果写入汇报。
4. 测试:为修复点补单测/契约测试(map-markers 或 use-poi-map 相关,视现有测试结构)。

## 文件边界(绝对路径,worktree = /Users/acccan/dm-wt-ws2)

- 只动:`server/src/hooks/use-poi-map.ts`、`server/src/lib/map-markers.ts`、
  `server/src/components/map-shell.tsx`(仅 marker 渲染/控制器引用必要行)、相关测试文件
- **不碰**:`server/src/lib/viewport-search.ts`、map-shell 中视口加载逻辑段(noMore/空批次/缓存,ws1 区域)、
  `server/src/components/account-panel.tsx`(ws4)、`server/src/lib/recruitment-*.ts`(ws3)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-ws2/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-ws2 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-fix-polish/reports/ws2.md`:
失同步根因定位 + 修复实现 + 复现验证结果(marker 计数断言)+ 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
## 续作附录(boss 2026-08-19,预算超限中断后重派)

上次中断前**无 commit**,仅有未跟踪的复现/测试骨架(勿删除,直接复用):
`server/tests/fixtures/amap-mock.mjs`、`server/tests/marker-leak.test.mjs`、`server/tests/repro-marker-leak.mjs`。

本次执行纪律(预算紧张,优先价值):
1. 先读这三个文件,判断骨架完成度;直接续写实现(use-poi-map.ts / map-markers.ts 修复)
2. **先 commit 实现,再补测试,最后跑全量门禁**;每完成一个修复点即 commit,避免中断丢成果
3. 浏览器复现验证如耗时长,可仅做一次(或依赖 marker-leak.test.mjs 断言),结果写入汇报
4. 若预算将尽仍未完成 → 立即 commit 已完成的修复 + 写半程汇报(末两行 token 照常)
