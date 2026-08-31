# ws-b-fix 汇报(2026-08-21)

## 实际改动

分支 `feature/agent-mcp-calibration`(worktree `/Users/acccan/dm-wt-agent-fix`,自 dev `708fc1a` 切出),2 个 commit:

- `5951e6c fix(agent): amap MCP 端点校准为 /mcp streamable(2026-08-21 实测);legacy SSE 用例改经 tencent`
  - `server/src/lib/agent/mcp-endpoints.ts` → amap URL `https://mcp.amap.com/sse` → **`https://mcp.amap.com/mcp`**,transport `'sse'` → **`'streamable'**;query auth 保持 `key=<key>`;getter 与文件头注释注明 2026-08-21 实测校准与协议版本 2025-03-26(旧 /sse 实测 404 弃用)。腾讯 / 百度端点未动。
  - `server/tests/agent-mcp.test.mjs` → 新增「amap 端点已校准」断言(`/mcp?key=` 前缀 + transport='streamable' + 不含 /sse,读 `MCP_ENDPOINTS.amap`);两条 legacy SSE 全流程用例由 **amap 改经 tencent**(原因见问题 2)。
- `80ec360 fix(agent): MCP 协议版本容忍——服务器回旧版本记录但继续,不因不匹配失败`
  - `server/src/lib/agent/mcp-providers.ts` → `doConnect` 捕获 initialize 响应的 `protocolVersion`,存入实例字段 `negotiatedProtocol`(dispose 时清空);与客户端版本(2025-06-18)不一致时 `console.warn("[mcp-agent] … accepting server version")`,**绝不因版本不匹配失败**(仅 404/405/400 换备选端点)。注释注明高德实测回 2025-03-26。原实现本无硬校验,本次把「记录但继续」显式化。
  - `server/tests/agent-mcp.test.mjs` → 新增「协议版本容忍」用例:服务器 initialize 回 `2025-03-26`,listTools/callTool 全流程不抛错、isReady=true。

## 门禁结果

- npm test:**852 通过 / 1 失败 / 2 skip**(855 total)。唯一失败 = `tests/component-contracts.test.mjs` **编译期 SyntaxError(Unexpected end of input,843 行)**,与本 WS 改动无关 —— 见「遇到的问题」。
- typecheck:`tsc --noEmit` 通过
- docs-check:通过
- git diff --check:通过(无空白错误)

## 遇到的问题

1. **dev tip `708fc1a` 自带红门禁(非本 WS 引入)**:`server/tests/component-contracts.test.mjs` 第 820 行 `assert.match(bridge, /view\.createCircle/);` 之后直接是 821 行下一个 `test(...)`,「map shell has the AgentBall seam (ws-c)」用例的收尾 `});` 在 `708fc1a`(fix/map-engine-env-inline 合并,冲突解决「保留双方契约用例」)中被吞掉,文件不闭合 → 整个测试文件 parse 失败。该文件在本 worktree 零改动(`git status` 干净、`git diff 2b661ed 708fc1a` 可复现)。**属 ws-c/合并者边界,未擅改**,需 boss 裁决补 `});`(一行修复)。
2. **端点校准连带**:两条 legacy SSE 用例原本把 amap mock 成 SSE 服务器(GET 开流)。amap 校准为 streamable 后客户端只 POST,mock 的 GET 分支永不触发 → `stream.push` 空指针 → ConnectFailure。已按真实拓扑改为**经 tencent 端点**(legacy SSE 仍被腾讯覆盖测试,语义不变)。另「streamable 握手」用例断言首个 initialize `id===1`(模块级 rpcSeq 假设)——新增用例会推进 rpcSeq,故新用例统一追加在文件末尾,既有断言零改动。
3. **文档漂移(未改,纪律外)**:`tech/24-agent-feature.md:155` 仍写 amap 为 `https://mcp.amap.com/sse?key=<key>` sse。docs-check 只查格式不查内容,故通过;内容需 boss 安排同步为 /mcp streamable。

## 证据

- 测试输出(全量,`npm --prefix server test`):`ℹ tests 855 / ℹ pass 852 / ℹ fail 1 / ℹ skipped 2`,`✖ tests/component-contracts.test.mjs` 唯一失败;
- 新用例:✔ `amap 端点已校准:Streamable HTTP /mcp?key=(实测替代已 404 的 /sse)`、✔ `协议版本容忍:服务器回 2025-03-26(高德实测)→ 客户端不抛错`;
- 失败详情:component-contracts.test.mjs:843 `SyntaxError: Unexpected end of input`;修复前 agent-mcp 三用例红(`id 4!==1`、`mcp(amap) connect failed: mcp.amap.com`),修复后全绿;
- 提交:`5951e6c`、`80ec360`(worktree 内,未 push、未 merge 回 dev)。

门禁: FAILED
结论: BLOCKED: dev 708fc1a 合并遗漏 component-contracts.test.mjs 的 `});`(ws-c 用例未闭合),npm test 在 dev tip 即红,需 boss 裁决修复后再合本分支
