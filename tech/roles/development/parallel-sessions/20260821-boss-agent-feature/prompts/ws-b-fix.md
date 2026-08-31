# WS-b-fix — MCP 端点校准(boss 派发,mini worker)

## 背景

ws-b 已合并,但 boss 冒烟实测校准发现 `mcp-endpoints.ts` 中**高德端点错误**:`https://mcp.amap.com/sse?key=` 实测 404;正确端点为 **`https://mcp.amap.com/mcp?key=<key>`(Streamable HTTP,POST initialize 返回 200,protocolVersion 2025-03-26)**。腾讯(`https://mcp.map.qq.com/sse?key=&format=0`,legacy SSE,GET 开流 200)与百度(`https://mcp.map.baidu.com/mcp?ak=`,Streamable,200)已验证正确,不动。

worktree: `/Users/acccan/dm-wt-agent-fix`(分支 `feature/agent-mcp-calibration`,已从 dev `708fc1a` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-b-fix.md`

## 任务

1. 改 `/Users/acccan/dm-wt-agent-fix/server/src/lib/agent/mcp-endpoints.ts`:amap 的 URL 改为 `https://mcp.amap.com/mcp?key=<key>`,transport 改为 `'streamable'`(保持 query auth;注释注明实测校准日期与协议版本 2025-03-26)。
2. 检查 `/Users/acccan/dm-wt-agent-fix/server/src/lib/agent/mcp-providers.ts` 的 **protocolVersion 容忍度**:客户端发送 `2025-06-18`,服务器可能返回 `2025-03-26`(高德实测)——客户端必须接受任意服务器版本(不因版本不匹配而失败);若当前实现硬校验版本,放宽为「记录但继续」。
3. 测试:在 `/Users/acccan/dm-wt-agent-fix/server/tests/agent-mcp.test.mjs` 追加/调整断言:amap endpoint 含 `/mcp?key=` 且 transport='streamable'(读 mcp-endpoints.ts 或 getMcpProvider 归一化路径);版本不匹配场景(服务器回 2025-03-26,客户端不抛错)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-fix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-fix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent): amap MCP 端点校准 /mcp streamable + 协议版本容忍`);不 push/不切分支/不改其他文件。

## 回报

写 `reports/ws-b-fix.md`(改动摘要 + 版本容忍结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
