# ws-d 汇报(2026-08-21)

## 实际改动

分支 `feature/agent-docs`(worktree `/Users/acccan/dm-wt-agent-d`,自 dev `f1dc329` 切出),3 个 commit:

- `2bc3f8c docs(agent)` — **新建 `tech/24-agent-feature.md`**(421 行,主交付物)。按 tech/18/22 惯例:文档版本/创建日期/状态元信息块 + 编号章节 + 权威决策记录节 + ASCII 布局图。含全部 12 节:背景与动机(CC/CD 代理权框架)/ D1–D5 用户拍板决策 / 架构总览(模块图 + 三注册表)/ 事件协议(`AgentEvent` 5 种事件 + `AgentAction` 6 种动作 payload + `validateAction` 校验边界表)/ 三平台接入表(端点/鉴权/env、工具名前缀、降级优先级)/ prompt 防护与权限边界(sanitizeToolText 3000、maxTurns 8、限流五层)/ API 契约(SSE 响应、错误码表、AbortController 停止链路)/ 环境变量表 / 前端设计(悬浮球 44px 初始 bottom:179px/right:12px、面板 360px×70vh、布局图、移动端、i18n 键清单、map-shell seam 豁免说明)/ 测试清单 / 8 条验收场景 / 已知缺口(deferred-notes #1–#7)。全文以「规划/将实现」措辞,未写成已实现。
- `a1649a2 docs(agent)` — `tech/03-plugin-system.md` 第 78 行:ai-assistant 状态 `Deferred | Controlled map-action protocol required` → `In progress | 受控地图动作协议已落地,见 tech/24-agent-feature`(仅此 1 行)。
- `ad2b73e chore(agent)` — `server/.env.example` 尾部追加 AI Agent 段(与 tech/24 §8 一致):`AGENT_LLM_BASE_URL`/`AGENT_LLM_API_KEY`/`AGENT_LLM_MODEL`/`AGENT_MAX_TOOL_TURNS`/`AGENT_HISTORY_LIMIT`/`BAIDU_MAP_AUTH_TOKEN` 6 个可选变量 + 注释(回退链与百度 SK 申请地址)。

一致性自检:tech/24 中的模块路径、环境变量名、事件/动作类型、端点 URL、校验边界、错误码与 ws-a/b/c prompt 逐项核对一致。

## 门禁结果

- `make docs-check`:通过(无 stale 引用模式)
- `git diff --check`:通过(无空白错误)
- npm test / typecheck:本 WS 纯文档,无代码变更,未跑(门禁定义仅含 docs-check + git diff --check)

## 遇到的问题

- **测试文件计数口径**:boss prompt 写「测试清单(7 个文件)」,实际按 ws-a/b/c prompt 统计为 **9 个新测试文件 + 1 处追加**(后端核心 7 = ws-a 5 + ws-b 2;前端 2 = ws-c 的 agent-chat-client + agent-map-executor;另 component-contracts.test.mjs 追加断言)。tech/24 §10 已按实际口径列全表,并注明「后端核心 7」对齐原口径。
- **tech/README.md 索引未含 tech/24**:README 索引表止于 22(23 由在飞批次拥有)。tech/README.md 不在本 WS 文件边界(「不碰其他任何 tech/ 文件」),未改;建议 boss 安排(可随 merger 或后续 doc 批次)补一行 `24-agent-feature.md` 索引。
- 无其他问题;tech/03 目标行与 .env.example 尾部均与预期一致,干净追加无冲突。

## 证据

- `git log --oneline -4` → 3 个新 commit 在 `f1dc329`(dev head)之上,工作树干净
- `make docs-check` 输出:`Documentation policy check passed.`
- `git diff --check` 无输出(通过)

## follow-up:tech/README 索引已补录

- boss 追派 mini 任务,新增 commit `889ea00 docs(agent): tech/README 索引补录 24-agent-feature`(分支 `feature/agent-docs` 之上,1 文件 1 行)。
- `tech/README.md` 索引表 `22-hangzhou-poi-local.md` 行之后补入:`| [24-agent-feature.md](24-agent-feature.md) | AI Agent 功能(自建引擎/三平台 MCP/动作协议/悬浮球) | 前端/后端 |`(描述与 tech/24 内容一致)。
- 快速导航节未补:该节为「我想…」精选清单,现无 AI Agent 类目,不属「明显应含 24」,按最小改动原则跳过。
- 门禁:`make docs-check` 通过(`Documentation policy check passed.`)、`git diff --check` 通过。
- 上一轮「遇到的问题」中 README 索引缺 24 的遗留项已由此 commit 关闭。

门禁: PASSED
结论: OK
