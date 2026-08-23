# ws-2 汇报(2026-08-22)

WS: fix/mount-retry(worktree `/Users/acccan/dm-wt-load-hook`,分支 `fix/mount-retry`,基于 `15eafb1`)
任务:引擎挂载失败错误态 + 重试状态机 —— 消费 ws-1 的超时语义,暴露挂载失败出口。

## 实际改动

- `server/src/lib/map-engine/mount.ts`(commit 63186b4)
  - 回退链全部失败时,上抛的最终错误补 `engineId`(最后一个尝试引擎;`??=` 不覆盖、分类属性 code/stage/guidance 原样保留、不重包装)。
- `server/src/hooks/use-map-engine.ts`(commit c212790)
  - 新增 `MapMountError` 接口(`engine: string` / `code?: string` / `message: string`);
  - `UseMapEngineResult` 追加 `mountError` + `retryMount`(4 旧字段不变);
  - 挂载链提取为 `runMount`(useCallback):resolveEngine → setEngine/setActiveSearchProvider → `withTimeout(mountEngineView(...), 25_000)` → .then 落地 / .catch 错误态;首挂载 effect 与 retryMount 共用,**首挂载 effect deps 仍 `[containerRef]`**;
  - 取消语义:`let cancelled` closure ref 化为挂载代际 `mountSeqRef`(每次 runMount 递增;`relinquishView`/卸载/watchdog 超时递增即作废在飞链 → mount.ts 经 isCancelled 观察,已建视图落地前销毁,不泄漏);`relinquishView` 仅新增 2 行(ref 递增 + running=false),keepalive 交接与接管分支(:284-302)逻辑零改动;
  - catch:warn(第一句,基线不变)→ 分类结构化输出 → 超时(`code==='MOUNT_TIMEOUT'`)作废在飞链 → `setMountError({ engine: err.engineId ?? resolved.id, code, message })`;
  - 清错误态三处:runMount 入口(重新开始挂载立即清)、.then 落地后、switchEngine 成功/回滚落地后(活 view 落地 ⇒ 无挂载错误,错误态诚实化);
  - `retryMount`(useCallback):`if (viewRef.current || mountRunningRef.current) return; runMount();` —— 已有活 view(含接管后 viewRef 战位)/挂载进行中 no-op,幂等;
  - 局部 `withTimeout`(与 amap-api 同款语义,超时错误带 `code='MOUNT_TIMEOUT'`;成功 must clearTimeout,不吞成功路径);`MOUNT_TIMEOUT_MS = 25_000`;
  - 引擎总线 `EngineBusValue` 同步携带 mountError/retryMount;`useMapEnginePanel` 兜底 `mountError: null, retryMount: noop`;
- `server/tests/map-engine-mount.test.mjs`(c212790):+7 测试 —— engineId 行为(全部失败 → 最终错误 engineId=最后一个失败引擎,message 原样)、错误态三字段、重试开始/成功落地清 null、retryMount 幂等(no-op 守卫 + runMount 两处调用)、watchdog(25_000/`'MOUNT_TIMEOUT'`/超时作废在飞链/clearTimeout)、deps 仍 `[containerRef]`;原 `isCancelled: () => cancelled` 断言适配为新代际写法;
- `server/tests/hooks-contracts.test.mjs`(c212790):原 `if (cancelled)` 竞态断言适配为 `if (seq !== mountSeqRef.current)`(未放宽);+1 增量契约测试(返回 4 旧字段 + 2 新字段、MapMountError 三字段、总线兜底)。

## 契约字段最终形态(与 ws-3 钉死)

```ts
export interface MapMountError {
  engine: string;   // 失败引擎 id(mount.ts 在最终错误上携带 engineId;watchdog 超时 = 偏好引擎 resolved.id)
  code?: string;    // 透传 err.code;watchdog 超时为 'MOUNT_TIMEOUT'
  message: string;  // err.message 原文
}
// UseMapEngineResult 追加:
mountError: MapMountError | null;  // 挂载链(含引擎回退、watchdog)全部失败后非 null;重新开始挂载时立即清 null
retryMount: () => void;            // 重新执行完整挂载链;挂载进行中/已有活 view 时 no-op(幂等)
```

行为要点:失败不再只有 warn(warn + mountError);成功落地/重试开始/切换落地均清 null(错误态 ⇔ 无活 view);watchdog 超时也进入错误态且作废在飞链(不泄漏已建视图)。

## 门禁结果(worktree 内)

- `npm test`(cd server):1436 tests / **1434 通过 / 2 skip / 0 失败**(基线 1429/1427+2skip → +7,全部新增通过)
- `npm run typecheck`:通过(tsc --noEmit,含 `useMapEnginePanel` 类型对齐)
- `make docs-check`:通过(Documentation policy check passed)
- `git diff --check`:通过(零 whitespace 错误)

## 遇到的问题

- 无阻塞问题。两处设计取舍(已在代码注释与提交信息记录):
  1. **watchdog 与后台链泄漏**:`withTimeout` 只保证调用方不永久 await;超时后 mount.ts 仍在后台跑。处理:超时 catch 里递增 `mountSeqRef` 作废在飞链——后台链恢复后 `isCancelled()` 为 true,已建视图在落地前 destroy、返回 null(单线程保证 catch 先于链恢复执行)。已建视图零泄漏。
  2. **switchEngine 成功但 mountError 残留**(挂载失败 → 用户改走切换且成功):切换落地路径补 `setMountError(null)`,错误态只表示「无活 view」。
- 既有测试适配 2 处(`cancelled` → 代际写法),均为等语义改写,旧断言未放宽。
- 注:prompt 门禁所述基线 978 pass 与实际不符(实际基线 1429 tests/1427 pass/2 skip),以实际计数为准。

## 证据

- 提交:`63186b4`(mount.ts engineId)、`c212790`(错误态+重试+watchdog+测试),工作树干净(`git status --short` 空);
- 新增测试输出摘要(全部 ✔):
  - `全部候选失败 → 最终错误携带 engineId(最后一个失败引擎;hook 错误态定位用)`
  - `hook:挂载链全部失败 → catch 进入错误态(mountError 非 null;engine/code/message)`
  - `hook:重新开始挂载(首挂载/retryMount)与 .then 落地 → mountError 清 null`
  - `hook:retryMount 幂等(已有活 view / 挂载进行中 → no-op),与首挂载共用 runMount`
  - `hook:watchdog —— mountEngineView 整体包 withTimeout(25_000),超时 code=MOUNT_TIMEOUT`
  - `hook:首挂载 effect deps 仍 [containerRef](提取 runMount 后不改变重挂载语义)`
  - `useMapEngine:返回契约增量(4 旧字段 + mountError/retryMount 2 新字段)`
- 未跑 Playwright(无 UI 改动;错误态 UI 消费归 ws-3,map-shell 不在本 WS 范围)。

门禁: PASSED
结论: OK
