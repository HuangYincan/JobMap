# 质量扫描报告(2026-08-23 · scope: all)

## 摘要

- 扫描对象与规模:全库(只读)。根文档 5(README/CHANGELOG/CLAUDE/agent/CONTRIBUTING/Makefile)、`tech/` 36 篇技术文档 + 角色记录/批次目录、`.claude/skills|agents` 19 文件;`server/src` 173 文件(19 路由 / 90 lib / 24 components / 7 hooks);`server/tests` 102 个测试文件(1464 处顶层 `test(` 调用);`crawler/app` 10 py(103 个 `def test_`);`db/migrations` 001–018;数据 drops:radar 646 + official-career 78 + qqdoc-official 142 + qqdoc-jobs 163 + embodied-jobs 46 JSON。
- 发现总数:**19**,按严重度 **High 1 / Medium 9 / Low 9**。
- 按类别:文档 4(其中 3 为数字/事实漂移集群)/ 前端 1 / 后端 8 / 数据库 1 / 数据 3 / crawler 1 / 仓库卫生 1。
- 上轮复核:20260820-all 的 15 条已按"修复状态回填"大部分闭环;#7(双重解码)已修(pois/[id]/route.ts:13-15 去二次解码 + MAX_ID_LENGTH 256)、#9/#10/#11/#12/#13 已修;**未修且继续恶化**:D-18(map-shell 2817→3210 行)、D-19(同公司多 slug)、D-20(拼写,本轮扩大至 13 文件)、D-05(robots 失败默认允许)、D-01(串味行,仍为查询层防御)。本轮新发现集中在:**OTP 单次性缺陷(DB 模式可重放)**、OTP 发送/密码登录缺全局限流、SESSION_SECRET 公开回退、server/README.md 大段过时(含已删除的 000000 demo 描述)、测试计数三处互斥(568/488/600)、CHANGELOG 停在 2026-08-21、数据计数全线漂移、`证劵` 别字扩散至 13 文件 + 3 个新名称错字。

## 发现清单(按严重度排序)

