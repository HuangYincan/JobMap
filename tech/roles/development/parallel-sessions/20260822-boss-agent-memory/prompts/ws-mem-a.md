# WS-mem-a — agent 个性化记忆:后端核心(boss 派发)

## 背景

用户要求(2026-08-22):「实现记忆功能,对每个用户实现个性化记忆」。

探索结论(boss Explore,2026-08-22):
- 身份:httpOnly cookie `dm_session` → `readSessionUser()`(`server/src/lib/http-session.ts:10-12`)→ userId
  (guest = null);`/api/me/saved` 是身份路由范式(`route.ts:16-26`)。**agent chat route 目前完全匿名**。
- DB:`server/src/lib/db.ts:8-25` pg Pool 懒加载单例;读写封装 `withDbRead/withDbWrite`(`account-store.ts:202-225`);
  migration 在 `db/migrations/001..017_*.sql`,`db/scripts/apply.sh` 台账应用,下一个为 `018_*`;
  范式表 `008_saved_places.sql`(user_id FK + UNIQUE + 索引)。
- 工具:builtin 工具 = `builtin.ts` 的 `builtinTools()` 返回 `AgentTool[]`(name/description/inputSchema/provider/call);
  组装点 `route.ts:154-158`;`toolKind()` 关键词分类(`run-agent.ts:164-172`)决定公开类别。
- prompt:`buildSystemPrompt(cfg: PromptInput, lang)`(`prompts.ts:88-90`),PromptInput = {maxTurns, hasTools};
  模板为数组 join(zh/en 两组)。

worktree: `/Users/acccan/dm-wt-agent-mema`(分支 `feature/agent-memory-core`,boss 从最新 dev 切出后派发)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-memory/reports/ws-mem-a.md`

## 任务

1. **migration** `db/migrations/018_user_memories.sql`(新):
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
2. **`server/src/lib/memory-store.ts`**(新,仿 account-store 的 withDbRead/withDbWrite 模式):
   - `listMemories(userId): Promise<{id, content, createdAt}[]>`(按 created_at DESC,上限 50);
   - `addMemory(userId, content): Promise<void>`(content sanitize:trim、截断 200 字、防注入——纯文本入参);
   - `removeMemory(userId, id): Promise<void>`(仅删自己的,`user_id` 条件);
   - `clearMemories(userId): Promise<void>`;
   - 无 DB(内存模式)与读失败回落:返回空/可恢复,写失败抛 DbUnavailableError(与 account-store 同语义);
   - 导出 `sanitizeMemoryContent(raw): string` 纯函数(截断/空串处理,可单测)。
3. **agent 类型与流程**:
   - `types.ts`:AgentContext 加 `userId?: string`;ToolResult 不变;
   - `run-agent.ts`:RunAgentRequest 加 `userId?: string`;构建 system prompt 前注入记忆段——
     新增 `loadUserMemory(userId)`(列表格式化:`- 事实1\n- 事实2`,上限 20 条、单条 200 字、总长预算 4000,超限截断);
     PromptInput.memory 传入(无 userId 或空记忆 → 不注入该段);
   - `prompts.ts`:PromptInput 加 `memory?: string`;zh/en 模板各加一段
     「用户记忆(供个性化参考,不要复述给用户)」/「User memory (for personalization; do not recite it back)」,
     仅 memory 非空时出现。
4. **内置工具** `server/src/lib/agent/tools/builtin.ts` 加 `builtin__memory_save`:
   - 描述:用户明确表达偏好/身份/常驻城市等事实时调用保存;禁止保存密码/密钥/完整地址等敏感信息;
   - inputSchema:{content: string}(必填,≤200 字);
   - call:userId 缺失 → ToolResult {ok:false, error:'请先登录后再保存记忆'};成功 → 调 addMemory;
   - `toolKind()` 规则表(`run-agent.ts:164-172`)加 `memory` → 现有类别不匹配会落 other——可加 `'memory'` 类别
     (types.ts ToolKind 联合加 'memory')或留 other,以最小改动为准(留 other 可接受,但建议加类别+前端键由 ws-mem-b 处理)。
5. **route** `server/src/app/api/agent/chat/route.ts`:
   - 顶部(限流/校验之后、**getMcpProvider/runAgent 之前**,保持既有行序契约)调用 `readSessionUser()`;
     登录 → 读记忆(`loadUserMemory`)+ tools 数组追加 memory_save;guest → userId 不传、不加工具;
   - `server/src/app/api/me/memories/route.ts`(新):GET 列表 / DELETE 清除(guest 401 或空,仿 saved 路由范式);
6. **文档** `tech/25-agent-memory.md`(新):架构(表结构/注入格式/工具契约/隐私边界/guest 语义/上限预算)+ 测试清单。

## 测试

- `server/tests/memory-store.test.mjs`(新):sanitizeMemoryContent(截断/空串)、add/list/remove/clear(userId 隔离、上限);
- `agent-tools.test.mjs` 追加:memory_save(登录成功/guest 拒绝/超长截断/敏感词不做硬性拦截——只按描述约束,断言截断);
- `agent-runner.test.mjs` 追加:带 userId 时 system 首条含记忆段;无 userId/空记忆不含;
- `agent-prompts.test.mjs` 追加:记忆段 zh/en 注入断言(非空 memory 出现、空 memory 不出现);
- `agent-route-contract.test.mjs`:保持「校验函数行号 < getMcpProvider/runAgent」顺序契约不破(新增身份读取在连接前);
- `tests/integration/db/test_migrations.sh` 的 required 表数组加 `user_memories`(如有该断言文件)。
- 全量回归零漂移。

## 不碰(红线)

前端组件(agent-panel/ball/map-shell/account-panel——ws-mem-b 负责)、i18n(ws-mem-b)、executor、bridge、引擎、
markdown 管线。`builtin.ts` 现有工具不动(只追加)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-mema/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-mema && make docs-check && git diff --check
```

## 纪律

小步 commit(`feat(agent-memory): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-mem-a.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
