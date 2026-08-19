# ws1 — Bug1 视口:noMore 闩锁 / 挂载对齐加载 / 空批次语义

## 背景(boss + Explore 已定位根因)

用户报:视角拖动后工作 POI 不及时更新,杭州↔上海切换常出现整城无 POI。
Explore 浏览器复现 + 代码链证据:

1. **noMore 闩锁**:`viewport-search.ts:426-428` 空页/短页 → noMore=true;`map-shell.tsx:1010-1012` setNoMoreData。
   空批次(0 条)会被滤波/层级 maxTier 裁剪导致,并非「到底」——闩锁后无限滚动失效,
   恢复只能等下一次 moveend,**粘滞空白**。
2. **挂载后不加载**:mode 级缓存(非城市级)恢复后主加载早退(`map-shell.tsx:793-804`);
   地图初始化固定在杭州 zoom 13(`map-shell.tsx:497`);geolocation 被拒时**不产生任何
   moveend**(`map-shell.tsx:523-537` 只 setGeoSettled)→ 上次停在别的城市时刷新页面,
   **当前视野整城空白直到用户手动拖动**。
3. **空批次保护语义**:`map-shell.tsx:996` `if (batch.length === 0 && catalogRef.current.length > 0) return;`
   → 新视野请求返回空时旧城市 pin 全保留(屏幕外)→ 新城市视觉空白。
   空批次保护原意是防「收藏 fitToPins 退化视野清空」(tech/16),但用户拖动场景下
   保护过度。请求失败 vs 请求成功但真空,两种都应区分处理。
4. 参考:tech/16-bug-fixes.md 已有 VIEWPORT_SUPPRESS_MS(500ms)抑制窗口,勿移除。

## 任务(逻辑修复,保持现有设计语义)

1. **noMore 闩锁**:空批次(0 条)→ `noMore=false`(不闩锁);短页(< pageSize)仍闩锁。
   同步 `map-shell.tsx` 消费端与 `handleNeedMore` 门控恢复路径。
2. **挂载对齐加载**:mode 缓存恢复后,若缓存视野快照与当前地图视野显著不符
   (中心距离或 zoom 差超过阈值)→ 主动调度一次**当前视野**的视口加载,
   不再等用户 moveend。缓存内容新增视野快照字段(center+zoom,bounds 亦可);
   key 结构不变,旧缓存兼容(无快照字段 → 按不符处理,触发一次对齐加载)。
3. **空批次语义**:
   - 请求成功且 0 条:若旧目录中**没有任何 POI 落在当前视野 bounds 内** → 视为真空,
     `setCatalog([])` 走空态(列表显示现有空态文案);否则保留旧目录(收藏退化视野场景)。
   - 请求失败(网络/非 2xx):保留旧目录 + console.warn(现状行为保持)。
   - 不触碰 VIEWPORT_SUPPRESS_MS 抑制机制(tech/16 方案 A,收藏 fitToPins 由它兜底)。
4. **测试**:`server/tests/viewport-search.test.mjs` 增「0 条 → noMore=false」用例;
   组件契约测试(map-shell 相关)覆盖空批次三态(真空清空/保留/失败保留)与对齐加载触发。

## 文件边界(绝对路径,worktree = /Users/acccan/dm-wt-ws1)

- 只动:`server/src/components/map-shell.tsx`(视口加载相关段)、
  `server/src/lib/viewport-search.ts`、`server/src/lib/mode-cache.ts`(仅内容字段)、
  `server/tests/viewport-search.test.mjs`、契约测试文件
- **不碰**:`server/src/hooks/use-poi-map.ts`、`server/src/lib/map-markers.ts`(ws2 区域)、
  `server/src/components/account-panel.tsx`(ws4)、`server/src/lib/recruitment-*.ts`(ws3)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-ws1/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-ws1 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-fix-polish/reports/ws1.md`:
改动文件 + 每个修复点的实现简述 + 测试结果 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
## 续作附录(boss 2026-08-19,预算超限中断后重派)

上次中断前已提交:`78383f1 fix(work): 视口空批次(0 条)不闩锁 noMore,短页仍闩锁`。
工作树未提交改动(继续在其上做,勿丢弃):map-shell.tsx、mode-cache.ts、
component-contracts.test.mjs、mode-cache.test.mjs。

开工先 `git log --oneline -3` 确认现状,不重做。剩余任务:
1. 挂载对齐加载(mode-cache 视野快照 + 主动调度一次当前视野加载)
2. 空批次语义三态(真空清空 / 保留 / 失败保留)
3. 补齐测试 + 全部门禁 + 写报告

## 续作附录 2(boss 2026-08-19,再次预算超限)

**实现已全部完成并提交**(工作树干净):78383f1 noMore 闩锁 / 3a5430e 缓存视野快照 /
544e514 空批次三态 + 挂载对齐加载调度。**本次只做收尾,不再写实现**:
1. `cd /Users/acccan/dm-wt-ws1/server && npm test && npm run typecheck`
2. `cd /Users/acccan/dm-wt-ws1 && make docs-check && git diff --check`
3. 若测试红 → 修红(小改)后重跑;然后写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-fix-polish/reports/ws1.md`
   (改动文件 + 三修复点实现简述 + 测试结果,末两行 token 照常)
4. 门禁全绿后即结束,不额外探索。
