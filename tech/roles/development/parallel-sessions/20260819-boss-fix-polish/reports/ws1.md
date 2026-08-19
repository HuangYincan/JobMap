# ws1 汇报(2026-08-19)

Bug1 视口:noMore 闩锁 / 挂载对齐加载 / 空批次语义。实现已完成并分三次提交(续作两次预算超限,本次为收尾:门禁全绿 + 报告)。

## 实际改动

提交:`78383f1`(noMore 闩锁)→ `3a5430e`(缓存视野快照)→ `544e514`(空批次三态 + 挂载对齐加载调度)。工作树干净。

- `server/src/lib/viewport-search.ts` → 三处逻辑:
  1. **noMore 闩锁**:`loadWorkViewport` 遇 0 条空批次 → `noMore=false`(空批次多为滤波/maxTier 裁剪,非「到底」,保留无限滚动重试);短页(< pageSize,1..size-1 条)仍 `noMore=true`。空批次同时返回 `vacant` 信号。
  2. **空批次三态判定**:新增 `catalogCoversView(旧目录, bounds)` — 请求成功且 0 条时,若旧目录无任何 POI 落当前视野 bounds 内 → 真空(清空);有 POI 在视野内 → 保留(收藏 fitToPins 退化视野场景)。新增 `needsViewportAlign(快照, center, zoom)` — 无快照 / 中心距离超阈值 / zoom 差超阈值 → 不符。新增 `ViewportSnapshot` 类型(center+zoom+bounds)。
  3. `fetchWorkViewportPage` / `loadWorkViewport` 透出服务端 total 与 vacant 信号(已有 total 逻辑保留)。
- `server/src/lib/mode-cache.ts` → `ModeCacheEntry` 新增可选 `viewport?: ViewportSnapshot` 字段 + 解析/回写;**不 bump 版本**(字段可选,旧缓存无需失效);旧缓存无快照 → 解析为 undefined,调用方按「与当前视野不符」处理,触发一次对齐加载后写入新快照。
- `server/src/components/map-shell.tsx` → 视口加载相关段:
  1. **noMore 消费端**:`setNoMoreData` 同步空批次不闩锁;`handleNeedMore` 门控恢复路径与 `viewport-search` 一致(空批次可重试)。
  2. **挂载对齐加载**:mode 缓存恢复后读取快照,`needsViewportAlign` 判不符 → 主动 `viewportLoaderRef.current.schedule()` 一次**当前视野**加载,不再等 moveend(geolocation 被拒不产生 moveend 的场景由此兜底);`VIEWPORT_SUPPRESS_MS` 抑制窗口保留不动。
  3. **空批次三态**:消费 `vacant` 信号 —— 真空 → `setCatalog([])` 走现有空态文案;旧目录有 POI 在视野内 → 保留;请求失败(非 2xx 抛错)→ 保留旧目录 + console.warn(现状行为保持)。domain 加载路径无 vacant 信号,用合并池推断(末池 ≤ 加载前目录长度)。
- `server/tests/viewport-search.test.mjs` → 新增:0 条 → noMore=false;短页(1..size-1 条)仍闩锁;首页满页+次页空 → vacant=false(请求有数据,非真空);`catalogCoversView` 判定;`needsViewportAlign` 无快照/远中心/zoom 差超阈值判不符。
- `server/tests/component-contracts.test.mjs` → 新增:工作视口空批次三态(真空清空/保留/失败保留)契约;map shell 挂载对齐加载契约(缓存快照不符 → 主动调度一次视口加载)。
- `server/tests/mode-cache.test.mjs` → 新增:视野快照 round-trip;旧缓存无快照 → viewport=undefined(触发对齐加载)。

## 门禁结果

- npm test: 376 通过 / 0 失败(2 skipped,既有)
- typecheck: 通过
- docs-check: 通过(`make docs-check` "Documentation policy check passed.")
- git diff --check: 通过(工作树干净)

## 遇到的问题

- 续作两次预算超限中断(boss 附录)→ 已提交成果在,本次按附录 2 只做收尾,未重做、未写新实现。
- 沙箱对复合命令(`cd && make`、`make -C`、`npx vitest`)弹权限 → 拆步执行;`npm test` 全量已覆盖契约/缓存测试文件,用例名经 Grep 核实。
- `make docs-check` 在 server/ 目录无规则 → 回到 worktree 根执行即可(非代码问题)。

## 证据

- 关键用例输出(full `npm test`,全部 pass):
  - `loadWorkViewport: 0 条 → noMore=false(空批次不闩锁,ws1 Bug1)`
  - `loadWorkViewport: 短页(< pageSize,1..size-1 条)仍闩锁 noMore=true`
  - `loadWorkViewport: 首页满页 + 次页空 → vacant=false(请求有数据,非真空)`
  - `catalogCoversView: 旧目录是否仍有 POI 落在视野内(空批次三态判定)`
  - `needsViewportAlign: 无快照/远中心/zoom 差超阈值 → 不符(触发对齐加载)`
  - component-contracts:331 `work viewport empty batch three-state (ws1 Bug1): 真空清空 / 保留 / 失败保留`、351 `map shell mount-align load (ws1 Bug1): 缓存快照不符 → 主动调度一次视口加载`
  - mode-cache:227 `viewport snapshot round-trips through the cache`、251 `legacy cache without viewport snapshot reads viewport=undefined (触发对齐加载)`
- 文件边界核对:改动仅限允许清单(map-shell.tsx / viewport-search.ts / mode-cache.ts / 三个测试文件);未碰 use-poi-map.ts、map-markers.ts(ws2)、account-panel.tsx(ws4)、recruitment-*.ts(ws3)。

门禁: PASSED
结论: OK
