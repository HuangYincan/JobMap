# Batch Manifest — 20260821-boss-agent-feature

## 目标

为 Domain Map 项目加入 **AI Agent 功能**:后端自建 OpenAI 兼容 agent 引擎(任意 baseurl+apikey 可配,如 DeepSeek v4 flash),接入三大地图平台(高德/腾讯/百度)的 **MCP Server** 与百度 **baidu-ai-map Skill**,按「key 是否已配置」动态注册工具、LLM 自主选择;严格 prompt 防护与权限收紧(agent 只有项目相关只读权限)。前端为**自动吸附边缘的悬浮球**(初始位置右下角地图控件上方),点击展开聊天面板。**v1 用户建议 + v2 agent 直接操作地图**(结构化动作 + 停止/撤销控制交接)一次交付。spec 编程,文档先行(tech/24),一切皆插件。

## 用户拍板决策(D1–D5,权威记录)

- **D1 引擎**:自建 OpenAI 兼容 agent 循环(chat/completions + function calling),不复用 Claude Agent SDK(用户对比后选择)。
- **D2 配置**:LLM/Agent 配置走 server .env(AGENT_LLM_BASE_URL/API_KEY/MODEL,回退 LLM_*;未配则优雅提示「AI 助手未配置」)。设置 UI 记 deferred。
- **D3 范围**:直接做 v2 —— agent 经 SSE 下发结构化动作(flyTo/select/addMarkers/drawCircle/openDetail/search),前端执行器逐条执行;用户可「停止」/「撤销」;动作白名单 + 参数校验 + 限流。v1 建议能力为地基保留。
- **D4 MCP/SKILLS**:接入 高德 `https://mcp.amap.com/sse?key=` / 腾讯 `https://mcp.map.qq.com/sse?key=&format=0` / 百度 `https://mcp.map.baidu.com/mcp?ak=`(Streamable)+ `/sse?ak=`(SSE);baidu-ai-map skill 端点(`api.map.baidu.com/agent_plan/v1/*`,`Authorization: Bearer $BAIDU_MAP_AUTH_TOKEN`)**env 门控**(SK 未配置 → 不注册,申请记 deferred)。工具名带 provider 前缀(amap__/tencent__/baidu__/rest__/builtin__),LLM 自主选择;MCP 连接失败 → 该 provider 本轮剔除;REST geocode 链常备兜底。
- **D5(boss 裁决)**:`npm install @modelcontextprotocol/sdk` 被会话权限 deny(settings.json deny `npm install*`)→ **手写零依赖 MCP 客户端**(Streamable HTTP + legacy SSE 双传输,JSON-RPC framing 共享,fetch 可注入,node:test mock 服务器测试)。官方 SDK 留 deferred(权限放开后可替换)。

## 前置(boss 已确认)

- dev HEAD `983b161`;map-engine 批次**轮1(core+backend)已并入 dev**:`server/src/lib/map-engine/{types,engine-registry,engine-preference,script-loader,coord-utils}.ts` 存在,`MapView` 门面接口已在 `types.ts`(无消费者);`site-geocode.ts` 加法已合(可 import)。
- map-engine **eng-c/d/e 在飞**(dm-wt-eng-c/d/e,拥有 map-shell.tsx、layers-panel.tsx、hooks/*、tech/23-map-engines.md)—— 红线。
- embodied-jobs 两 WS 已并入 dev;docs-maintenance 批次 worktrees 已清理(tech/01/03/06 应已合,ws-d 以 dev 实际状态为准)。
- `.env.local` 现有 key:AMAP_WEB_KEY、BAIDU_MAP_AK、TENCENT_MAP_KEY、LLM_API_KEY、LLM_MODEL、LLM_BASE_URL(均非空)。

## Workstreams

| ws | 主题 | 分支 | worktree | report | 拥有文件 |
|---|---|---|---|---|---|
| a | 后端 agent 核心引擎(循环/LLM 流式/防护/动作协议) | `feature/agent-backend-core` | `../dm-wt-agent-a` | `reports/ws-a.md` | `server/src/lib/agent/{types,action-schema,config,prompts,llm-provider,run-agent}.ts` + `server/tests/agent-{types,config,prompts,llm-provider,runner}.test.mjs` |
| b | 后端工具层:MCP 客户端 + 三平台接入 + baidu-ai-map + 项目工具 + /api/agent/chat route | `feature/agent-backend-tools` | `../dm-wt-agent-b` | `reports/ws-b.md` | `server/src/lib/agent/{mcp-endpoints,mcp-providers}.ts` + `server/src/lib/agent/tools/{builtin,rest-fallback,baidu-agent-plan}.ts` + `server/src/app/api/agent/chat/route.ts` + `server/tests/agent-{mcp,route-contract}.test.mjs` |
| c | 前端:悬浮球 + 聊天面板 + SSE 客户端 + 地图动作执行器 + map-shell seam | `feature/agent-frontend` | `../dm-wt-agent-c` | `reports/ws-c.md` | `server/src/components/agent-{ball,panel}.tsx(+module.css)` + `server/src/lib/agent-map-bridge.ts` + `server/src/components/agent-{chat-client,map-executor}.ts` + i18n 键 + map-shell seam(~30 行)+ 相关测试 |
| d | 文档:tech/24 spec + tech/03 状态行 + .env.example append | `feature/agent-docs` | `../dm-wt-agent-d` | `reports/ws-d.md` | `tech/24-agent-feature.md`(新)+ `tech/03-plugin-system.md`(仅 78 行 ai-assistant 状态)+ `server/.env.example`(仅 append AGENT_LLM_* 段) |

**不碰(红线)**:`server/src/lib/map-engine/**`(只读消费)、`site-geocode.ts`(只 import)、`map-shell.tsx`(仅 ws-c 的 seam 追加,其余逻辑不动)、`layers-panel.tsx`、`hooks/*`、`server/docs/environment-variables.md`、`tech/23-map-engines.md`、`server/src/lib/llm-validate.ts`、`types.ts`(不加 MapMode)。

## 合并顺序(依赖序,红则停)

**R1 已完成(2026-08-21):`feature/agent-backend-core`(ws-a)+ `feature/agent-docs`(ws-d)已并入 dev(9b4cd8f,815 tests/813 pass)。**
**R7 合并范围(本轮,并行):`feature/agent-trim-fix`**(工具结果 sanitize 落位 + 整轮历史裁剪 + 400 分类修正;冒烟插桩定位的 3 缺陷)+ **`feature/agent-snap-fix`**(悬浮球四向吸附 + 面板垂直锚定;用户反馈「中央松手不吸附」)。其余分支均已并入 dev。

## 门禁(每 WS、每轮合并)

- `cd server && npm test`(现有 568 全绿零漂移 + 新增测试)
- `cd server && npm run typecheck`
- 根 `make docs-check` + `git diff --check`

## 合并后(boss/merger)

全绿 → spawn merger 按序 `--no-ff` 合并 → `git push origin/dev`(门禁绿即自动)→ 抽验测试数/git log → 批次目录自身 commit 入库 → 最终总汇报(deferred-notes 清单)。
