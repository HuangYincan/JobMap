# Workstream c-viewport-guard — 视口请求 epoch 代际校验 + 在飞取消

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-c-viewport-guard`,分支 `fix/viewport-epoch-guard`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(根因已由 Explore 确认)

1. **epoch 递增但从不消费**:use-work-viewport.ts:189 `viewportEpochRef.current += 1`(注释「主加载在飞的对旧视野追加批次将被 epoch 校验丢弃」),但 onBatch(:208)只做 `if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return;` —— 不检查 epoch。快速拖动、切模式或切引擎时,旧请求仍可能后到并把新视野的 catalog 覆盖掉。
2. **dispose 不能取消在飞请求**:viewport-search.ts:562-604 `createViewportLoader` 返回 `{ schedule, dispose, pending }`(:541-548);`runPending`(:568-581)触发 `options.load()`;`dispose()`(:594-599)只 `disposed=true; clearTimeout; pending=false`,in-flight 的 load 照常完成,**其副作用(回调 → setCatalog/写 mode cache)仍会落地**。全库无 AbortController——取消只能走协作式 `signal?: { cancelled: boolean }`(loadWorkViewport 已支持,见 viewport-search.ts:279/:484/:512),但 loader 从不创建/传递 signal。
3. 现状语义(必须保留):空批次 :215 return(保留旧目录,catalogRef 不清);非空批次 :216-227 setCatalog + writeModeCache;防抖合并、in-flight 合并为一次补跑(现有测试 :641-687 固化)。

## 任务(仅本 WS 范围)

### 1. `server/src/lib/viewport-search.ts`

- `ViewportLoaderOptions.load` 签名改为接收**协作取消信号**:`load(signal?: { get cancelled(): boolean })`(或等价 `{ cancelled: boolean }` 可变对象;与 loadWorkViewport 现有 `signal?: { cancelled: boolean }` 形态对齐,读代码确认后选一致的形态)。
- loader 内部:`createViewportLoader` 持有一个可变的 cancellation 对象;`runPending` 调 `options.load(signal)`;`dispose()` 除现有清理外置 `signal.cancelled = true`;dispose 后 in-flight load 完成时不得触发任何后续行为(现有 disposed 检查保留,扩展覆盖「load 内回调落地」由调用方用 signal 自查——见下)。
- 语义要求:dispose() 后,在 fly 的 load 要么不执行副作用,要么其回调被调用方以 signal.cancelled 丢弃。loader 本身不额外改别的。

### 2. `server/src/hooks/use-work-viewport.ts`

- **epoch 代际校验**:load 开始(或 schedule 触发 load 时)捕获 `const epoch = viewportEpochRef.current`;onBatch 入口在 mode 守卫旁加 `if (epoch !== viewportEpochRef.current) return;`(丢弃过期世代——不 setCatalog、不写 mode cache)。空批次守卫(:215)保持在 epoch 校验之后。
- **signal 传递**:把 loader 传入的 signal 透传进实际请求——domain load 闭包(内部调用 fetchPOIsForMode 或等价,读代码确认)在调用回调/写状态前检查 `signal.cancelled`;work 路径 loadWorkViewport 已有 signal 支持,把 loader 的 signal 传下去。若 fetchPOIsForMode 的 domain 分支本来就有 signal 参数,直接透传;没有则闭包层检查即可(不得为透传而大改 poi-service 签名,除非一行内)。
- `onViewChange`/`dispose` 调用点(:244-254)不变;`viewportEpochRef` 递增点(:189)不变。

### 3. 测试

- `server/tests/viewport-search.test.mjs`(:641-687 loader 用例):新增① dispose 后在飞 load 完成、其回调不再落地(用可观测副作用断言);② signal.cancelled 语义(dispose → load 收到的 signal.cancelled===true;未 dispose 时 false);现有 39 项全保持。
- use-work-viewport 契约(遵循 hooks-contracts.test.mjs 现有源码契约风格):新增断言 onBatch 含 epoch 校验形态(`epoch !== viewportEpochRef.current` 之类)、load 捕获 epoch。
- `component-contracts.test.mjs` :489-518(空批次三态保留目录)与既有契约全保持。

## 文件边界

**拥有**:server/src/lib/viewport-search.ts、server/src/hooks/use-work-viewport.ts、tests/{viewport-search,hooks-contracts,component-contracts}.test.mjs。

**不碰**:server/src/lib/poi-service.ts(除非一行内 signal 透传且确有必要;否则闭包层检查)、server/src/components/map-shell.tsx、server/src/lib/map-markers.ts、server/src/hooks/use-poi-map.ts、server/src/lib/search.ts、server/src/app/api/**、map-engine/**。

## 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-c-viewport-guard/server && npm test
cd /Users/acccan/dm-wt-c-viewport-guard/server && npm run typecheck
cd /Users/acccan/dm-wt-c-viewport-guard && make docs-check && git diff --check
```

## 提交

小步高频,Conventional Commits(`fix(viewport): epoch guard in onBatch`、`fix(viewport): loader dispose cancels in-flight`、`test(viewport): epoch/signal cases`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-poi-marker-resilience/reports/c-viewport-guard.md`,含改动摘要、门禁结果、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
