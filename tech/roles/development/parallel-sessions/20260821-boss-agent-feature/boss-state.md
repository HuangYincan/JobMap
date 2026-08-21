# Boss State — agent-feature

## meta
- slug: 20260821-boss-agent-feature
- date: 2026-08-21
- batch_dir: tech/roles/development/parallel-sessions/20260821-boss-agent-feature
- goal: AI Agent 功能(v1 建议 + v2 地图操作,自建 OpenAI 兼容引擎,三平台 MCP + baidu-ai-map skill,悬浮球 UI,spec 编程 tech/24)
- owner: boss(自主)
- milestone_link: 无(main 不涉及,dev 目标)

## stage
current: MERGE(feature/agent-action-prompt 全绿,派 merger)
updated_at: 2026-08-21
dev_head_note: dev = bb4252a;afix 嵌入动作契约(973 pass,1 commit d591222);诊断插桩已还原,主树干净

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a-d/b-fix/mcp-sdk/enh/rfix/sfix | (R1-R6,共 9 WS) | (已清理) | prompts/*.md | reports/*.md | MERGED | - | 2026-08-21 | 2026-08-21 | 全部并入 dev |
| tfix | feature/agent-trim-fix | /Users/acccan/dm-wt-agent-tfix | prompts/ws-trimfix.md | reports/ws-trimfix.md | MERGED | ea54440 | 2026-08-21 | 2026-08-21 | 门禁 PASSED + 已并入 dev(R7, e39e69b) |
| nfix | feature/agent-snap-fix | /Users/acccan/dm-wt-agent-nfix | prompts/ws-nfix.md | reports/ws-nfix.md | MERGED | f8393e3 | 2026-08-21 | 2026-08-21 | 门禁 PASSED + 已并入 dev(R7, bb4252a) |
| afix | feature/agent-action-prompt | /Users/acccan/dm-wt-agent-afix | prompts/ws-afix.md | reports/ws-afix.md | DONE | d591222 | 2026-08-21 | 2026-08-21 | 门禁 PASSED(973 pass)+ 日志抽验一致;1 commit;待合并 |

## merge_order
已合:R1-R6 全部。
**R7 范围**(并行,无文件交集):`feature/agent-trim-fix`(sanitize 落位 + 整轮裁剪 + 分类正则)+ `feature/agent-snap-fix`(四向吸附 + 面板垂直锚定;用户反馈修复)。

## adjudication_log
| ts | ws | 问题 | 裁决 | 结果 |
|---|---|---|---|---|
| 2026-08-21 | - | R7 合并后冒烟:工具流全通(amap 配额超限 → 自动换 geocode 成功)但 0 个 action 事件 —— LLM 输出 flyTo 扁平 {lng,lat},validateAction 要求嵌套 center;prompts.ts 未给具体 payload 形状(「必须符合平台定义」但没定义) | 技术类,自动批:ws-afix 在 prompts.ts 嵌入完整动作契约(中英文,逐字对齐 action-schema.ts)+ prompt 内容测试;schema 保持严格,不改契约 | 已派发 |
| 2026-08-21 | - | 冒烟复现第二个 bug:assistant 消息 tool_calls 为扁平形状 {id,name,arguments},OpenAI 兼容 API 要求 {id,type:'function',function:{...}};真实 API 400 `missing field 'type'` | 技术类,自动批:ws-shapefix(序列化时映射形状);rfix 已修 reasoning 回传(第一个 400 原因),此为其后暴露的第二个 | 已派发 |
| 2026-08-21 | - | 冒烟:工具调用后下一轮 LLM 400;真实 API 验证 = DeepSeek 思考模式要求 tool_calls 消息回传 reasoning_content | 技术类,自动批:ws-rfix 修复(assistant(tool_calls) 附加本轮 reasoning_content);边界实测:普通续谈无需、空 reasoning 兼容 | 已合并(R5) |
| 2026-08-21 | - | 冒烟:高德 MCP 返回 USER_DAILY_QUERY_OVER_LIMIT(日配额耗尽) | 已知现象:rest 兜底链自动接替(实测 rest__geocodeAddress 成功);MCP 工具错误以 tool error 事件呈现,不致命;配额由用户控制台处理 | 已记录 |
| 2026-08-21 | - | npm install @modelcontextprotocol/sdk 被权限 deny(settings deny npm install*) | D5:手写零依赖 MCP 客户端(双传输),SDK 留 deferred;用户放行后 ws-mcp-sdk 已换官方 SDK | 已定稿,已替换 |
| 2026-08-21 | c | search 动作:bridge 接口不含搜索方法,执行器只通知建议卡片、不入 undo 栈 | 裁决:接受(v1/v2 搜索动作以建议卡片呈现;接入现有搜索管线属更侵入改动,记 deferred 待 v2.1) | 已记录 |
| 2026-08-21 | a | 门禁 FAILED:6 个 recruitment-import 测试失败(industries is not iterable) | 复验:dev 基线(fbbdc66)全绿 756;ws-a 单文件隔离复跑仍失败 → 问题在 ws-a 基线 f1dc329 而非 ws-a 代码;e1c9e24(dev 已合)修复了该基线缺陷。裁决:并入最新 dev 复跑门禁,ws-a 自身 59 测试全绿 | 待合并验证 |
| 2026-08-21 | - | map-engine 轮2 已合并(fbbdc66),map-shell 迁移到 MapView | ws-c prompt 已更新:bridge 改用 MapView 门面 + useMapEngine hook;seam 按最新结构追加 | 已更新 |
| 2026-08-21 | - | map-shell.tsx 曾属 map-engine 批次红线,但 v2 地图操作需 seam | 授权豁免:仅 ~30 行消费者式追加(import+JSX+ref bridge),不碰引擎/控件逻辑;ws-c 后置派发(map-engine 合并后已无红线,seam 按最新结构追加) | 已定稿 |

## deferred_notes
| ts | 类型 | 内容 |
|---|---|---|
| 2026-08-21 | Env-only | BAIDU_MAP_AUTH_TOKEN(百度 agentplan SK)申请:lbs.baidu.com/apiconsole/agentplan 创建应用,配入 .env.local 后 baidu-ai-map 工具组自动启用 |
| 2026-08-21 | Env-only | AGENT_LLM_* 覆盖项(当前 agent 直接用已配置的 LLM_API_KEY/LLM_MODEL/LLM_BASE_URL;若要独立指向如 DeepSeek v4 flash,加 AGENT_LLM_* 到 .env.local) |
| 2026-08-21 | 其他 | 高德/腾讯 MCP 端点 auth 实测校准:正式端点格式以官方文档为准,ws-b 按已核实文档实现,boss VERIFY 阶段用真实 key 冒烟;若不匹配需 fix 轮 |
| 2026-08-21 | 其他 | @modelcontextprotocol/sdk 替换手写客户端(权限放开后可做,非必须) |
| 2026-08-21 | UI设计 | Agent 设置 UI(Profile L2 存 DB,key 加密)——v2 之后再议 |

## next_plan
- 当前 milestone: M1 — 后端核心 + 文档(R1: ws-a + ws-d)
- 剩余步骤: R1 派发 → COLLECT → MERGE → R2(ws-b + ws-c)→ MERGE → VERIFY → 终态汇报
- 下一步: 写 prompts(ws-a/ws-d 本轮,ws-b/ws-c 备好)→ 预建 worktree → DISPATCH

## recovery
last_stage_written: PLAN(2026-08-21)
resume_history: -
