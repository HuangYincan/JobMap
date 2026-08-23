# WS: ws-a — 限流 XFF 统一 + Nominatim 加固 + 死代码清理(backend)

你是 headless 开发 worker。工作目录是**你的 worktree**:`/Users/acccan/dm-wt-r2-a`(已预建,分支 `feature/scan-r2-backend`,从 dev 切出)。**worktree 已预建,boss 统一合并;你绝不 merge / push / 建分支。** 完成后写汇报到 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix-r2/reports/ws-a.md`(末两行 token,格式见下)。

## 背景

r2 质量扫描(全库只读)发现:`tech/roles/development/quality-scans/20260823-all-r2/scan-report.md`。本 WS 修 **#1 #6 #7 #11**(均技术类,boss 已批)。代码在 `server/src/`(Next.js 16 + React 19,TS)。r1 修复已在 dev(#1 的 agent-chat 模式是 r1 落的,见下)。测试用 Node 内置 `node --test tests/*.test.mjs`,无 DB 依赖。

## 任务(全部在 worktree 内)

### #1(Med)XFF 信任策略三路由统一
- **现状**:`server/src/app/api/agent/chat/route.ts:42-51` 已实现 `TRUSTED_PROXY_IPS` 闸:配置时(逗号分隔代理出站地址)才信任 `x-forwarded-for`;未配置时忽略转发头,桶键改用会话指纹(登录用户按会话 cookie 哈希;匿名归固定桶)。但 `server/src/app/api/auth/otp/send/route.ts:147-154` 与 `server/src/app/api/auth/password/login/route.ts:92-99` 仍各自内联 `clientIp()` 直取 XFF 首段(可伪造换桶)→ r1 #2 的 per-IP 20/24h(OTP)与 20/15min(登录)上限可被绕过。
- **要求**:三路由统一语义——**优先抽共享 helper**(如 `server/src/lib/client-ip.ts`:`resolveClientIp(request, peerIp?)` + `TRUSTED_PROXY_IPS` 常量 + 会话指纹键工具),agent-chat 行为保持不变;OTP/密码登录路由的 per-IP 维度改用同一解析;per-target/per-账号 守卫(account-keyed)保持不变。未配置 TRUSTED_PROXY_IPS 时登录用户按会话指纹、匿名归固定桶(与 agent-chat 一致)。
- **契约测试**(如 `tests/rate-limit-xff.test.mjs` 或并入现有 auth-hardening.test.mjs,按现有先例):(a) 伪造/轮换 XFF 不换桶(未配置 TRUSTED_PROXY_IPS 时);(b) 配置 TRUSTED_PROXY_IPS 后 XFF 受信;(c) 注册用户/匿名桶键不同。测试不依赖真实网络。

### #6(Low)Nominatim 海外检索路径无 memo
- **现状**:`server/src/lib/site-geocode.ts` 国内路径有 `placeSearchMemoKey/Set/Get`(:473-485,只缓存成功命中);海外 Nominatim 路径(:1658-1691 区域)逐站重复打 OSM 公共服务——同公司同城多海外站(如安克创新)重复请求。
- **要求**:海外路径加同构 memo(键 = query+city 或与国内同构,只缓存成功命中;失败/空结果不写——配额恢复后必须重试)。注意边界:`nominatimSearchRest` 保持无状态可单测;memo 放调用方层级(参考国内路径调用处结构)。

### #7(Low)`nominatimSearchRest` q 无长度上限
- **现状**:`site-geocode.ts:1663-1669` q 无上限,Nominatim 建议 ≤256 字符,超长返回 400 → unresolved 噪音。
- **要求**:q > 256 时截断到 256(保留公司名主体,丢弃地址段;注释说明与 Nominatim 建议对齐)。不改变失败降级语义。

### #11(Low)contrast.ts 死代码
- **现状**:`server/src/lib/contrast.ts` 生产代码零引用(仅 `server/tests/contrast.test.mjs` 引用)。
- **要求**:**先验证再删**——`grep -rn "contrast" server/src server/tests`(以及全仓,含 css/docs 引用)确认无生产引用后,删除 `server/src/lib/contrast.ts` 与 `server/tests/contrast.test.mjs`。若发现任何生产引用 → 不删,在汇报「遇到的问题」写明。删除会减 3 个测试,汇报里记录删除后的权威测试总数。

## 文件边界

- 拥有:`server/src/app/api/auth/otp/send/route.ts`、`server/src/app/api/auth/password/login/route.ts`、`server/src/lib/site-geocode.ts`、`server/src/lib/contrast.ts`(删)、`server/tests/contrast.test.mjs`(删)、新增 `server/src/lib/client-ip.ts`(如抽 helper)、相关测试文件。
- 不碰:`server/data/**`、`map-shell.tsx`、agent/chat 路由行为(可引用其 helper,不改其逻辑)、`server/src/lib/session-store.ts` 会话语义、其他 tech 文档。
- 若抽共享 helper,`agent/chat/route.ts` 允许改为调用 helper(行为必须逐位一致)。

## 门禁(必须全部通过)

```bash
cd server && npm test        # 全绿;记录权威总数(当前基线 1487 tests / 1485 pass / 2 skip)
npm run typecheck            # 零错误
cd .. && make docs-check     # 文档规范
git diff --check
```

## 汇报

写 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix-r2/reports/ws-a.md`:
- 顶部:改了什么(每发现号一行,含 file:line)+ 测试新增/删除数与权威测试总数。
- 「遇到的问题」段:任何 BLOCKED 风险、发现与扫描报告不一致处、需要 boss 裁决的事项。
- **末两行必须精确**(机器可读 token):
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
