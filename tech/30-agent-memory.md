# 30 — 用户个性化记忆(Agent Memory)

**文档版本:** 1.0
**创建日期:** 2026-08-22
**状态:** 已实现(批次 `20260822-boss-agent-memory`,ws-mem-a 后端核心;前端面板/管理 UI 由 ws-mem-b 负责;2026-08-22 ws-panel2 起管理弹层按 liquid glass 重设计——计数徽章/卡片条目/失败重试,见批次 `20260822-boss-agent-panel-v2`)
**相关:** `tech/24-agent-feature.md`(AI Agent 全链路)、`db/migrations/018_user_memories.sql`、批次目录 `tech/roles/development/parallel-sessions/20260822-boss-agent-memory/`

---

## 1. 背景与动机

用户要求(2026-08-22):「实现记忆功能,对每个用户实现个性化记忆」。

Agent 对话目前完全匿名:system prompt 不含任何用户上下文,每次对话都从零开始。用户表达过的偏好(常驻城市、求职意向、语言习惯等)无法跨对话复用。本功能为每个登录用户维护一条「个性化记忆」事实列表,在每次 agent 会话构建 system prompt 时注入,让 LLM 的回答贴合用户;同时提供 `builtin__memory_save` 工具,让 LLM 在用户明确表达可长期复用的事实时主动保存。

## 2. 数据模型(`db/migrations/018_user_memories.sql`)

```sql
CREATE TABLE user_memories (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_memories_user_created_idx ON user_memories (user_id, created_at DESC);
```

- 范式表同 `008_saved_places.sql`:user_id FK + ON DELETE CASCADE;guest 不写(无 user_id)。
- 索引支撑「按用户取最新 N 条」的读路径。
- 迁移台账 `db/scripts/apply.sh` 自动应用(Env-only);`tests/integration/db/test_migrations.sh` 的 required 表数组已含 `user_memories`。

## 3. 存储层(`server/src/lib/memory-store.ts`)

与 `account-store.ts` 同构的仓储门面:

| 函数 | 语义 |
|---|---|
| `listMemories(userId)` | 按 `created_at DESC` 返回 `{id, content, createdAt}[]`,上限 50 |
| `addMemory(userId, content)` | 写入一条记忆;content 经 `sanitizeMemoryContent`(trim + 截断 200 字);空串不写 |
| `removeMemory(userId, id)` | 删除自己的某条(`WHERE user_id = $1 AND id = $2`) |
| `clearMemories(userId)` | 清空该用户全部记忆 |
| `sanitizeMemoryContent(raw)` | 纯函数:非 string/空白 → `''`;超 200 字截断 |

故障策略(与 account-store 同语义):

- **读路径**(`withDbRead`):无 DB(内存模式)或 DB 查询失败 → 回落内存/空,可恢复,不崩。
- **写路径**(`withDbWrite`):无 DB → 写入进程内内存(内存模式本身就是存储);DB 已配置但故障 → 抛 `DbUnavailableError`,绝不静默回落内存(避免内存与 DB 数据分裂)。
- 测试钩子 `__memoryStoreTest.poolOverride`(同 `__accountStoreTest` 模式)让单测确定性覆盖两条路径。

## 4. 注入格式与预算(`run-agent.ts` 的 `loadUserMemory`)

`loadUserMemory(userId)` 在构建 system prompt 前把记忆列表格式化为注入段:

```
- 事实1
- 事实2
```

预算(超限截断,保证返回串总长 ≤ 4000,换行符计入):

| 预算 | 值 | 说明 |
|---|---|---|
| 单条 | ≤ 200 字 | 与 `sanitizeMemoryContent` / 工具 schema 一致 |
| 条数 | ≤ 20 条 | 按 created_at DESC 取最新 |
| 总长 | ≤ 4000 字符 | 含 `- ` 前缀与 `\n` 分隔符 |

- 无 `userId` 或无记忆 → 返回 `undefined` → system prompt 不出现该段。
- 注入位置:zh/en 模板的「角色行」之后、「## 能力边界」之前。
- 段标题(zh):`## 用户记忆(供个性化参考,不要复述给用户)`;模板零 secret 占位纪律不破。

## 5. 工具契约(`builtin__memory_save`)

内置工具(`server/src/lib/agent/tools/builtin.ts` 追加导出 `memorySaveTool()`,现有工具不动):

