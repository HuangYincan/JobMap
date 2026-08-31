# ws-4 汇报(2026-08-22)

WS: fix/first-load-bounded —— 首访全量加载有界化(逐页超时 + 失败跳过)
worktree: /Users/acccan/dm-wt-load-data,分支 fix/first-load-bounded(2 commits)

## 实际改动

### server/src/lib/viewport-search.ts
- **新增常量**(`WORK_FULL_LOAD_MAX_PAGES` 之后):
  - `WORK_VIEWPORT_PAGE_TIMEOUT_MS = 10_000`(单页请求超时,任务建议 10s)
  - `WORK_VIEWPORT_MAX_CONSECUTIVE_FAILURES = 3`(连续失败止损阈值,任务建议 3)
- **局部不导出 helper `withTimeout`**(`loadWorkViewport` 上方):与 amap-api.ts:327 同构
  (超时以 error 形态 settle,成功/失败均 `clearTimeout`)。**不复用 amap-api 的原因**:
  amap-api.ts 顶层使用本模块导出的 `AMAP_QPS`(约 L305),反向 import 会形成
  `viewport-search → amap-api → viewport-search` 循环依赖并触发 TDZ——按 prompt 兜底
  「在文件内建不导出的局部 helper」。
- `LoadWorkViewportOptions` 新增可选字段 `pageTimeoutMs`(仅测试注入用,缺省走常量)。
  **返回结构/签名/导出契约零变化**,map-shell 零适配。
- `loadWorkViewport` 循环有界化:
  - 每页 fetch 包 `withTimeout(pageTimeoutMs)`;超时/失败 → `console.warn`(页码 + 原因 +
    连续失败计数,每失败页恰好 1 次,不刷屏)后跳过该页 `continue`;
  - 连续失败 ≥ 3 → 汇总 warn(`stopped after N consecutive failures … returning M pois`)
    一次并 `break` 提前止损——10k 页全卡(服务端故障)时只打 3+1 条日志,不空转;
  - 成功页照常 `mergePoisById` 增量合并(by poi.id 语义不动)、`onBatch` 回调、短页/空页/
    total 三个 break 判定全部原样保留;
  - 失败页一律**不置 `noMore`/`vacant`**(「错误 ≠ 没有更多」),由已有部分目录 +
    mapReady 后的视口加载增量语义自然补齐,未引入新刷新机制;
  - mode-cache / use-mode-cache-restore 语义未动(缓存短路是既有设计)。

### server/tests/viewport-search.test.mjs
- **重写 1 个旧用例**:「失败抛错上抛,不置 noMore」→「失败页跳过不置 noMore」。
  旧契约(任一页失败整体 reject)= C2 挂死根源本身,与新语义直接冲突;新用例断言:
  失败页跳过 + 后续页照常并入 + noMore/vacant 均 false + warn 恰 1 次含页码。
- **新增 3 个用例**:
  1. 单页超时(page 1 永不 settle 的 fetch + `pageTimeoutMs: 20`)→ 循环继续取 2/3 页,
     返回其余页合并结果,`noMore=false`,warn 恰 1 次且含 `timed out after 20ms`;
  2. 连续失败达阈值(第 1 页成功 + 3 页连败)→ 止损只请求 4 页,返回已取部分,
     warn = 3 次单页 + 1 次汇总(共 4 次),`noMore=false`;
  3. 全部页快速成功 → 页数/合并顺序/零 warn 与现状等价(无行为漂移断言)。

## 门禁结果

| 门禁 | 结果 |
| --- | --- |
| npm test(全量) | **通过**:1432 tests / 1430 pass / 2 skip / 0 fail(退出码 0) |
| npm run typecheck | **通过**:tsc --noEmit 退出码 0,无错误 |
| make docs-check | **通过**:Documentation policy check passed |
| git diff --check | **通过**:无 whitespace 错误 |

## 遇到的问题

1. **prompt 提到的 tencent-engine.ts 在本 worktree 不存在**;唯一现有 `withTimeout` 在
   `amap-api.ts:327`,但 amap-api 反向依赖 viewport-search(顶层用 `AMAP_QPS`),
   import 会成环 → 按 prompt 兜底,在 viewport-search.ts 内建局部不导出版本。
2. **prompt 基线「978 pass / 2 skip」与 worktree 实际不符**:实际基线(改动前)为
   1429 tests / 1427 pass / 2 skip(dev 已含 auth-recovery 等新增特性)。以实际为准。
3. 旧用例「失败抛错上抛」与新语义直接冲突(旧契约即 bug),按任务要求重写为跳过语义。

## 证据

- 最终全量测试摘要:`ℹ tests 1432 / ℹ pass 1430 / ℹ fail 0 / ℹ skipped 2`(exit 0)
- 相关用例全部 ✔:
  - `loadWorkViewport: 失败页跳过不置 noMore(错误 ≠ 没有更多,first-load-bounded)`
  - `loadWorkViewport: 单页超时跳过,循环继续,返回其余页合并结果(warn 1 次)`(22.3ms,真实超时路径)
  - `loadWorkViewport: 连续失败达阈值提前止损,返回已取部分(warn 汇总)`
  - `loadWorkViewport: 全部页快速成功与现状等价(无行为漂移)`
- commits(fix/first-load-bounded):
  - `568de82 fix(viewport): 首访全量加载逐页超时 + 失败跳过(连续失败止损)`(70+/5-)
  - `5b25f28 test(viewport): 单页超时跳过/连续失败止损/无漂移回归用例`(145+/6-)
- 仅动 2 个「拥有」文件;未 merge、未 push;`git status` 干净。

门禁: PASSED
结论: OK
