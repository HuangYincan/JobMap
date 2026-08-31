# WS-d — 文档:tech/24 Agent 功能规范(boss 派发,headless worker)

## 背景

AI Agent 功能批次 `20260821-boss-agent-feature`。你的任务是写**技术规范文档** `tech/24-agent-feature.md`(tech/23 已被在飞批次占用,编号 24),并做两处极小文档更新。spec 编程:文档先行,本文档是后续开发(ws-a/b/c)与用户验收的契约依据。

worktree: `/Users/acccan/dm-wt-agent-d`(分支 `feature/agent-docs`);汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-d.md`

## 任务

### 1. 新建 `tech/24-agent-feature.md`(主交付物)

按 tech/ 文档惯例(`tech/18-national-scale-plan.md` / `tech/22-hangzhou-poi-local.md` 的结构:文档版本/创建日期/状态元信息块、编号章节、决策记录节、ASCII 布局图)。内容必须包含:

1. **背景与动机**:为什么做(地图 + LLM 的智能建议;CC/CD 框架:代理权要赚取——v1 建议=高控制低代理,v2 地图操作=中代理+控制交接)。现状:项目已有 LLM 调用先例(llm-validate.ts)、三平台 key 全配、无任何 agent/MCP 代码。
2. **用户拍板决策(权威)**:D1 自建 OpenAI 兼容引擎(对比过 Claude Agent SDK,用户选自建);D2 配置走 server .env(AGENT_LLM_* 回退 LLM_*);D3 直接做 v2(结构化动作 + 停止/撤销);D4 三平台 MCP + baidu-ai-map skill(env 门控);D5 boss 裁决:手写零依赖 MCP 客户端(npm install 被权限 deny)。修改须经用户确认。
3. **架构总览**:后端 lib/agent 模块图(types/action-schema/config/prompts/llm-provider/run-agent/mcp-endpoints/mcp-providers/tools/*)+ route + 前端(ball/panel/chat-client/map-executor/map-bridge)。「一切皆插件」:MCP provider、工具、LLM 端点均注册表化。
4. **事件协议(完整定义)**:`AgentEvent` union(delta/tool/action/done/error)与 `AgentAction` 白名单 6 种动作的 payload schema + 校验边界(经纬度/radius/points 数/id/query 上限)。
5. **三平台接入表**:端点/鉴权/key 环境变量(高德 `https://mcp.amap.com/sse?key=`,腾讯 `https://mcp.map.qq.com/sse?key=&format=0`,百度 `https://mcp.map.baidu.com/mcp?ak=` Streamable + `/sse?ak=` SSE);baidu-ai-map skill(`api.map.baidu.com/agent_plan/v1/{place,direction,geocoding,reverse_geocoding,weather}`,`Authorization: Bearer $BAIDU_MAP_AUTH_TOKEN`);工具名前缀(amap__/tencent__/baidu__/rest__/builtin__);key 未配→不注册,MCP 连接失败→本轮剔除,REST geocode 链(geocodeAddressRest/placeTextSearchRest/regeoCityRest)常备兜底。
6. **prompt 防护与权限边界**(硬需求):系统提示结构(角色/边界/工具纪律/动作纪律/安全红线);工具结果=不可信数据处理(sanitizeToolText:截断 3000、剔 `<script`/超长 URL);白名单工具(无文件系统/任意 URL/DB 写);历史截断(maxHistoryChars 6000);动作参数服务端校验;secret 单点读取不进上下文/日志;限流(maxTurns 8、消息长度、SSE 输出 200KB、IP 令牌桶 10 req/min)。
7. **API 契约**:`POST /api/agent/chat` 请求体(messages/viewport/lang)与 SSE 响应;错误码(BODY_TOO_LARGE/BAD_MESSAGES/LLM_UNCONFIGURED/TOOL_ERROR);AbortController 停止链路。
8. **环境变量表**:新增 AGENT_LLM_BASE_URL/AGENT_LLM_API_KEY/AGENT_LLM_MODEL/AGENT_MAX_TOOL_TURNS/AGENT_HISTORY_LIMIT/BAIDU_MAP_AUTH_TOKEN(全部可选,回退链说明)。
9. **前端设计(含 ASCII 布局图)**:悬浮球 44px 圆钮(右下角 mapControls 上方初始位 bottom:179px/right:12px,拖拽吸附左右边缘,clamp 12px);聊天面板(360px×70vh liquid glass,贴吸附侧,消息列表+输入+停止/撤销+「正在做什么」状态条+建议卡片);移动端适配;i18n 键清单。布局图按项目设计系统(#007AFF、--soft-strong、玻璃只用于卡片类浮层)。
10. **测试清单**:ws-a/b/c 各自测试文件与测试点(7 个文件);门禁(npm test/typecheck/docs-check/git diff --check)。
11. **验收场景**(8 条,来自设计):流式建议、通勤圈 drawCircle、flyTo+撤销、悬浮球吸附、未配 LLM 提示、停止中断、注入攻击防护、三平台全挂降级。
12. **已知缺口与后续**(引用 deferred-notes 编号):百度 SK 申请、AGENT_LLM_* 覆盖、MCP 端点实测校准、SDK 替换、设置 UI、会话持久化、company-context 工具。

### 2. `tech/03-plugin-system.md` 状态行更新(仅 1 行)

找到 Current Registry 表中 `ai-assistant` 行(`Deferred | Controlled map-action protocol required`),改为:
`| ai-assistant | In progress | 受控地图动作协议已落地,见 tech/24-agent-feature |`
若找不到该行或文件结构已变,跳过并写入你的汇报「遇到的问题」。

### 3. `server/.env.example` append(仅文件尾部追加)

在文件末尾追加一段注释 + 可选变量(与 tech/24 §8 一致):
```bash
# --- AI Agent (2026-08-21, tech/24-agent-feature) ---
# 可选:覆盖默认 LLM(默认回退 LLM_API_KEY/LLM_MODEL/LLM_BASE_URL)
# AGENT_LLM_BASE_URL=https://api.deepseek.com/v1
# AGENT_LLM_API_KEY=sk-...
# AGENT_LLM_MODEL=deepseek-v4-flash
# AGENT_MAX_TOOL_TURNS=8
# AGENT_HISTORY_LIMIT=6000
# 百度 agentplan SK(未配置则 baidu-ai-map 工具组不注册;申请:https://lbs.baidu.com/apiconsole/agentplan)
# BAIDU_MAP_AUTH_TOKEN=sk-...
```
若文件尾部已被并发批次修改导致冲突无法干净追加,跳过并记入汇报。

## 文件边界

- **拥有**:`tech/24-agent-feature.md`(新)、`tech/03-plugin-system.md`(仅那 1 行)、`server/.env.example`(仅尾部追加)。
- **不碰**:其他任何 tech/ 文件(23-map-engines.md 在飞批次拥有)、`server/src/**`(ws-a/b/c 拥有)、`agent.md`。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-d && make docs-check && git diff --check
# 一致性自检:tech/24 中的文件路径/环境变量名/事件类型与本文档一致
```

## 纪律

- 文档必须反映可验证事实:描述为「规划/将实现」,不得写成已实现(dev 上 ws-a/b/c 尚未合并)。
- Conventional Commits(`docs(agent): ...`);不 push/不切分支。

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-d.md`(实现摘要 + 遇到的问题 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
