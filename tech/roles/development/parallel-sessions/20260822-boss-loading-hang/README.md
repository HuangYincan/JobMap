# Batch — boss-loading-hang(2026-08-22)

> BUG 目标:第一次进入网站必定卡死在加载界面,浏览器刷新后才正常进入。

## 根因(Explore 已定位,见下方引用)

- **Gate B**:`map-shell.tsx:2254-2263` 的 "Loading map..." 全屏覆盖层,唯一释放条件
  = `mapReady`(createMap 成功后置 true)= useMapEngine 成功产出 view。
- **C1(最强)**:`amap-api.ts:66-99` `loadAMap()` 全链路唯一无 `setTimeout` 的 await;
  中途卡死(DNS/TLS/CDN)Promise 永不落定(代码注释自我承认)。`use-map-engine.ts:347-364`
  挂载失败仅 `console.warn`,无错误态、无重试 → `mapReady` 恒 false → 永卡 "Loading map..."。
  首访冷浏览器必中;刷新后 HTTP 缓存命中秒开。**与「必现+刷新即好」完全吻合**。
- **C2(次强)**:首访 `loadWorkViewport` 10k 页**串行无超时**循环(`viewport-search.ts:441-471`,
  `WORK_FULL_LOAD_MAX_PAGES=10_000`)vs 刷新走 `useModeCacheRestore` 缓存短路 → 首访若有任一页
  挂起即永远停在列表「加载」。
- **C3**:dev StrictMode double-invoke / Turbopack 冷编译时序,已有 keepalive 热修链
  (commit 0052ed0),仍有时序错位 → 空 view 永挂的可能。

修复策略:三条启动链全部**有界化 + 可重试 + 错误出口 UI**,一次覆盖 C1/C2/C3。

## Workstream 表

| ws | 主题 | 分支 | worktree | 文件边界(不碰清单) |
|---|---|---|---|---|
| ws-1 | AMap 加载超时化+失败可重试 | fix/amap-load-timeout | ../dm-wt-load-engine | `server/src/lib/amap-api.ts` + `server/tests/amap-api.test.mjs` |
| ws-2 | 引擎挂载失败错误态+重试 | fix/mount-retry | ../dm-wt-load-hook | `server/src/hooks/use-map-engine.ts` +(如需)`server/src/lib/map-engine/mount.ts` + `server/tests/map-engine-mount.test.mjs` + `server/tests/hooks-contracts.test.mjs` |
| ws-3 | 加载覆盖层失败态 UI | fix/loading-error-ui | ../dm-wt-load-ui | `server/src/components/map-shell.tsx` + `map-shell.module.css` + `server/src/lib/i18n.ts`(仅追加 key)+ `server/tests/component-contracts.test.mjs` |
| ws-4 | 首访全量加载有界化 | fix/first-load-bounded | ../dm-wt-load-data | `server/src/lib/viewport-search.ts` + `server/tests/viewport-search.test.mjs` |

文件互不相交(已核:i18n.ts 仅 ws-3 追加 key;其余各 ws 独占文件)。**不得触碰他人文件
(包括 tech/ 文档与 server/docs/,由 boss 统一补文档槽位,或按各 ws prompt 内的明确授权)。**

## 跨 WS 契约(必须一致)

1. **ws-1 → ws-2**:`loadAMap()` 失败(超时/onerror)必须 `reject`,且清缓存的
   `loadPromise=null` + 移除失败 script 标签;超时 error 带 `code: 'AMAP_LOAD_TIMEOUT'`。
   函数签名与正常路径行为不变。
2. **ws-2 → ws-3**:`useMapEngine()` 返回值追加两个字段(现有 4 字段签名不变):
   - `mountError: { engine: string; code?: string; message: string } | null`
     —— 挂载链(含引擎回退)全部失败后非 null;重新开始挂载时立即清 null。
   - `retryMount: () => void` —— 重新执行 resolveEngine → mountEngineView 挂载链;
     挂载进行中调用为 no-op(幂等);成功后 view 落地路径与首挂载一致。
3. **ws-3**:覆盖层三态:加载中(现状文案/style 零改动)/ 失败态(新)/ 配置缺失(现状文案)。
   失败态:主文案 + 重试按钮 + 可选错误小字,符合 liquid glass 设计系统(蓝 #007AFF chrome)。

## 合并顺序(依赖序,红则停)

1. ws-1(egn 层基础:amap-api 超时契约)
2. ws-2(hook 层:消费「失败可到达」,产出 mountError/retryMount)
3. ws-3(UI 层:消费 mountError/retryMount)
4. ws-4(viewport 层:独立,最后)

## 通用门禁(每 WS)

- `cd server && npm test` 全绿(基线 978 pass / 2 skip,2026-08-22)
- `cd server && npm run typecheck` 通过
- `make docs-check` 通过(波及文档契约时,按各 prompt 授权范围回填)
- `git diff --check` 无空白错误
- 小步 Conventional Commits(每文件一组);不 merge、不 push、不碰主树
