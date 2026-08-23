# WS-4 fix/first-load-bounded —— 首访全量加载有界化(逐页超时 + 跳过)

## 背景(boss 已定位)

BUG 第二来源 C2:首次进入(无 sessionStorage 缓存)走 `loadWorkViewport` **串行、无超时、
上限 10000 页**循环(`server/src/lib/viewport-search.ts` 约 L427-474,
`WORK_FULL_LOAD_MAX_PAGES = 10_000` 约 L290):每页 `await fetchWorkViewportPage` 无
withTimeout → 任一页请求挂起(服务端冷启动/公网抖动),首访即永远停在列表「加载」;
刷新后走 `useModeCacheRestore`(mode-cache sessionStorage)短路,零请求秒进 —— 与
「必现 + 刷新即好」叠加放大。本 WS 把该循环**有界化**:任何单页失败都不再拖死整体。

## 任务(worktree: /Users/acccan/dm-wt-load-data,分支 fix/first-load-bounded)

修改文件:**仅** `server/src/lib/viewport-search.ts` + `server/tests/viewport-search.test.mjs`。

1. **逐页超时**:`loadWorkViewport` 循环内每页 fetch 包 `withTimeout(PAGE_TIMEOUT_MS)`(建议
   10_000;项目若已有 withTimeout util(如在 tencent-engine.ts:265 附近)复用,没有则
   在文件内建一个不导出的局部 helper;值抽成命名常量,不要裸数字)。
2. **失败页跳过不中断**:某页超时/失败 → `console.warn`(页码 + 原因,一次性,不刷屏;
   可用「连续失败 ≥ N(建议 3)止损并 warn 汇总」防 10k 页全卡时日志洪泛)+ 跳过该页继续;
   已取页**照常增量合并**(现语义 merge by poi.id 不动);循环结束返回已合并结果。
   **返回结构/签名、导出契约零变化**(调用方 map-shell 不做任何适配)。
3. 不清空/不篡改现有目录:失败页缺失由「已有部分目录 + mapReady 后的视口加载
   (loadWorkViewport 增量语义)自然补齐」——不引入新刷新机制。
4. 不改 `use-mode-cache-restore.ts` / mode-cache 语义(缓存短路是既有设计,保留)。

### 测试(`server/tests/viewport-search.test.mjs`)

- 现有用例保持绿;
- 新增:单页超时 → 循环继续、最终返回其余页合并结果(warn 1 次);
- 新增:连续失败达阈值 → 提前止损返回已取部分(warn 汇总);
- 新增:全部页快速成功 → 与现状等价(无行为漂移断言,如页数/合并顺序)。

## 不做(边界)

- 不碰 `map-shell.tsx` / `use-map-engine.ts` / `amap-api.ts` / `use-mode-cache-restore.ts` /
  `lib/mode-cache.ts` / tech/ 文档。
- 不并行化改造(视口加载已有增量机制;10k 页并行化是另一个优化,不属于本 bug)。
- 不 merge、不 push、不碰主树。

## 门禁(worktree 内;cd server 运行)

- `npm test` 全绿(基线 978 pass / 2 skip)
- `npm run typecheck` 通过
- `make docs-check` 通过
- `git diff --check` 通过
- Conventional Commits(如 `fix(viewport): 首访全量加载逐页超时 + 失败跳过`),小步提交

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang/reports/ws-4.md`:
实际改动摘要(常量值、helper 位置)、门禁结果(四项逐条)、遇到的问题、测试前后计数。
**末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
