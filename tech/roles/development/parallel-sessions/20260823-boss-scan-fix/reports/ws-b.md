# ws-b 汇报(2026-08-23)

W​S: feature/scan-api-boundaries(worktree /Users/acccan/dm-wt-scan-b)。4 commits,工作树干净,未 merge 未 push。

## 实际改动

- **#11 agent/chat 限流伪造 XFF 绕过** → `server/src/app/api/agent/chat/route.ts`
  - 桶键派生改为 `rateLimitKey(request)`:新增 `TRUSTED_PROXY_IPS` 门控(逗号分隔的可信反代出口地址 env)。
    - 配置了可信代理 → 取 `x-forwarded-for` 首段(代理注入,客户端不可控;缺失时回落 `x-real-ip` / `ip:unknown`)。
    - 未配置(默认,直连场景)→ **完全忽略转发头**,桶键 = 会话指纹:登录用户按会话 cookie SHA-256 哈希;匿名无 cookie 归入固定桶 `anon:public`。
  - 限流(令牌桶 10 req/min)仍是最前置校验(读 body 之前),`POST` 内一行改为 `rateLimit(await rateLimitKey(request))`;SSE 端点保持公开可达。
  - 验收满足:**轮换/伪造 XFF 不再换桶**(未配置代理时桶键与请求头无关;信任 XFF 仅在显式配置可信反代后)。
  - 测试:`server/tests/agent-route-contract.test.mjs` 重写「限流」用例 + 新增 #11 用例(XFF 读取位于门控之后、readSessionToken/createHash 指纹路径、限流先于 body 读取)。
  - 文档:`tech/24-agent-feature.md` §6.5 限流行改为桶键规则,§8 环境变量表新增 `TRUSTED_PROXY_IPS` 行。
- **#12 GET /api/pois 无输入上限** → `server/src/app/api/pois/route.ts`
  - 新增 `MAX_Q_LENGTH = 100`、`MAX_PAGE = 10_000`、`MAX_PAGE_SIZE = 100` 与 `pagedParam()` 助手。
  - `q` 超 100 字符 → 400 `Q_TOO_LONG`;`page` 非整数或越出 1..10000 → 400 `INVALID_PAGE`;`pageSize` 非整数或越出 1..100 → 400 `INVALID_PAGE_SIZE`;三类校验均在缓存 key 构造之前(超限值永不进缓存)。
  - 缺失/空串回退默认 `page=1`/`pageSize=20`,正常请求语义不变(>50 的 pageSize 仍由 `searchPublicCatalog` 夹紧到 50,与 POST /api/search 一致)。
  - 小偏差说明:POST /api/search 对 `pageSize=1.5` 不拒绝(库层 floor),本 GET 对非整数一律 400(扫描 #12 正文「非整数 → 400」),已在文档标注。
  - 测试:`api-hardening.test.mjs` 新增 #12 用例(常量/错误码/先于缓存 key/默认回退/原管线保持)。
  - 文档:`tech/10-search-filter.md` API 设计 1. 搜索 API 段新增输入上限注记。
- **#13 publicCacheKey `|` 拼接碰撞** → `server/src/lib/public-cache.ts`
  - `publicCacheKey` 改为「类型标记 + 长度前缀 + 原值」逐段编码(`s/u/n/d/b/x` 标签,`tag:len:raw`),每段按长度自定界——组件值内 `|`/引号/换行不再影响段边界;undefined 与 null、数字/布尔与同形字符串分别编码(JSON 数组序列化会把 undefined/null 同归 `null`,存在残余碰撞,故不用)。
  - 测试:`public-cache.test.mjs` 重写旧「join 空槽」用例 + 新增 #13 碰撞用例(`['a|b','c']` vs `['a','b|c']` 断言 key 不同;确定性;undefined≠null;1≠'1';true≠'true';含换行不碰撞)。
- **#18 PATCH /api/me 无长度/格式上限** → `server/src/app/api/auth/me/route.ts`
  - `displayName`:非字符串 → 400 `INVALID_DISPLAY_NAME`;长度 > 50 → 400 `DISPLAY_NAME_TOO_LONG`(50 以现有来源上限为准:GitHub 用户名上限 39,本地默认名远短于此)。
  - `avatarUrl`:非字符串或长度 > 2048 → 400 `INVALID_AVATAR_URL`;非空值必须 `http:`/`https:`(`new URL` 解析 + 协议白名单,`javascript:`/相对地址等一律 400)。
  - 校验全部先于 `updateUser`(不入库不回显);`avatarUrl: ""` 保留清头像语义(removeAvatar 流程,DB COALESCE 行为不变);空串 displayName 语义也未收紧。
  - 测试:`api-hardening.test.mjs` 新增 #18 用例(常量/错误码/协议白名单/先于 updateUser/清头像保留/401 保持)。
  - 文档:`tech/14-api-contract.md` 用户名行追加 PATCH 输入上限说明。
- 未改前端:displayName 输入框无 maxLength(src/components/account-panel.tsx 不在本 ws 边界),后端 400 先行,前端约束留待后续;无 UI 设计改动。

## 门禁结果

- npm test: **1474 tests / 1472 pass / 2 skip / 0 fail**(2026-08-23,含新增 #11/#12/#13/#18 用例)
- npm run typecheck(tsc --noEmit): 通过
- make docs-check(策略 grep): 通过(无匹配);git diff --check: 通过(无空白错误)
- 小步 commit ×4(Conventional Commits,每个发现号一次,scope: public-cache / pois / agent-chat / auth-me)

## 遇到的问题

- #11 匿名客户端无任何服务端身份(仅登录/oauth 路径发 cookie),「未配置可信代理」模式下匿名用户共享固定桶 `anon:public`(10 req/min)——这是「客户端直连场景无法取得不可伪造客户端标识」的下界;配了 `TRUSTED_PROXY_IPS`(部署在可信反代后)即恢复 per-IP 粒度。对登录用户(实际 LLM 用量主力)按会话指纹分桶,精确且不可绕过。如需匿名颗粒度,后续可给 agent chat 发 guest cookie(需动 session-store,不在本批边界)。
- #12 对非整数 page/pageSize 从严 400(比 POST /api/search 严格一点,后者 1.5 会被库层 floor),按扫描正文「非整数 → 400」执行;若要与 search 完全逐字节一致,可改为仅拒绝 <1/>max。
- `make -C` 绝对路径被沙箱拦截,doc-check 以 Makefile 同款 grep 命令等价执行(输出无匹配 = 通过)。

## 证据

- npm test 摘要:`ℹ tests 1474 / pass 1472 / fail 0 / skipped 2`(完整输出 server 侧,两轮:改动中 1474/1472/0,终态相同)。
- commits:
  - `9d9dcde fix(public-cache): 长度前缀编码消 publicCacheKey | 拼接碰撞 (scan #13)`
  - `756656c fix(pois): GET /api/pois q/page/pageSize 输入上限对齐 search (scan #12)`
  - `8b33bc7 fix(agent-chat): 限流桶键仅可信代理信任 XFF,否则会话指纹 (scan #11)`
  - `316a3cb fix(auth-me): PATCH /api/me displayName/avatarUrl 输入上限 (scan #18)`
- 分支 tip:`316a3cb`;工作树 `git status --short` 空。

门禁: PASSED
结论: OK
