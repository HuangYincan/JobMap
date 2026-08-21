# WS-mcp-sdk — 官方 @modelcontextprotocol/sdk 替换手写 MCP 客户端(boss 派发,headless worker)

## 背景

AI Agent 功能批次 `20260821-boss-agent-feature`。此前因会话权限 deny `npm install*`,D5 裁决手写了零依赖 MCP 客户端(已合并、三家平台实测打通)。**用户现已放行 npm install** 并明确倾向官方实现(「官方的更好用,自己写的难免出 bug」)。本 WS:用官方 `@modelcontextprotocol/sdk` 重写 `mcp-providers.ts` 内部实现,**对外接口零变化**(下游 run-agent/tools/route 不改)。

依赖已由用户安装(`@modelcontextprotocol/sdk`),worktree 的 `server/node_modules` 是主仓库 symlink,直接可用。**若 import 失败 → 汇报 BLOCKED: 依赖未安装**(不要自己 npm install,权限仍 deny)。

worktree: `/Users/acccan/dm-wt-agent-sdk`(分支 `feature/agent-mcp-sdk`,boss 预建,从最新 dev 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-mcp-sdk.md`

## 任务

### 1. 重写 `/Users/acccan/dm-wt-agent-sdk/server/src/lib/agent/mcp-providers.ts`

- **保持导出契约不变**(先读现文件,逐条对照):`McpProviderHandle {id, isReady(), listTools(), callTool(origName, args)}`、`getMcpProvider(id)`(key 未配 → null)、`resetMcpProvidersForTest()`、`normalizeTool(provider, meta)`(纯函数,原样保留)。
- 内部实现换官方 SDK:`import { Client } from '@modelcontextprotocol/sdk/client/index.js'` + `StreamableHTTPClientTransport`(baidu/amap)+ `SSEClientTransport`(tencent legacy SSE,来自 `@modelcontextprotocol/sdk/client/sse.js`)。
- 端点维持 `mcp-endpoints.ts` 已校准值:amap `https://mcp.amap.com/mcp?key=` streamable;tencent `https://mcp.map.qq.com/sse?key=&format=0` legacy SSE;baidu `https://mcp.map.baidu.com/mcp?ak=` streamable。
- 保留现有语义:connect 超时(≤15s)、单例缓存、失败 → 本轮剔除且 dispose、下次请求重建、请求结束不 dispose(进程级保活)、3 并发信号量、**协议版本容忍**(amap 回 2025-03-26 不得失败)、错误信息不含 key。
- **组件源码审查(项目硬规则)**:写代码前先读 `node_modules/@modelcontextprotocol/sdk/dist/cjs/client/*` 关键源码(Client/transports),在汇报中记录审查结论(3-5 条:SDK 如何管理会话、SSE transport 的 pending 关联、超时行为、已知边界)。
- 删除手写 transport 实现代码(SDK 替代),但 `normalizeTool`、provider 标签、错误映射逻辑保留。

### 2. 测试更新 `/Users/acccan/dm-wt-agent-sdk/server/tests/agent-mcp.test.mjs`

- 优先用 SDK 自带的 `InMemoryTransport`(`@modelcontextprotocol/sdk/inMemory.js`)搭 mock 服务器端(实现 initialize/tools/list/tools/call 的 responder),测 Client 集成:listTools 归一化、callTool 错误映射、版本容忍(responder 回 2025-03-26)。
- 保留/适配:key 缺失 → null;provider 剔除逻辑;normalizeTool 矩阵(纯函数不动)。
- 若 InMemoryTransport 不可用,退回 mock transport 对象注入。

## 文件边界

- **拥有**:`server/src/lib/agent/mcp-providers.ts`、`server/tests/agent-mcp.test.mjs`。
- **不碰**:`mcp-endpoints.ts`(已校准)、`run-agent.ts`、`types.ts`、`tools/*`、`api/agent/chat/route.ts`、前端、`tech/**`、`package.json`(用户已装)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-sdk/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-sdk && make docs-check && git diff --check
```

## 纪律

小步 Conventional Commits(`refactor(agent): ...`);不 push/不切分支/npm install 禁止(依赖已装)。

## 回报

写 `reports/ws-mcp-sdk.md`:改动摘要、SDK 源码审查结论(3-5 条)、测试数与测试点、遇到的问题、门禁输出。**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
