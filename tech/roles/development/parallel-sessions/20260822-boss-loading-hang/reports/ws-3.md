# ws-3 汇报(2026-08-22)

分支 `fix/loading-error-ui`(worktree `/Users/acccan/dm-wt-load-ui`),基于 `15eafb1`(auth-recovery merge)全新开发,3 个 commit 已落地,未 merge 未 push。

## 实际改动

- `server/src/lib/i18n.ts` → 追加 3 个失败态 key(zh+en 双写,紧邻 `loading`):
  | key | zh | en |
  |---|---|---|
  | `mapLoadFailed` | 地图加载失败 | Map failed to load |
  | `mapLoadRetry` | 重试 | Retry |
  | `mapLoadRetrying` | 重试中… | Retrying… |
- `server/src/components/map-shell.tsx` →
  - 顶部追加 `MapMountApi` 类型(与 ws-2 钉死契约的超集:可选 `mountError` / `retryMount`)+ 模块级 `noopMapRetry` 占位;
  - `useMapEngine()` 解构追加 `mountError = null`(缺省容错)与 `retryMount = noopMapRetry`,并以 `as MapMountApi` 消费(详见「遇到的问题」);
  - 追加 `mapRetrying` state + `handleMountRetry`(点击置 pending 并调 `retryMount()`)+ effect(新失败落地时复位 pending);
  - 覆盖层三态:`mountError ?` 失败态(标题 16px/600/`var(--ink)`、胶囊重试按钮、`code · message` 错误小字)`: 加载中/配置缺失分支`——**加载中态渲染零改动**(容器 inline style、`"Loading map..."`、配置缺失文案逐字节未动)。
- `server/src/components/map-shell.module.css` → 追加 `.loadFailed`(column flex + gap 14px)、`.loadFailedTitle`、`.loadFailedRetry`(pill `border-radius: 999px`、`padding: 8px 20px`、14px、`color: var(--blue)`、背景 `color-mix(var(--blue) 12%)`、hover 20%、`:focus-visible` outline 2px `var(--blue)` + offset 2px、`:disabled` opacity 0.6)、`.loadFailedDetail`(12px `var(--muted)`、单行 ellipsis)。蓝色走 `--blue` token(light/dark 同值),未引入新组件库/dynamic。
- `server/tests/component-contracts.test.mjs` → 追加 1 个契约测试:`map loading overlay: 挂载失败态 + 重试按钮接线(ws-3 loading-error-ui)`(30 行断言:三态分支、重试接线、focus-visible/ellipsis CSS、i18n 双写)。

## 门禁结果

- `npm test`(server):**1428 通过 / 2 skip / 0 失败**(共 1430 tests;新增 1 个测试通过)
- `npm run typecheck`(server):通过
- `make docs-check`:通过(Documentation policy check passed)
- `git diff --check`:通过

## 遇到的问题

1. **ws-2 契约未并入本 worktree**(并行未完成,`use-map-engine.ts` 尚无 `mountError`/`retryMount`;全库 grep 确认)。处理:map-shell 以「可选属性交叠超集」消费(promise 契约类型 + 缺省 `mountError = null` / `retryMount = noopMapRetry`),当前与 ws-2 并入后两种签名均过 typecheck;并入后失败态与重试自动生效,ws-3 无需再改。merge 时若 ws-2 的 `UseMapEngineResult` 接口把两字段定义为必填,本分支的 `as MapMountApi` 断言依旧合法(超集方向不变)。
2. **门禁基线计数与 prompt 不符**:prompt 写「基线 978 pass / 2 skip」,仓库实际基线为 1428 pass / 2 skip(共 1430,2026-08-22 状态)。以实测为准,全绿无失败。
3. 视觉验证受限:本会话无浏览器/Playwright 工具,失败态仅经契约测试 + 逐行代码审查验证(布局图逐项对齐:16px/600 标题 → 胶囊按钮 → 12px 单行 ellipsis 错误小字);覆盖层为绝对定位全屏 flex,≤767px 天然适配,未加断点。

## 证据

- 测试摘要(完整输出已落盘):`ℹ tests 1430 / pass 1428 / fail 0 / skipped 2`,`✔ map loading overlay: 挂载失败态 + 重试按钮接线(ws-3 loading-error-ui) (0.881375ms)`
- commit:`3fbe759` i18n(3 key) → `40f8ada` fix(map-shell 失败态+重试) → `4ac6af5` test(契约断言);`git status` 干净,未碰 use-map-engine.ts / tech/ / 主树。

门禁: PASSED
结论: OK
