# WS-panel2 — Agent 面板 v2:记忆弹层重设计 + 会话管理(boss 派发)

## 背景

用户反馈(2026-08-22):①「目前这个记忆Ui太丑了」;②「新增会话管理」。

现状:记忆 UI 为内嵌条带式基础版(memoryPanel 贴边横条 + 素色条目);会话仅前端单会话
sessionStorage 'dm.agent-history.v1'。要求:**记忆弹层按 liquid glass 重设计 + 多会话管理**。

设计约束(项目 UI 铁律):Apple 风格 + liquid glass;主色 `#007AFF`(chrome/hover/徽章/按钮);
绿仅用于薪资/工时;玻璃 = 模糊 + 细高光描边 + 圆角;弱化文字用小字 muted。

## 布局图(目标,ASCII 契约)

```
Agent 面板 v2:
┌────────────────────────────────────────────────┐
│ ✦ AI 助手      [💬 会话] [🧠 记忆·3]       [✕] │ ← header 右侧:会话钮 → 记忆钮(带计数徽章)→ 关闭
├────────────────────────────────────────────────┤
│ (消息列表:文本轮/工具活动/完成·停止状态行)       │
│   …                                             │
│   ✓ 回答完成                                    │
├────────────────────────────────────────────────┤
│ (输入行 + [停止] [撤销] [清屏])                  │
└────────────────────────────────────────────────┘

点「💬 会话」→ 会话弹层(glass 卡,面板内嵌,同记忆弹层体系):
┌────────────────────────────────────────────────┐
│ 💬 会话                            [＋ 新建会话] │
│ ┌────────────────────────────────────────────┐ │
│ │ ● 导航到深圳腾讯           12:40    [×]     │ │ ← 当前会话:蓝底高亮 + 左侧 ●;点击切换;右侧 × 删除
│ │ ○ 帮我看看杭州的岗位       11:02    [×]     │ │
│ │ ○ 新会话                   10:15    [×]     │ │
│ └────────────────────────────────────────────┘ │
│ (空态:居中「暂无会话」)                          │
└────────────────────────────────────────────────┘

点「🧠 记忆·N」→ 记忆弹层(liquid glass 卡):
┌────────────────────────────────────────────────┐
│ 🧠 记忆 · 3                          [🗑 清除]  │ ← 计数徽章(蓝底白字圆角)+ 清除(橙边 hover 红)
│ ┌────────────────────────────────────────────┐ │
│ │ 我住在杭州西湖区                    [×]     │ │ ← 条目卡:soft-strong 底、圆角 12px、12px 内边距
│ │ 求职方向是产品经理                  [×]     │ │    行距 8px;删除 × 右侧 hover 红
│ │ 偏好蓝色主题                        [×]     │ │
│ └────────────────────────────────────────────┘ │
│ (加载中:三点 / 空态:居中「暂无记忆」/ 失败:弱提示+重试)│
└────────────────────────────────────────────────┘
```

## 任务

### A. 会话管理(新 `server/src/lib/agent-session-store.ts` + panel 接线)

1. **存储纯函数**(localStorage 读写注入为参数,node 可测):
   - key `dm.agent-sessions.v1`;结构 `{sessions: [{id, title, messages, updatedAt}], activeId}`;
     cap:10 会话 × 每会话 30 条(超出丢最旧);
   - `deriveTitle(messages)`:首条用户消息截断 12 字(中英文按码点),无 → 「新会话」;
   - `createSession` / `switchSession` / `deleteSession`(当前会话删除 → 切最近,全删 → 新建空)/
     `listSessions`(按 updatedAt 倒序)/ `appendMessage`(更新消息 + title + updatedAt);
   - **迁移**:无 v1 键时读旧 `dm.agent-history.v1` 迁为第一个会话(保留原消息);迁移后旧键清除。
2. **面板接线**(agent-panel.tsx):
   - header 新增「💬 会话」按钮(登录/guest 均可用——会话是本地功能,与账号无关);
   - 会话弹层:列表(标题 + 相对时间 + 删除 ×,当前高亮)、底部「＋ 新建会话」、空态;
   - 新建/切换:**若 streaming 先 stop**;切换即载入该会话消息(替换 messages 状态 + 存历史);
     完成/停止状态行、记忆、工具活动均按当前会话;
   - 清屏 = 清当前会话消息(会话条目保留,标题重置为「新会话」;记忆不动);
   - 消息变更统一走 store(appendMessage/save),不再直写 'dm.agent-history.v1'(读旧键仅用于迁移)。
3. i18n 新键:`agentSessions`(zh「会话」/en「Sessions」)、`agentSessionNew`(zh「新建会话」/en「New session」)、
   `agentSessionEmpty`(zh「暂无会话」/en「No sessions yet」)、`agentSessionDelete`(zh「删除会话」/en「Delete session」)。

### B. 记忆弹层重设计(agent-panel.tsx + module.css)

- 按布局图重构:标题「🧠 记忆 · N」计数徽章;条目改**卡片式**(soft-strong 底、圆角 12px、内边距 12px、
  行距 8px、删除 × hover 红);清除按钮样式保留语义(橙边 hover 红);
- 空态/加载/失败按布局图(失败加「重试」);弹层玻璃卡(圆角 16px、blur、细描边)与面板同体系;
- 现有纯逻辑(parseMemories/memoryViewState/API 调用)不动,只改呈现层。

### C. 测试

- `server/tests/agent-session-store.test.mjs`(新):create/switch/delete/list/append/标题派生/cap 裁剪/
  旧历史迁移(含空旧键)/activeId 语义;
- 组件契约测试:header 双入口按钮、agentSessions* 键、记忆计数徽章渲染条件;
- 全量回归零漂移。

## 不碰(红线)

后端 agent 全套、记忆 API/存储(ws-mem-a 产物)、markdown 管线、executor、bridge、ball、引擎、
map-shell(AgentBall 调用处若无 Props 变化则不动;若需传参仅最小接线)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-panelv2/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-panelv2 && make docs-check && git diff --check
```

## 纪律

小步 commit(`feat(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-panel2.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
