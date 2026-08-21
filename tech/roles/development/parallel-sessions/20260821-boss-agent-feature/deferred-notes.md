# Deferred Notes — 20260821-boss-agent-feature

> boss 不自动处理、需用户后续决策/操作的事项。类型:UI设计 = 改现有 UI 设计(不派发);Env-only = 环境/密钥操作(不自动跑);其他 = 口径/外部依赖。

| # | 类型 | 内容 | 触发条件/操作指引 |
|---|---|---|---|
| 1 | Env-only | **百度 agentplan SK(BAIDU_MAP_AUTH_TOKEN)申请** | 在 https://lbs.baidu.com/apiconsole/agentplan 创建应用获取 SK,配入 `server/.env.local` 后,baidu-ai-map skill 工具组(`api.map.baidu.com/agent_plan/v1/{place,direction,geocoding,reverse_geocoding,weather}`,Bearer auth)自动注册。当前 SK 未配置,该组工具不注册 |
| 2 | Env-only | **AGENT_LLM_* 覆盖项** | agent 当前直接用已配置的 `LLM_API_KEY`/`LLM_MODEL`/`LLM_BASE_URL`。若想独立指向特定供应商(如 DeepSeek v4 flash:`AGENT_LLM_BASE_URL=https://api.deepseek.com/v1` + `AGENT_LLM_MODEL=deepseek-v4-flash` + `AGENT_LLM_API_KEY=sk-...`),加到 `server/.env.local` 即可,优先级 AGENT_LLM_* > LLM_* |
| 3 | ~~其他~~ 已完成 | **三平台 MCP 端点实测校准** | ✅ 2026-08-21 完成:高德 `mcp.amap.com/mcp?key=`(Streamable,协议 2025-03-26)/ 腾讯 `mcp.map.qq.com/sse?key=`(legacy SSE)/ 百度 `mcp.map.baidu.com/mcp?ak=`(Streamable)全部经真实 key 注册成功(amap 15 + tencent 15 + baidu 14 工具) |
| 4 | ~~其他~~ 已完成 | **@modelcontextprotocol/sdk 替换手写客户端** | ✅ 2026-08-21 完成:用户放行 `npm install` 后,ws-mcp-sdk 已用官方 SDK(Client + StreamableHTTPClientTransport + SSEClientTransport)替换手写客户端 |
| 5 | UI设计 | **Agent 设置 UI(Profile L2 存 DB)** | 登录用户自助配置 baseurl+apikey+model(key 加密存储)。v2 功能稳定后再议 |
| 6 | 其他 | **会话历史持久化** | v1 会话历史存前端 sessionStorage(cap 30 条),无服务端持久化。多用户/服务端记忆留后续 |
| 7 | 其他 | **company-context 等高级工具** | v1 工具集 = 三平台 MCP + REST geocode 兜底 + 项目数据(岗位/POI 查询)。「按选中公司上下文建议」等场景 v2 迭代加工具 |
| 8 | 其他 | **Playwright 悬浮球视觉验证** | 吸附/面板行为已有纯函数测试覆盖(computeBallSnap 32/32);视觉截图验证待浏览器空闲(其他会话占用)。用户可直接在 3005 体验 |
