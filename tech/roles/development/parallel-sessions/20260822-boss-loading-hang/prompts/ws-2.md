# WS-2 fix/mount-retry —— 引擎挂载失败错误态 + 重试状态机

## 背景(boss 已定位)

BUG:首次进入卡死 "Loading map..."(`mapReady` 恒 false),刷新即好。根因 C1+C3:
`server/src/hooks/use-map-engine.ts:255-368` 的挂载 effect 只跑一次;
`mountEngineView` 失败/挂起 → `.catch` 仅 `console.warn`(:347-364),**无错误态、无重试**,
`engineView` 恒 null → `mapReady` 恒 false → 永卡无出口。ws-1(并行)正在给 `loadAMap()` 加
超时 reject(失败可到达 catch),本 WS 消费该语义并暴露错误出口。

## 任务(worktree: /Users/acccan/dm-wt-load-hook,分支 fix/mount-retry)

修改文件:**仅** `server/src/hooks/use-map-engine.ts` +(如需)`server/src/lib/map-engine/mount.ts` +
`server/tests/map-engine-mount.test.mjs` + `server/tests/hooks-contracts.test.mjs`。

### 契约(与 ws-3 钉死;现有返回签名不变)

`useMapEngine()` 返回追加两个字段:
- `mountError: { engine: string; code?: string; message: string } | null`
  —— 挂载链(含内部引擎回退、watchdog)全部失败后非 null;**重新开始挂载时立即清 null**。
- `retryMount: () => void` —— 重新执行 resolveEngine → mountEngineView 完整挂载链;
  **挂载进行中/已有活 view 时 no-op**(幂等);成功后走现有 `.then` 落地路径
  (viewRef/setView/setEngine 不变)。

### 实现要点

1. **复用而非复制**:把现有挂载链(keepalive 接管分支之外:`resolveEngine` →
   `setEngine`/`setActiveSearchProvider` → `mountEngineView(...).then/.catch`)提取为
   可重入函数(如 `runMount(...)`),首挂载 effect 与 `retryMount` 共用;deps/取消语义
   (cancelled / viewRef 战位双保险)保持一致。首挂载 effect 的 deps 仍 `[containerRef]`。
2. **错误态**:catch 分支在 warn 之外 `setMountError({ engine: <本次尝试引擎 id>, code, message })`
   (code/guidance 从 err 上透传,取值见现有 `classified` 提取逻辑);**成功后
   (`.then` 落地)清 `setMountError(null)`**。
3. **Watchdog(双保险)**:`mountEngineView` 整体包 `withTimeout(25_000)`(项目内若已有
   withTimeout util 则复用;没有则新建局部小函数),超时 → 同样 enter 错误态
   (`setMountError({ engine: resolved.id, code: 'MOUNT_TIMEOUT', message: ... })`)。
   ws-1 后单引擎均有界,此 watchdog 防未来新增无界引擎/钻缝;watchdog 不得吞掉正常
   挂载成功路径(成功后 must clear timer)。
4. **StrictMode keepalive 链零改动**:`relinquishView` 交接、接管分支(:284-302)一刀不动;
   retryMount 与接管/竞态路径一致(viewRef 战位在 worker 里保持 — 接管后 viewRef.current 已
   非空,retryMount 自然 no-op)。
5. 现状行为差别的唯一允许处:失败不再只有 warn,而是 warn + 错误态。

### 测试

- `server/tests/map-engine-mount.test.mjs` 或现有 use-map-engine 相关测试追加:
  - 挂载全部失败 → 返回 mountError 非 null(engine/code 正确);
  - 失败后调 retryMount(模拟下一次成功)→ mountError 清 null、view 落地;
  - retryMount 在已有 view 时 no-op(不重复创建);
  - (可模拟)watchdog 超时 → mountError.code === 'MOUNT_TIMEOUT'。
- `server/tests/hooks-contracts.test.mjs`:若断言 useMapEngine 返回 shape,只做**增量**
  更新(4 旧字段 + 2 新字段),旧断言不得放宽。

## 不做(边界)

- 不碰 `map-shell.tsx`(ws-3 消费) / `amap-api.ts`(ws-1) / `viewport-search.ts`(ws-4)。
- 不新增全局 toast/alert 基建(项目已核查无此基建;错误态消费归 ws-3 UI)。
- 不碰 tech/ 文档;不 merge、不 push、不碰主树。

## 门禁(worktree 内;cd server 运行)

- `npm test` 全绿(基线 978 pass / 2 skip)
- `npm run typecheck` 通过
- `make docs-check` 通过
- `git diff --check` 通过
- Conventional Commits(如 `fix(map-engine): 挂载失败暴露 mountError + retryMount 重试`),小步提交

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang/reports/ws-2.md`:
实际改动摘要、契约字段最终形态、门禁结果(四项逐条)、遇到的问题、测试前后计数。
**末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