- **name:** `builtin__memory_save`(公开 tool 事件类别经 `toolKind()` → 新增 `memory` 类别;`ToolKind` 联合类型同步加 `'memory'`,前端 i18n 键由 ws-mem-b 负责,未知类别前端回落「其他操作」)。
- **description 约束(软性,不硬拦):** 用户明确表达个人偏好、身份信息、常驻城市、求职意向等值得长期记住的事实时调用;**禁止保存密码、密钥、验证码、完整家庭住址等敏感信息**。
- **inputSchema:** `{ content: string }` 必填,≤200 字。
- **call 行为:**
  - `ctx.userId` 缺失(guest/防御)→ `{ok:false, error:'请先登录后再保存记忆'}`;
  - 空内容(trim 后)→ `{ok:false, error:'记忆内容不能为空'}`;
  - 成功 → `addMemory`(超长入参经 sanitize 截断 200);
  - `DbUnavailableError` → `{ok:false, error:'记忆服务暂不可用,请稍后再试'}`(可恢复,不抛)。
- 敏感词**不做硬性拦截**——「禁止保存密码/密钥」是描述级约束,存储层只做纯文本 sanitize,不解析内容(测试断言敏感词内容照常保存成功)。

## 6. 端点与 route 集成

### `POST /api/agent/chat`(改造)

- 身份读取:全部前置校验(限流/body/messages/viewport/LLM 配置)**之后**、`getMcpProvider`/`runAgent` 连接**之前**调用 `readSessionUser()`(保持既有源码行序契约,contract 测试锚定)。
- 登录 → `runAgent` 传 `userId: sessionUser.id`(run-agent 内部经 `loadUserMemory` 注入记忆段),tools 数组追加 `memorySaveTool()`;guest → userId 不传、不加工具。
- route 内不出现供应商前缀字面量(脱敏契约:工具经 builtin 模块导出追加)。

### `GET/DELETE /api/me/memories`(新)

- `GET`:返回 `{ items: [{id, content, createdAt}] }`;guest → `{ items: [] }`(仿 saved 路由范式)。
- `DELETE`:清除当前用户全部记忆;guest → 401 `UNAUTHORIZED`。

## 7. 隐私边界

- 记忆按 `user_id` 严格隔离:增/删/清均带 user_id 条件,`removeMemory` 删不到别人的行。
- 只存用户主动表达、可长期复用的事实;密码/密钥/验证码/完整地址由工具描述明确禁止。
- 内容纯文本存储,入参 sanitize(trim + 截断),参数化 SQL(防注入)。
- 注入预算限制单次上下文暴露量(20 条 / 4000 字符);system prompt 明确「不要复述给用户」。
- 公开面脱敏:`builtin__memory_save` 的 tool 事件 name 收敛为公开类别 `memory`,不携带内部工具名;工具结果全文只进 LLM 历史。

## 8. guest 语义

| 场景 | 行为 |
|---|---|
| guest 对话 | 无记忆注入;无 memory_save 工具;`/api/me/memories` GET 空 / DELETE 401 |
| 登录对话 | 注入记忆段(如有);可调用 memory_save 保存新事实 |
| 登出/换账号 | 记忆随 user_id 隔离,互不可见;用户删除 → ON DELETE CASCADE 清空 |

## 9. 测试清单

| 文件 | 覆盖 |
|---|---|
| `tests/memory-store.test.mjs`(新) | sanitize(截断/空串);内存模式 add/list/remove/clear + userId 隔离;DB 模式 SQL 契约(SELECT user_id + LIMIT 50 / INSERT sanitize / DELETE 带 user_id);读失败回落;写失败抛 DbUnavailableError |
| `tests/agent-tools.test.mjs`(追加) | memory_save:guest 拒绝 / 登录成功 / 超长截断 200 / 敏感词不硬拦 / 空内容 error / DB 故障可恢复 error |
| `tests/agent-runner.test.mjs`(追加) | 带 userId 且有记忆 → system 首条含记忆段(最新在前);无 userId/空记忆不含;ctx.userId 透传;loadUserMemory 预算(20 条 / 4000 含换行) |
| `tests/agent-prompts.test.mjs`(追加) | zh/en 记忆段仅 memory 非空时注入;空/缺省不注入;位置在能力边界之前 |
| `tests/agent-route-contract.test.mjs`(追加) | 身份读取行号位于全部前置校验之后、getMcpProvider/runAgent 之前;memorySaveTool 追加与 userId 透传 |
| `tests/integration/db/test_migrations.sh` | required 表数组含 `user_memories` |
