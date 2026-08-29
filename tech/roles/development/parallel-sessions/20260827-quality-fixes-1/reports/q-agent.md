# q-agent 汇报(2026-08-27)

## 实际改动
- `server/src/app/api/agent/chat/route.ts` + `server/src/lib/agent/public-sse.ts` → 在网络 `ReadableStream` 入队前执行显式 SSE allowlist，仅允许 `delta`/`tool`/`action`/`done`/`error`；`reasoning` 与未知事件被丢弃。
- `server/src/lib/agent/run-agent.ts` + `server/src/lib/agent/types.ts` → 明确 `reasoning` 仍作为服务端内部事件保留；`onTurnReasoning` 的全文继续用于 provider `tool_calls` replay，不经过公开 SSE。
- `server/src/lib/map-engine/zoom.ts` → 新增项目/引擎共同缩放范围 `[3, 20]` 与 finite 校验/钳制纯函数，最大值复用现有 `lod.MAX_ZOOM`。
- `server/src/lib/agent/action-schema.ts` → `flyTo.zoom` 非 finite 拒绝，有限极端/负值规范化到 `[3,20]`。
- `server/src/lib/agent-map-bridge.ts` + `server/src/components/agent-map-executor.ts` → bridge 实际触碰地图引擎前再次钳制；客户端动作校验同步共享同一 zoom 规则，缺省 zoom 仍保持当前视角。
- `server/tests/agent-route-contract.test.mjs` → 回归 reasoning 不出网、五类合法事件仍可过滤转述，并锁定 route 在 `send` 前调用 allowlist。
- `server/tests/agent-types.test.mjs`、`server/tests/agent-map-executor.test.mjs`、`server/tests/agent-bridge-contract.test.mjs` → 覆盖 zoom 的 `-1/0/3/20/21/1e6`、NaN/Infinity、缺省值及 bridge 实际调用边界。
- `tech/24-agent-feature.md` → 更新 Agent 事件协议、reasoning 内部边界、SSE allowlist 与 flyTo zoom `[3,20]` 契约；未修改全局 `agent.md`、里程碑或 UI 代码/设计。

## 复验证据
- #2：`route.ts` 原有 `SSE_EVENT_TYPES` 未被使用；现改由 `filterPublicSseEvent(event)` 在网络发送边界执行，`reasoning` 返回 `null`。run-agent 的 `onTurnReasoning`/assistant `reasoning_content` replay 路径保留。
- #18：项目现有 `server/src/lib/lod.ts` 的最大 zoom 为 20，AMap 集成契约为 `zooms: [3, 20]`；新增共享 helper 采用共同范围 `[3,20]`，schema 与 bridge 双层钳制。

## 门禁结果
- `cd server && npm test`: **1692 测试，1689 通过 / 0 失败 / 3 跳过**。
- `cd server && npm run typecheck`: 通过。
- `make docs-check`: 通过。
- `git diff --check`: 通过。
- 最终 `git status --short`: 干净。

## 遇到的问题
- 初次新增 bridge 回归测试时误删了测试 fixture 的 `makeView`，首次全量测试及时捕获并修正；最终门禁无残留失败。
- 曾尝试用 `npm exec` 运行单文件聚焦测试，npm 提示缺少 `node@26.8.1`；未修改仓库依赖/锁文件，后续均使用项目既有 `npm test` 完成验证。
- 无需 boss 裁决。

## 证据
- 最终测试摘要：`tests 1692 / pass 1689 / fail 0 / skipped 3`。
- commit:
  - `dde8acc fix(q-agent): clamp agent flyTo zoom bounds`
  - `271af95 fix(q-agent): keep reasoning off public agent SSE`
  - `63bc8c9 docs(q-agent): document agent network and zoom bounds`

门禁: PASSED
结论: OK