| # | 严重度 | 类别 | 位置(file:line) | 问题 | 建议 |
|---|--------|------|-----------------|------|------|
| 1 | High | backend | server/src/lib/account-store.ts:713-717 | OTP 验证码在 DB 模式可**重复使用**(10min TTL 内):DB 成功消费后内存挑战未同步删除,再次验证走 `ok \|\| memConsumeOtp(...)` 内存分支仍通过 → 同一验证码可登录/改密/绑手机两次 | 成功路径无条件删内存挑战(或 DB 与内存二选一为权威)、补「单次消费」契约测试 |
| 2 | Medium | backend | server/src/lib/account-store.ts:148-153 + api/auth/otp/send/route.ts:51-61 | OTP 发送限流仅按 **target** 计(60s 冷却/24h 10 次),无 per-IP/全局上限:攻击者轮换 target 即可无限耗用 Resend/阿里云配额(费用滥用) | 加 per-IP 与按账号/全局每日上限;多实例需共享存储(与现有守卫同属 demo 单实例假设) |
| 3 | Medium | backend | server/src/app/api/auth/password/login/route.ts:9-37 | 密码登录无任何限流/防爆破(OTP 有 5 错锁 15min,密码路径没有):可无限撞库;且 DB 路径「查无此人则不跑 scrypt」存在时间侧信道(account-store.ts:401-404 vs 406) | 按 IP+账号节流、统一 dummy verify 抹平耗时 |
| 4 | Medium | backend | server/src/lib/session-store.ts:57-62 | 会话 token HMAC 密钥回退为**公开常量** `'domain-map-demo-session'`;与 oauth-state.ts:20-27 的 boot 随机回退不一致;tech/27:69、environment-variables.md:55 均把 SESSION_SECRET 标为「可选/建议」,掩盖其会话完整性依赖 | 生产(NODE_ENV=production)缺 SESSION_SECRET 时拒绝签名/启动;demo 回退仅限非生产,并对齐两个模块策略 |
| 5 | Medium | docs | server/README.md:4,119,165,223,224,228,249,296,312 | server/README 大段过时:Next.js 15.5(现 16.3.1)、「600 tests/598 pass」(与根 README 568 互斥)、Known Limitations「OTP demo 000000 stub」(代码已删,全库 grep 0 命中)、「Single map engine AMap only」(tech/23 已三引擎+切换)、「write fallback 是已知加固项」(现写路径是抛 DB_UNAVAILABLE 503,设计如此)、`npm run lint` 不存在于 package.json、Last Updated 2026-08-19 | 按代码/根 README/CHANGELOG/tech/23-27 重写该文件状态段 |
| 6 | Medium | docs | CLAUDE.md:43 · agent.md:360 · CONTRIBUTING.md:49 · README.md:19 · CHANGELOG.md:13(568/566/2)vs tech/05-milestones.md:11(488)vs server/README.md:249(600) | 测试计数三处互斥且全部滞后:实际 102 个测试文件、1464 处顶层 `test(`(2026-08-21 后新增 agent/oauth/avatar/memory/saved 等大量测试,静态计数远超 568) | 跑一次 `cd server && npm test` 取权威值统一写回 6 处;约定「每次合入更新一行」 |
| 7 | Medium | docs | CHANGELOG.md(头部) | CHANGELOG 停在 2026-08-21,缺 2026-08-22/23 已合入工作:OAuth 登录(tech/27,批次 20260822-oauth-login)、阿里云短信 OTP(tech/26)、Agent Memory(018 迁移)、头像上传(017 迁移)、收藏图层开关、i18n 选项标签;该文件自述「tracks shipped work」 | 补 2026-08-22 条目(引用批次报告与 migrations 017/018) |
| 8 | Medium | docs | README.md:15,17,75 · tech/roles/data/data-quality.md:19 | 数据计数全部停在 2026-08-17 pilot 口径:「51 official-career + 98 radar」「669 companies/1440 sites/877 positions」「migrations 001–016」;实际:official-career 78、radar 646、qqdoc-official 142、qqdoc-jobs 163、embodied-jobs 46、migrations 001–018;README 数据源清单完全未提 qqdoc/embodied/feishu | 以当前 drops 与一次 `plan-seed-import` 实跑数为准更新 README 与 data-quality.md |
| 9 | Medium | data | server/data/recruitment/ 13 文件(`grep 证劵`);qqdoc-official/qq-中国一众集团.json:2-4;qqdoc-jobs/qqj-城堡证劵.json:2-3;radar/方联证劵.json:10 | `证劵`(应为「证券」)别字出现在 13 个 drop 的 slug+name(radar 11:财通/长江研究所/长城/第一创业/方联/平安/天风/华金/兴业集团/银河/中信南华;qqdoc-jobs 2:城堡/光大);新可疑转录错误:中国**一众**集团(official_url cfhi.com=中国一重,site 齐齐哈尔)、**城堡证劵**(Citadel Securities 官方中文名=城堡证券)、**方联**证劵(careerUrl wlzq.zhiye.com=万联证券);slug 即 poiId/siteId 入库 | 修正 name(显示)+ slug(保留旧 id 别名,016 site_key 作锚);同步扩展 D-20 台账(现仅记 4 处) |
| 10 | Medium | frontend | server/src/components/map-shell.tsx(3210 行) | D-18 未修且继续增长:2769(08-20)→ 2817(08-21)→ 3210(08-23);仍为仓库最大组件,30+ state/20+ ref 跨引用一致性是历史 bug(poi-mixing/StrictMode remount)温床 | 继续抽 hooks(agent 桥/收藏图层/搜索状态已有,下一步抽屉手势/缓存还原),component-contracts 门禁 |
| 11 | Low | backend | agent/chat/route.ts:57-64,86 | 限流按 `x-forwarded-for` 首段取 IP:客户端可直接伪造该头轮换桶 → 10 次/min 的 LLM 用量上限可绕过(费用滥用),且有 SSE 端点公开可达 | 仅信任可信代理注入的 XFF,或改按会话/固定指纹 + 登录限定 |
| 12 | Low | backend | api/pois/route.ts:37-43 | GET /api/pois 未做输入上限:q 无长度限制(POST /api/search 有 100 上限,GET 没有)、page/pageSize 未校验(负值/超大值先进缓存 key,之后才在 searchPublicCatalog 夹紧) | 对齐 POST /api/search 的 MAX_Q_LENGTH / pageSize 校验 |
| 13 | Low | backend | server/src/lib/public-cache.ts:80-82 | publicCacheKey 用 `\|` 拼接且不转义:组件值含 `\|`(filters JSON 可含)时 key 碰撞 → 不同查询命中同一缓存(值域受 4000 字符上限约束,实际风险低) | 改用 JSON 序列化或长度前缀编码 |
| 14 | Low | frontend | server/src/components/markdown-text.tsx:38-47 | 移动端 `window.location.href = naviRaw`(data-navi,LLM 输出直读)绕过 https 消毒路径直接赋协议字符串;虽受 amapuri:// 前缀约束(非脚本执行),但缺乏二次校验 | 赋值前用 buildNaviWebUrl 校验/重建 amapuri 参数 |
| 15 | Low | db | server/src/lib/spatial-query.ts:239-243 | city 过滤 `ILIKE '%北京%'` 前置通配符无法走 btree 索引(city_code 精确匹配可走索引);district ILIKE 同理;全国数据增长后是全表扫描 | 数据量到万级后补 pg_trgm GIN 或按 city_code 主路径收紧 |
| 16 | Low | crawler | crawler/app/domain_map_importer/acquire.py:143-152 | D-05 未修:robots.txt 网络异常/≥400 时 `robots_allows` 返回 True(允许抓取);「404/无 robots 允许」惯例与「网络异常/5xx 保守拒绝」口径待用户拍板 | 区分两类失败;该决定在 deferred-ledger D-05 |
| 17 | Low | backend | session-store.ts:156-169 · account-store.ts:401-404 | 登录账号存在性时间侧信道:内存路径用户不存在时全量扫描提前返回、DB 路径无行则跳过 scrypt,响应时间可区分「账号不存在」 | 无行时也执行一次 dummy verify(与 #3 同批) |
| 18 | Low | backend | api/auth/me/route.ts:44-48 | PATCH /api/me 的 displayName/avatarUrl 无长度/格式上限(displayName 直接入库并回显) | 加长度上限(如 50)与 avatarUrl 协议白名单 |
| 19 | Low | data | server/data/recruitment/radar/ 7 对同公司多 slug(4399/4399游戏、nvidia/nvidia英伟达、tp/tp-link、minimax/minmax、sharpa/sharpa-robotics、上海电气/上海电气集团、dexmai/dexmal-原力灵机)+ official-career/MiniMax vs radar/minimax 大小写不合并;merger 仍为精确 slug(recruitment-source.ts:236-254) | D-19 未修:同公司多 pin、聚合计数重复;合并口径需用户拍板(同官网/同品牌是否合并、以哪个 slug 为准) | 经用户确认后建 slug 别名表或按(名称归一,城市)合并;修后 import 计数联动 #8 |

## 发现详情

### #1 [High][backend] OTP 验证码单次性缺陷(DB 模式可重放)
- 位置:`server/src/lib/account-store.ts:695-730`,关键行 713-717(`UPDATE auth_otp_challenges SET consumed_at = now()` 后 `const succeeded = ok || memConsumeOtp(provider, normalized, code);` 短路)。
- 现状:DB 模式下 issueOtp 同时写内存与 DB(account-store.ts:668-681);consumeOtp 先查 DB,成功(`ok=true`)时**短路不调用 memConsumeOtp** → 内存挑战未删、仍有效 10 分钟。第二次携带同一 code 调用:DB 行已 consumed → `ok=false` → 转入 `memConsumeOtp` → 内存挑战命中 → **再次成功**。
- 问题:验证码不是一次性。同一验证码可在 TTL 内重复登录(otp/verify 建两个会话)、或先登录再用于改密(me/password OTP 分支)/绑手机(me/phone),违反单次消费契约;错 5 次锁定的暴力防护也不拦「真码重放」。
- 建议修法:成功路径无条件 `memConsumeOtp`(或统一以 DB 为权威,内存仅在无库模式生效);补契约测试「同一 code 二次 consume 必须 false(DB 模式)」。
- 影响面:所有 OTP 登录/改密/绑定流程。
- 需用户决策:否。

### #2 [Medium][backend] OTP 发送仅按 target 限流,轮换 target 可无限耗配额
- 位置:account-store.ts:148-153(OTP_COOLDOWN_MS/OTP_DAILY_LIMIT 按 `provider:target` key 的 otpGuards)+ otp/send route:51-61(任意合法 target 均接受并发送)。
- 现状:守卫 map 以 `provider:target` 为键;攻击者用不同手机号/邮箱轮换即可绕过 24h 10 次限制,持续触发 Resend 邮件 / 阿里云短信(计费)。无 per-IP、无每账号上限、无全局日上限。
- 建议:加 per-IP 桶 + 全局每日发送预算(超出 503/429),或本轮接受「demo 单实例」定位并在文档标注风险(tech/25/26 未提全局预算)。
- 需用户决策:否(若属成本控制策略变化则需确认上限数值)。

### #3 [Medium][backend] 密码登录无防爆破 + 账号存在性时间侧信道
- 位置:`api/auth/password/login/route.ts:9-37`(仅判空与 401);account-store.ts:401-406(DB 无行 → 跳过 verifyPassword 直接 null;内存路径 session-store.ts:162-165 同理)。
- 现状:OTP 路径有「15min ≥5 错 → 锁 15min」守卫,密码登录完全没有;撞库无任何节流。DB 查询无行时不跑 scrypt(约 50ms 差),可枚举用户名。
- 建议:路由加 per-IP/每账号滑动窗口(复用 otpGuard 风格);无行时执行 dummy verify 抹平耗时。
- 需用户决策:否。

### #4 [Medium][backend] SESSION_SECRET 公开常量回退 + 文档将其标注为「可选」
- 位置:session-store.ts:57-62(`const secret = process.env.SESSION_SECRET || 'domain-map-demo-session'`);对比 oauth-state.ts:20-27(未设 → boot 随机 bootSecret);tech/27:69「可选但生产建议」、server/docs/environment-variables.md:55。
- 现状:HMAC 密钥回退值是仓库内公开的固定字符串;两个「签名密钥」模块策略互相矛盾(一个公开回退、一个随机回退)。今日读路径为精确 token 匹配,该回退本身不可直接伪造会话(需先有已存 token),属**潜在**风险而非现成漏洞。
- 问题:(a) 任何未来「校验签名/客户端提供 token」的代码路径都会瞬间变成可伪造会话;(b) 文档把会话完整性的关键输入写成「建议项」,生产部署(tech/15)未把 SESSION_SECRET 列为必配。
- 建议:生产缺 SESSION_SECRET → signToken 抛错(或启动即失败);demo 回退改 boot 随机并与 oauth-state 统一;tech/15/27 与 environment-variables 改「生产必配」。
- 需用户决策:否(但生产值守属 Env-only 用户操作)。

### #5 [Medium][docs] server/README.md 大段事实过时(与根 README 互相矛盾)
- 位置:server/README.md:4(Next.js 15.5,现 16.3.1)、:119(`npm run lint`,package.json 无 lint script)、:165(「only AMap is implemented」,tech/23 已三引擎)、:223(Single map engine)、:224+296(OTP demo `000000` stub,全库 src grep 0 命中,D-04 已真发+删 hint)、:228(「write fallback 是已知加固项」,现写路径抛 DbUnavailableError 503,为设计决策)、:249(「600 tests/598 pass」与根 README 568、milestones 488 互斥)、:312(Last Updated 2026-08-19)。
- 影响面:新贡献者/Agent 以该文件为准时会得到 3 处错误预期(测试数、OTP 行为、引擎能力)。
- 建议:按 CHANGELOG/tech/23-27/根 README 重写状态段,或降级为「历史快照」并指向根 README。

### #6 [Medium][docs] 测试计数三处互斥且全部滞后
- 位置:568/566/2:CLAUDE.md:43、agent.md:360、CONTRIBUTING.md:49、README.md:19、CHANGELOG.md:13;488/486/2:tech/05-milestones.md:11(08-20);600/598/2:server/README.md:249。静态实证:102 个 `tests/*.test.mjs`、1464 处 `^test(` 顶层调用。
- 问题:自 08-21 后新增 agent(18 文件)/oauth/avatar/memory/saved-layer 等大量测试文件,任何一处 568 都早过期;三次漂移(423→477→488)后本次为第四轮——文档数字会失真于门禁判断。
- 建议:本轮先 `cd server && npm test` 取权威值,统一写回 6 处;并接受「单行常驻命令输出即事实」约定。

### #7 [Medium][docs] CHANGELOG 缺 2026-08-22/23 合入条目
- 位置:CHANGELOG.md 头部(最后节 2026-08-21);缺失工作证据:batch 目录 `tech/roles/development/parallel-sessions/20260822-oauth-login`、`20260822-aliyun-sms-otp`、`20260822-boss-saved-layer-toggle`、`20260822-boss-loading-hang`、`20260821-boss-agent-feature`、`20260821-boss-qqdoc-jobs`、`20260821-boss-embodied-jobs`、`20260821-boss-map-engine-rework`;migrations 017(avatar)/018(memories)。
- 影响面:违反「CHANGELOG tracks shipped work」契约;读者无法从 CHANGELOG 追溯最近合入。

### #8 [Medium][docs] README/数据口径计数全部停在 2026-08-17 pilot
- 位置:README.md:15(「51 official-career + 98 radar」「669 companies / 1440 sites / 877 positions, 0 issues, 0 dropped」)、:17/:75(「migrations 001–016」);tech/roles/data/data-quality.md:19(同 669/1440/877,Status 仍 2026-08-17)。实际文件:radar 646、official-career 78、qqdoc-official 142、qqdoc-jobs 163、embodied-jobs 46、migrations 001–018(017 avatar / 018 memories)。
- 问题:数据源清单(README:14-16)完全未提 qqdoc-official/qqdoc-jobs/embodied-jobs/feishu ATS 等已合入源;迁移范围少记 2 个;「0 dropped」等断言无法在当前 drops 上成立。
- 建议:以 `plan-seed-import` 一次实跑(只读 dry-run)的输出重写 README:14-17 与 data-quality.md;迁移范围改 001–018。

### #9 [Medium][data] `证劵` 别字扩散(13 文件)+ 3 个新疑似转录错误
- 位置:13 文件清单见清单表;典型:radar/华金证劵.json:2,4、qqdoc-jobs/qqj-城堡证劵.json:2-3、qqdoc-jobs/qqj-光大证劵.json;新增:qqdoc-official/qq-中国一众集团.json:2-4(official_url `http://www.cfhi.com/yizhonggroup/...`=中国一重,site 齐齐哈尔市)、radar/方联证劵.json:10(careerUrl `wlzq.zhiye.com`=万联证券)。
- 现状:D-20 台账只登记 4 处(akuna-capitai/doiphindb/hrnetgronp/中信证劵南华),本轮发现同类问题已扩散至 13+3 处;slug 即 poiId/siteId,修正需别名兼容(016 site_key 可作锚);「方联」与「一众」为疑似,需人工核对方可定案。
- 建议:数据修正批次(用户拍板改名与旧 id 别名策略);import 校验器加「常见错词表」断言(证劵→证券、一众→一重 等)防复发。
- 需用户决策:**是**(改名是否影响已保存/投递引用;疑似项需人工确认)。

### #10 [Medium][frontend] map-shell 3210 行持续增长(D-18 恶化)
- 位置:server/src/components/map-shell.tsx(3210 行;旧扫描记录 2769@08-20 / 2817@08-21)。
- 现状:已陆续抽出 useWorkViewport/useSearchState/useSavedLayer/useModeCacheRestore/usePOIMap/useMapEngine,但组件仍承载 agent 桥、抽屉手势、账户编排、收藏图层等;本轮净增 393 行(相对 08-21)。
- 建议:继续按职责抽 hook(抽屉手势/代理桥/收藏图层渲染),component-contracts 门禁;deferred-ledger D-18 状态行数字应更新。

### #11-#19 [Low] 明细
- #11 代理聊天限流:`x-forwarded-for` 客户端可伪造(agent/chat/route.ts:57-64),10 req/min/IP 桶可绕过;建议仅信任代理注入或按会话限流。
- #12 GET /api/pois 输入无上限(route.ts:37-43):q 长度、page/pageSize 与 POST 不一致;建议对齐。
- #13 publicCacheKey `|` 拼接不转义(public-cache.ts:80-82)存在 key 碰撞可能(受 4000 字符上限约束,风险低)。
- #14 markdown-text.tsx:43-46 移动端将 LLM 输出的 data-navi 直接赋 `window.location.href`(amapuri 协议),建议先经 buildNaviWebUrl 校验。
- #15 spatial-query.ts:240-242 city ILIKE 前置通配符无法走索引;数据增大后建议 pg_trgm GIN。
- #16 acquire.py:143-152 robots 失败默认允许(deferred-ledger D-05,待用户拍板)。
- #17 登录时间侧信道(见 #3 附注)。
- #18 PATCH /api/me displayName/avatarUrl 无长度与协议校验(me/route.ts:44-48)。
- #19 radar/official 同公司多 slug(unfixed D-19,recruitment-source.ts:236-254 精确匹配;7 对 + 跨源大小写不合并;合并口径需用户决策)。

## 建议修复批次(供 boss 审批)

- **批次 A(安全,1 个 worktree)**:#1(OTP 单次消费 + 契约测试)#2(OTP 发送全局限流)#3(密码登录限流 + dummy verify)#4(SESSION_SECRET 生产必配/回退随机)。
- **批次 B(API 边界,可与 A 同批或独立)**:#11 #12 #13 #18。
- **批次 C(文档事实同步)**:#5(server/README 重写)#6(测试计数统一,先实测)#7(CHANGELOG 补 08-22)#8(README/data-quality 数据口径,先 dry-run plan-seed-import)。
- **批次 D(数据修正,需用户先拍板)**:#9(13+3 处名称/slug 修正 + 错词校验器)、#19(slug 合并口径)。修后 import 计数联动 #8。
- **延续项(不新派,追踪)**:#10(D-18 map-shell 拆分)、#16(D-05 robots 策略)、#15(索引,数据量达标时)。
- **需用户决策(暂不派)**:#9(改名与旧 id 别名;疑似项人工核对)、#19(同官网/同品牌是否合并、以哪个 slug 为准)、#16(robots 失败口径)、#2(全局发送预算数值)。
