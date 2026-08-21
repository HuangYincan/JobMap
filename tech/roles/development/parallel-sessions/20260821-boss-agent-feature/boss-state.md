# Boss State — agent-feature

## meta
- slug: 20260821-boss-agent-feature
- date: 2026-08-21
- batch_dir: tech/roles/development/parallel-sessions/20260821-boss-agent-feature
- goal: AI Agent 功能(v1 建议 + v2 地图操作,自建 OpenAI 兼容引擎,三平台 MCP + baidu-ai-map skill,悬浮球 UI,spec 编程 tech/24)
- owner: boss(自主)
- milestone_link: 无(main 不涉及,dev 目标)

## stage
current: DONE(终态)✅
updated_at: 2026-08-21
dev_head_note: dev = f80c244(批次入库后);12 WS 全部合并;最终冒烟:工具流 + action(flyTo nested center)+ done,零 400/error;门禁 975 tests / 973 pass

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a-d/b-fix/mcp-sdk/enh/rfix/sfix | (R1-R6,共 9 WS) | (已清理) | prompts/*.md | reports/*.md | MERGED | - | 2026-08-21 | 2026-08-21 | 全部并入 dev |
| tfix | feature/agent-trim-fix | (已清理) | prompts/ws-trimfix.md | reports/ws-trimfix.md | MERGED | ea54440 | 2026-08-21 | 2026-08-21 | sanitize 落位 + 整轮裁剪 + 分类修正(R7) |
| nfix | feature/agent-snap-fix | (已清理) | prompts/ws-nfix.md | reports/ws-nfix.md | MERGED | f8393e3 | 2026-08-21 | 2026-08-21 | 四向吸附 + 面板垂直锚定(R7) |
| afix | feature/agent-action-prompt | (已清理) | prompts/ws-afix.md | reports/ws-afix.md | MERGED | d591222 | 2026-08-21 | 2026-08-21 | prompt 内嵌动作契约(R8) |

## merge_order
R1-R8 全部合并(12/12 WS):a → d → b → b-fix → mcp-sdk → c → c-enhance → rfix → shapefix → trim-fix + snap-fix(R7)→ action-prompt(R8)。

## adjudication_log
| ts | ws | 问题 | 裁决 | 结果 |
|---|---|---|---|---|
| 2026-08-21 | - | 冒烟复现第二个 bug:assistant 消息 tool_calls 扁平形状,API 要求嵌套 {id,type,function} | 自动批:ws-shapefix | 已合并 |
| 2026-08-21 | - | 冒烟:工具调用后 LLM 400;DeepSeek 思考模式要求回传 reasoning_content | 自动批:ws-rfix | 已合并 |
| 2026-08-21 | - | 冒烟:高德 MCP USER_DAILY_QUERY_OVER_LIMIT | REST 兜底链自动接替,非致命 | 已记录 |
| 2026-08-21 | - | npm install 被权限 deny | D5 手写客户端;用户放行后 ws-mcp-sdk 换官方 SDK | 已替换 |
| 2026-08-21 | c | search 动作 bridge 无搜索方法 | 接受(建议卡片呈现),search 动作 v2.1 记 deferred | 已记录 |
| 2026-08-21 | a | 门禁 FAILED(industries 基线缺陷) | 并入最新 dev 复跑,ws-a 自身全绿 | 已解决 |
| 2026-08-21 | - | map-engine 轮2 合并,map-shell 迁移 MapView | ws-c prompt 更新 | 已更新 |
| 2026-08-21 | - | map-shell 曾属红线,v2 需 seam | 豁免:仅 ~30 行消费者式追加 | 已定稿 |
| 2026-08-21 | - | R7 后冒烟:工具流全通但 0 action 事件;LLM 输出扁平 {lng,lat},schema 要求嵌套 center;prompts.ts 未给 payload 形状 | 自动批:ws-afix 内嵌完整动作契约(中英文,逐字对齐 validateAction);schema 保持严格 | 已合并(R8)并冒烟通过 |

## deferred_notes
见 `deferred-notes.md`。已清:#3 MCP 端点校准(实测完成)、#4 官方 SDK(已替换)。剩余:1 BAIDU_MAP_AUTH_TOKEN(Env-only)、2 AGENT_LLM_* 覆盖(Env-only)、5 Agent 设置 UI(UI设计)、6 会话持久化、7 company-context 工具、8 Playwright 视觉验证待浏览器空闲。

## next_plan
- 里程碑全部完成(M1-M8)。agent-feature 批次终态。
- 后续建议(非本批次):用户配置 BAIDU_MAP_AUTH_TOKEN 后 baidu-ai-map 工具组自动启用;可开新批次做 Agent 设置 UI / 会话持久化 / company-context。

## recovery
last_stage_written: DONE(终态)
resume_history: 故障恢复已走通(resume-boss 协议幂等;worker/merger 断点续跑)。
