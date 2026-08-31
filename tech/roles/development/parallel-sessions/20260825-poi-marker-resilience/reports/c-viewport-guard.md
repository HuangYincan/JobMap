# c-viewport-guard 汇报(2026-08-25)

分支 `fix/viewport-epoch-guard`(worktree `/Users/acccan/dm-wt-c-viewport-guard`,自 `3021da3` 切出)。
任务:视口请求 epoch 代际校验 + loader 协作取消信号(dispose 后在飞 load 的副作用不落地)。

## 实际改动

- `server/src/lib/viewport-search.ts` → `ViewportLoaderOptions.load` 签名改为
  `load: (signal: { cancelled: boolean }) => Promise<void> | void`(与 loadWorkViewport /
  fetchPOIsForMode 的 `signal?: { cancelled: boolean }` 同形态);`createViewportLoader`
  每实例持 `const cancelSignal = { cancelled: false }`,`runPending` 把同一对象传给
  `options.load(cancelSignal)`;`dispose()` 除原有 `disposed/timer/pending` 清理外置
  `cancelSignal.cancelled = true`。loader 本身不改其他行为(dispose 后 schedule 仍失效、
  pending 语义不变)。
- `server/src/hooks/use-work-viewport.ts` →
  - `load:` 闭包签名改 `load: async (signal) =>`;
  - domain 分支 `viewportEpochRef.current += 1` 后**立即捕获** `const epoch = viewportEpochRef.current`
    (必须取递增后的值——若取递增前,本批次会被自己的 +1 判为过期;注释说明);
  - onBatch 入口在 mode 守卫后加 `if (epoch !== viewportEpochRef.current) return;`
    (丢弃过期世代:不 setCatalog、不写 mode cache),随后 `if (signal?.cancelled) return;`
    (dispose 让路,兜底闭环 fetchLocalPois/fetchLocalPoisAll 不查 signal 的路径);
    空批次守卫(0 条 return 保留旧目录)保持在 epoch 校验之后,未动;
  - `fetchPOIsForMode({ ... signal, ... })` 透传 loader 信号(poi-service 已支持,零改动);
  - `await` 返回后 noMore 落地前同样加 `if (signal?.cancelled || epoch !== viewportEpochRef.current) return;`
    (旧世代结果不污染新刷新状态)。
  - `onViewChange`/dispose 调用点与 `viewportEpochRef` 递增点(:189)未动。
- `server/tests/viewport-search.test.mjs` → 新增 2 项(loader 现有 3 项用例全保持):
  ① dispose 后在飞 load 完成、回调不落地(调用方按 `signal.cancelled` 自查的副作用断言);
  ② signal 活性:未 dispose 时 false、dispose 后恒 true(含补跑仍收到同一信号对象)。
- `server/tests/hooks-contracts.test.mjs` → 新增源码契约测试(现有风格):
  epoch 捕获在 +1 之后、onBatch 含 `epoch !== viewportEpochRef.current` 校验且其索引先于
  `catalogRef.current = batch` 落地、signal 在 `fetchPOIsForMode` 选项中且位于 onBatch 之前、
  loader 侧 `cancelSignal` / `options.load(cancelSignal)` / dispose 置 cancelled。

## 门禁结果

- npm test(server): **1614 通过 / 0 失败 / 2 skip**(viewport-search 41 项含 2 新增,
  hooks-contracts 6 项含 1 新增;component-contracts 既有契约零改动全保持)
- typecheck(`tsc --noEmit`): 通过
- docs-check: 通过
- git diff --check: 通过(无空白错误)

## 遇到的问题

- **epoch 捕获时机与任务描述的措辞偏差**:prompt 说「load 开始(或 schedule 触发 load 时)捕获」,
  但 hook 里 `viewportEpochRef.current += 1` 发生在 domain 分支中段(fetch 之前);
  若在 load 开头捕获,本批次会被自己的 +1 判为过期而导致**所有批次都被丢弃**。
  实现为**在 +1 之后立即捕获**(语义即「本世代 = 本次刷新」,新刷新再 +1 自然作废旧世代),
  已在代码注释与 hooks 契约测试中固化(测试断言捕获点与 += 1 并存)。→ 无需 boss 裁决,
  请 merger 留意该语义取舍即可。
- 没有为 `loadWorkViewport` 做额外改动:它本已支持 signal;use-work-viewport 的 work 分支
  在 2026-08-20 修复后直接 return(work 全量加载后无视口请求),不存在「hook 内 work 路径
  传 signal」的调用点;map-shell.tsx 的主加载调用(1015 行)在「不碰」边界内,未动。
- poi-service.ts 零改动(未触碰,满足边界):domain 本地库路径 `fetchLocalPois`(:271)/
  `fetchLocalPoisAll`(:350)调用 onBatch 前不查 signal,由 hook 侧 onBatch 的
  `signal?.cancelled` 检查兜底闭环(fallback 路径 poi-service 自身已查)。

## 证据

- 测试输出摘要:全量 `npm test` 尾行 `tests 1614 / pass 1612 / fail 0 / skipped 2 / duration 13.7s`;
  新增用例逐条 ✔:
  `createViewportLoader: dispose 后在飞 load 完成的副作用不落地(signal 协作取消)`、
  `createViewportLoader: signal.cancelled 活性(未 dispose false → dispose true)`、
  `useWorkViewport: 视口世代 epoch 校验 + loader 协作取消信号(epoch-guard)`。
- 提交(3 个小步,均已验证测试在后):
  ```
  d0850f3 fix(viewport): loader dispose cancels in-flight via cooperative signal
  3eb57e0 fix(viewport): epoch guard in onBatch + loader signal pass-through
  bdc032d test(viewport): epoch/signal cases
  ```
- 工作树干净(仅 4 个拥有文件改动,component-contracts.test.mjs 未改)。

门禁: PASSED
结论: OK
