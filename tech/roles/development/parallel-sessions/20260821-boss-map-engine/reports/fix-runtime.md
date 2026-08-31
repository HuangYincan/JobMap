# fix-runtime 汇报(2026-08-21)

WS:腾讯引擎运行时两处崩溃修复(worktree `dm-wt-eng-fix2`,分支 `fix/map-engine-runtime-errors`,基 0052ed0 全新建,无遗留)

## 实际改动

### 修复 1:TencentView.addControl 崩溃(腾讯引擎)

- 文件:`server/src/lib/map-engine/tencent/tencent-engine.ts`(仅 addControl 方法)
- 改前(L232-235):`this.raw.addControl(new this.tmap.control.ScaleControl(...))` —— `this.tmap.control` 是 undefined(TMap GL 控件命名空间路径不对),直接抛。
- 改后:弹性双路径 `(this.tmap.control ?? this.tmap.Control)` + 存在性检查(`!ctrlNs?.ScaleControl` → `console.warn('[map-engine] TMap ScaleControl 不可用,比例尺降级')` + return,不向 raw map 加任何控件)。参考 baidu 引擎 L348-351 防御风格。map-shell 调用是 duck-type(`addControl?.('scale', {position, offset})`),返回 void → `if (!pending) return` 跳过,不崩。契约 `MapView.addControl?(kind: 'scale'): void` 不变。

### 修复 2:蓝点跨引擎崩溃(map-shell 两处 getCurrentPosition(view.raw))

- 文件:`server/src/components/map-shell.tsx`(仅新增 helper + 两处调用点 + 注释)
- 新增模块级 helper(组件外,`function MapShell` 前):
  `locateForMap(view: MapView): Promise<{ lng: number; lat: number } | null>` —— `view.engine.id === 'amap'` → 走 amap-api `getCurrentPosition(view.raw)`(蓝点+精度圈渲染,行为零改动);非 amap → 走 `view.engine.search.getCurrentPosition()`(引擎 search 纯定位,无蓝点渲染,deferred)。
- L592(createMap 挂载定位):`getCurrentPosition(view.raw).then(...)` → `locateForMap(view).then(...)`;字段引用 `const { lng, lat } = loc.position` → `const { lng, lat } = loc`。
- L1746(handleLocate):`getCurrentPosition(mapInstance.current.raw)` → `locateForMap(mapInstance.current)`;同上替换 `loc.position` → `loc`。
- `amap-api.ts` 一行未动(行为零改动,契约测试钉住)。`MapView` 类型已从 `@/lib/map-engine/types` 导入(L40),无需补 import。

### 修复 3:测试

- `server/tests/map-engine-tencent.test.mjs` 追加 2 条:
  - `addControl:control/Control 命名空间都缺失 → 不抛 + console.warn 降级(不向 raw map 加控件)`(`delete ns.control` 模拟无命名空间;断言 `doesNotThrow`、`raw.control === null`、warn 1 次且匹配 `/ScaleControl 不可用/`)。
  - `addControl:control 缺失但 Control 存在 → 双路径兜底正常创建控件`(断言走 `ns.Control.ScaleControl` + opts `{position: 'bottomRight'}`)。
  - 原有「control.ScaleControl 正常调用 + 未知 kind no-op」用例保持绿(双面 fixture 自带 `ns.control`,新实现兼容)。
- `server/tests/component-contracts.test.mjs`:原 L448 `assert.match(shell, /getCurrentPosition\(view\.raw\)/)` 被改动打破 → 替换为分派断言组:`function locateForMap(view: MapView)` 存在、`view.engine.id === "amap"`、`view.engine.search.getCurrentPosition()`、`getCurrentPosition(view.raw)` 全文件恰好 1 次(只在 helper 内)、两处调用点 `locateForMap(view)` / `locateForMap(mapInstance.current)`、`doesNotMatch getCurrentPosition(mapInstance.current.raw)`。该测试其余断言(三门控、handleLocate 原义、setCenter/setZoom)均不受影响,未动。

## 门禁结果

- npm test:978 通过(976 pass / 2 skip / 0 fail)——全量零漂移 + 新增 2 条
- typecheck:通过(tsc --noEmit 无输出)
- make docs-check:通过(Documentation policy check passed)
- git diff --check:通过(无空白错误)

## 遇到的问题

- component-contracts.test.mjs L448 现有断言 `getCurrentPosition(view.raw)` 会被修复 2 打破 → 属预期契约更新(该断言本身就是「挂载定位走 amap-api」的旧语义),按新语义改写为分派断言组;文件在允许改动清单内,无越界。
- 无其他问题。amap-api.ts / baidu-engine.ts / amap-engine.ts / types.ts / engine-registry.ts / tech/ / server/docs/ / 数据文件零改动。

## 证据

- 改动文件仅 4 个:`tencent-engine.ts`(+12/-1)、`map-shell.tsx`(+35/-8)、`map-engine-tencent.test.mjs`(+35)、`component-contracts.test.mjs`(+16)。
- 修改后测试文件单跑:`node --test tests/map-engine-tencent.test.mjs tests/component-contracts.test.mjs` → 78 pass / 0 fail。
- 全量:`npm test` → tests 978, pass 976, fail 0, skipped 2, duration 5.6s。
- typecheck / docs-check / diff --check 输出见上。

## commit 列表(worktree 分支 fix/map-engine-runtime-errors)

1. `bd4b3b2 fix(tencent-engine): addControl 双路径兜底——control/Control 缺失时降级 warn 不抛`(tencent-engine.ts + map-engine-tencent.test.mjs)
2. `7eee9f8 fix(map-shell): 蓝点定位按引擎分派——非 amap 走引擎 search 纯定位`(map-shell.tsx + component-contracts.test.mjs)

未 merge 回 dev、未 push;worktree/分支留原地。

门禁: PASSED
结论: OK
