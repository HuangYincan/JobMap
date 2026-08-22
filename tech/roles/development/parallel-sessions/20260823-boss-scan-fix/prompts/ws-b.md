# Workstream b — feature/scan-api-boundaries(API 输入/限流边界)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-scan-b`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix/reports/ws-b.md`(末两行 token,见文末)。

## 背景

全库扫描(2026-08-23)报告:`tech/roles/development/quality-scans/20260823-all/scan-report.md`(通读 #11 #12 #13 #18 明细段)。

## 任务(按扫描发现号)

### #11 [Low] agent/chat 限流可被伪造 XFF 绕过
- `server/src/app/api/agent/chat/route.ts:57-64,86`:限流桶按 `x-forwarded-for` 首段取 IP,客户端可直接伪造该头轮换桶(10 req/min 上限可绕过)。
- **修法**:仅当连接来自可信代理(如本机代理/部署代理地址)时才信任 XFF,否则以 socket 客户端地址(或会话指纹)作为桶键;SSE 端点保留公开可达但受节流。修法自裁(以「伪造 XFF 不再换桶」为验收),补测试。

### #12 [Low] GET /api/pois 无输入上限
- `server/src/app/api/pois/route.ts:37-43`:q 无长度限制、page/pageSize 未校验(POST /api/search 有 MAX_Q_LENGTH 100 与 pageSize 校验,GET 没有)。
- **修法**:对齐 POST /api/search 的 q 长度上限与 page/pageSize 校验(负数/超大/非整数 → 400 或夹紧,与现有 search 行为一致),补测试。

### #13 [Low] publicCacheKey `|` 拼接不转义(key 碰撞)
- `server/src/lib/public-cache.ts:80-82`:`|` 拼接组件的值;组件值(如 filters JSON)可含 `|` → 不同查询命中同一缓存。
- **修法**:改 JSON 序列化(或长度前缀编码)生成 key,消碰撞;补碰撞用例测试(构造含 `|` 的组件值断言 key 不同)。

### #18 [Low] PATCH /api/me 无长度/格式上限
- `server/src/app/api/auth/me/route.ts:44-48`:displayName 直接入库并回显;avatarUrl 无协议白名单。
- **修法**:displayName 长度上限(如 50,以现有 UI 约束为准)超限 400;avatarUrl 仅允许 http/https 且长度上限(如 2048),非法 400;补测试。若改前端约束展示,仅限必要处,不动 UI 设计。

## 文件边界

- **可以改**:`server/src/app/api/agent/chat/route.ts`、`server/src/app/api/pois/route.ts`、`server/src/lib/public-cache.ts`、`server/src/app/api/auth/me/route.ts`、对应测试文件(可新建)、确有必要处的技术文档(仅本批涉及段,如 tech/27 的限流说明;若只改代码不动文档,在汇报说明)。
- **不碰**:`account-store.ts`、`session-store.ts`、`oauth-state.ts`(ws-a)、`server/data/**`、`map-shell.tsx`、`map-engine/**`、`CHANGELOG.md`/`README.md`/`CLAUDE.md`/`agent.md`(ws-c)。

## 门禁

1. `cd /Users/acccan/dm-wt-scan-b/server && npm test`(全绿,新增测试含 #13 碰撞用例)
2. `npm run typecheck`
3. `cd /Users/acccan/dm-wt-scan-b && make docs-check`、`git diff --check`
4. 小步 commit(Conventional Commits;每完成一个发现号一次提交)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix/reports/ws-b.md`:每个发现号修法/测试;**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
