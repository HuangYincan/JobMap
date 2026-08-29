# q-front 汇报(2026-08-27)

## 实际改动
- `server/src/hooks/use-search-state.ts` → 增加可选 `engineReady`，以 `mode === "domain" && engineReady ? engine?.id ?? null : null` 形成稳定 readiness/engine identity key；Domain query 在 view 就绪后重跑当前 query，work 服务端建议不因地图就绪重复请求；保留 200ms debounce、`cancelled` 守卫、定时器清理与 mode 隔离。
- `server/src/components/map-shell.tsx` → 将 `Boolean(engineView)` 作为 search readiness 传入，不改现有 UI 布局、视觉、文案或流程。
- `server/src/lib/viewport-search.ts` → `maxTier` 改为 `number | null`，用显式 undefined/null 判断；合法 `0` 写入 filters，undefined/null 不发送。
- `server/tests/search-state-regression.test.mjs` → 新增无 jsdom 的语义镜像与源码契约回归：先输入后 engine ready 得到建议、旧请求取消、mode 切换不串结果、debounce/readiness 接线。
- `server/tests/viewport-search.test.mjs` → 新增 tier 0 / undefined / null URL 契约测试。
- `server/tests/hooks-contracts.test.mjs`、`server/tests/component-contracts.test.mjs` → 更新 search readiness、稳定 key、取消守卫和 MapShell 接线断言。
- `tech/16-bug-fixes.md` → 仅追加搜索 readiness 与 viewport tier 0 的 bug 修复记录。
- 提交：`beedaef fix(q-front): retry domain suggestions after engine ready`；`b320ddf fix(q-front): preserve viewport tier zero`。

## 门禁结果
- `npm test`: 1690 通过 / 3 跳过 / 0 失败（共 1693）
- `typecheck`: 通过
- `docs-check`: 通过
- `git diff --check`: 通过

## 遇到的问题
- 无阻塞问题。当前仓库无 jsdom，search-state 回归按既有模式采用源码契约 + 异步取消/模式隔离语义镜像；实际 hook 的 readiness key、cleanup 和 API/引擎调用边界另由契约断言覆盖。
- StrictMode 风险处理：依赖只使用 query、mode 与稳定 primitive readiness key，不依赖引擎对象引用；ready 切换时旧请求先由 cleanup 取消，迟到结果不能落地。

## 证据
- 最终 `npm test` 输出：`tests 1693 / pass 1690 / fail 0 / skipped 3`。
- 回归用例：`domain query typed before engine ready is retried on stable readiness identity`、`query/mode changes cancel old suggestion requests and cannot cross-land results`、`fetchWorkViewportPage sends maxTier=0 and omits only undefined/null`。
- 逻辑修复未改变现有 UI 设计，因此未生成截图。

门禁: PASSED
结论: OK
