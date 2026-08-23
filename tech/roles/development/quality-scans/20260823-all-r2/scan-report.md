# 质量扫描报告(2026-08-23 · scope: all · r2)

## 摘要

- **扫描对象与规模**:全库只读。dev tip 72cf016(相对 r1 e091382 新增 `20260823-boss-poi-datasource` 批次:ws-a 多城市列表串判定 / ws-b Nominatim 海外第四源 / ws-c daily 进度封装 / ws-d r5 runbook)。`server/src` 172 文件(19 路由 / 92 lib / 24 components / 8 hooks 等,含新增 `site-geocode.ts` Nominatim 段 1553-1838、`scripts/geocode-sites-daily.mjs`、`audit-city-center-pins.mjs`);`server/tests` 108 文件(1503 处顶层 `test(`;文档权威值 1487 tests / 1485 pass / 2 skip);`crawler` 10 py(103 个 `def test_`);`db/migrations` 001–018;drops:radar 646 / official-career 78 / qqdoc-official 142 / qqdoc-jobs 163 / embodied-jobs 47(实测计数,与根 README 一致);`tech/` 40+ 篇 + 批次目录 + `.claude/skills`。
- **发现总数:13**,按严重度 **High 0 / Medium 4 / Low 9**。
- 按类别:backend 4 / data 2 / docs 4 / frontend 2 / db 1。
- **r1(20260823-all)修复抽验**:17 项技术项中 **14 项已修并抽验落点**(OTP 单次消费 / per-IP+per-账号 OTP 桶 / 密码登录限流+dummy verify / SESSION_SECRET 生产必配 / server-README 重写 / 测试计数 6 处统一 1487 / CHANGELOG 补 08-22-23 / README+data-quality 数据口径 / agent-chat TRUSTED_PROXY_IPS / pois 输入上限 / publicCacheKey 长度前缀 / me 路由上限 / dummy verify 双侧);**#14(markdown navi)、#15(ILIKE 索引)未修**(低风险,沿用追踪);**#10(map-shell)仍在但略降**;r1 需用户决策项(#9 别字、#16 robots、#19 slug 合并、#2 全局预算)按 boss-state 沿用 deferred,不重派。本轮新发现集中在 **r2 新增的 Nominatim 路径**(UA 合规 / 无 memo / q 无上限)、**XFF 信任策略不一致**(agent-chat 已加闸,otp/password 未加)、**embodied-jobs 名称实锤错误 2 处 + 疑似 2 处**(扩展 D-20)、**deploy/architecture 文档迁移范围与 SMS 表述过时**。

## 发现清单(按严重度排序)

| # | 严重度 | 类别 | 位置(file:line) | 问题 | 建议 |
|---|--------|------|-----------------|------|------|
| 1 | Medium | backend | otp/send/route.ts:147-154 · password/login/route.ts:92-99(对照 agent/chat/route.ts:42-51) | r1 #11 修 agent-chat 时加了 `TRUSTED_PROXY_IPS` 闸,但 OTP 发送与密码登录的 per-IP 桶仍直信客户端可伪造的 `x-forwarded-for` 首段:轮换 XFF → 换桶 → per-IP 20/24h 上限可绕过,付费短信/邮件配额滥用(r1 #2 仅部分缓解) | 三路由统一走 `TRUSTED_PROXY_IPS` 闸(未配置时忽略转发头,桶键改会话指纹/固定桶);补契约测试 |
| 2 | Medium | data | embodied-jobs/embj-上海市交通大学.json:2-4,16 · embj-北京市大学.json:2-4,18 · qqdoc-jobs/qqj-北京润料.json:2-3,7 · qqj-OCC欧晰折咨询.json:2-3 | **实锤 2 处**:「上海市交通大学」(careerUrl postd.sjtu.edu.cn=上海交通大学)、「北京市大学」(postdocs.pku.edu.cn=北京大学)——显示名即错,slug 即 poiId/siteId 已入库;**疑似 2 处**:「北京润料」(mokahr 租户 runketongyong=润科通用)、「OCC欧晰折咨询」(OC&C 官方中文名=欧晰析)——均为 D-20 转录错误同类,台账未收录 | 修正 name(保留旧 slug 别名,016 site_key 作锚);疑似项人工核对;扩展 D-20 台账(见 #8) |
| 3 | Medium | docs | tech/15-deploy.md:52,68 · tech/01-architecture.md:70 | 迁移范围仍写 `001–016`(现 001–018,017 avatar / 018 memories);deploy「What is not deployed」仍写「No real SMS / email」——OTP 已经 Resend/阿里云真发(2026-08-22,tech/25/26),仅岗位提醒仍 queue-only | 改 001–018;SMS/email 表述改为「OTP 已真发,岗位提醒仍仅入队」 |
| 4 | Medium | frontend | server/src/components/map-shell.tsx(~3055 行) | r1 #10 追踪:较 r1(3210)略降 ~150 行,仍是仓库最大组件(30+ state / 20+ ref),历史 bug(poi-mixing/StrictMode remount)温床 | 继续抽 hook(抽屉手势/账户编排);batch 内不新增逻辑 |
| 5 | Low | backend | server/src/lib/site-geocode.ts:1574 | Nominatim UA `'DomainMap/1.0 (job-map contact)'` 不符合 OSM Usage Policy(要求可验证的联系方式/应用 URL);公共实例可能封 IP,海外路径(41-114 站)整体失效 | 换真实联系邮箱/URL(常量,用户提供);合并前按政策核对 |
| 6 | Low | backend | site-geocode.ts:1658-1691(对照 :473-475) | Nominatim 检索路径无 memo:国内路径有 `placeSearchMemoKey`(query+province+city)复用成功命中,海外路径同公司同城多站点(如 安克创新多海外站)逐站重复打 OSM 公共服务 | 加同构 memo(只缓存成功命中),或至少同 (query,city) 去重 |
| 7 | Low | backend | site-geocode.ts:1663-1669 | `nominatimSearchRest` 的 q 无长度上限(Nominatim 建议 ≤256 字符);超长 → 400 → unresolved,行为优雅但产生噪音 | q > 256 截断或直接放弃地址段 |
| 8 | Low | data | tech/roles/development/deferred-ledger.md:33 | D-20 台账仍只列 4 处(akuna-capitai/doiphindb/hrnetgronp/中信证劵),r1 已实证 13 文件 `证劵` + 3 处转录错误,本轮又 +2 实锤 2 疑似——台账与扫描报告脱节 | 台账补全清单或引用各轮 scan-report;#2 决策时一并处理 |
| 9 | Low | docs | .claude/skills/frontend-component-dev/skill.md:8,34,44 | 并行开发 skill 过时:「Next.js 15」(现 16.3.1)、「Keep POST /api/auth/otp/send for Aliyun SMS later」(已真发)、「Next 15 rejects ssr:false」版本标签旧——Agent 照此开发得到错误预期 | 版本标签与 OTP 表述对齐 CHANGELOG/tech/25/26 |
| 10 | Low | docs | tech/README.md:33-35 | 文档编号重复:26-aliyun-sms.md 与 26-agent-memory.md 同为 `26`,索引两行并列易混淆 | 后者改 30(或 26b),同步 CHANGELOG 引用处 |
| 11 | Low | frontend | server/src/lib/contrast.ts:22-34(全库仅 tests/contrast.test.mjs 引用) | 死代码:生产代码零引用(对比度 token 已入 globals.css/i18n) | 删除文件与测试,或注释标注为「token 文档」 |
| 12 | Low | frontend | server/src/components/markdown-text.tsx:38-47 | r1 #14 未修:移动端 `window.location.href = naviRaw` 直赋(data-navi 仅含经 buildNaviWebUrl 校验的 amapuri URI,风险有限) | 赋值前再走一次 buildNaviWebUrl 重建(双保险) |
| 13 | Low | db | server/src/lib/spatial-query.ts:237-243 | r1 #15 未修:city 过滤 `ILIKE '%北京%'` 前置通配符无法走 btree(city_code 精确分支可走索引);数据量到万级后全表扫描 | 数据量达标后补 pg_trgm GIN 或按 city_code 主路径收紧 |

## 发现详情

### #1 [Medium][backend] XFF 信任策略不一致:OTP/密码登录 per-IP 桶可被伪造头绕过
- 位置:`server/src/app/api/auth/otp/send/route.ts:147-154`、`server/src/app/api/auth/password/login/route.ts:92-99`(两处 `clientIp` 均取 `x-forwarded-for` 首段);对照 `server/src/app/api/agent/chat/route.ts:42-51`(`TRUSTED_PROXY_IPS` 配置时方信任转发头)。
- 现状:r1 #11 修复只在 agent-chat 落地了代理信任闸;OTP 发送与密码登录的 per-IP 守卫(r1 #2 新增,`checkOtpSendLimits` ipGuard 20/24h、登录 ipGuard 20/15min)仍以请求头直取 IP。客户端直连 Next 时伪造/轮换 XFF → 每次换新桶 → per-IP 上限形同虚设;per-target 与 per-账号桶(未绑定 target 时即 per-target)均可随 target 轮换绕过。影响:付费 Resend/阿里云短信配额可被持续耗尽(原 r1 #2 的全局费用滥用仅部分缓解)。
- 建议修法:三路由统一 `TRUSTED_PROXY_IPS` 语义(未配置 → 忽略转发头,桶键用会话指纹/固定桶,与 agent-chat 同构);补「伪造 XFF 不换桶」契约测试。
- 影响面:OTP 发送、密码登录、agent-chat 三处限流语义一致性。
- 需用户决策:否(但生产部署需在反代层清洗转发头,属 Env-only 操作)。

### #2 [Medium][data] embodied-jobs 名称实锤错误 2 处 + 疑似 2 处(D-20 同类)
- 位置:`server/data/recruitment/embodied-jobs/embj-上海市交通大学.json:2-4`(slug/name)+ `:16`(careerUrl `postd.sjtu.edu.cn`=上海交大博士后);`embj-北京市大学.json:2-4` + `:18`(careerUrl `postdocs.pku.edu.cn`=北京大学博士后);`qqdoc-jobs/qqj-北京润料.json:2-3` + `:7`(apply_url mokahr 租户 `runketongyong`=润科通用);`qqdoc-jobs/qqj-OCC欧晰折咨询.json:2-3`(OC&C 官方中文名「欧晰析」)。
- 现状:前两处由 careerUrl 域名实锤「名称与实体不符」(显示名错、site.name 错);后两处为高置信疑似(租户名/行业通名佐证),需人工核对。slug = poiId/siteId 已入库,改名需旧 id 别名(016 site_key 可作锚)。`证劵` 13 文件(r1 #9)本轮持平未恶化。
- 建议修法:数据修正批次(用户拍板改名 + 别名策略),与 r1 #9 合并执行;import 校验器加常见错词断言表(证劵→证券、一众→一重、市交通→交通?——错词表需人工维护)。
- 需用户决策:**是**(改名影响已保存/投递引用;疑似项需人工确认)。

### #3 [Medium][docs] deploy/architecture 迁移范围与 SMS/email 表述过时
- 位置:`tech/15-deploy.md:52`(`make db-migrate # 001–016`)、`:68`(「No real SMS / email. Inbox rows stay queued.」)、`tech/01-architecture.md:70`(「migrations (001–016, live-applied)」)。
- 现状:迁移实际 001–018(017 avatar / 018 memories);OTP email/phone 已真发(Resend/阿里云短信,2026-08-22,tech/25/26,环境变量文档已同步)。deploy 文档仍按 08-16/08-17 状态描述,与 README:17/19、data-quality.md:25 矛盾。
- 建议修法:改 001–018;「What is not deployed」的 SMS/email 行改为「岗位提醒仍仅入队(OTP 已真发)」。
- 需用户决策:否。

### #4 [Medium][frontend] map-shell 仍为最大组件(r1 #10 追踪)
- 位置:`server/src/components/map-shell.tsx`(~3055 行,空行不计;r1 口径 3210)。
- 现状:较 r1 略降(净减 ~150 行),但仍是仓库最大组件;30+ state / 20+ ref 跨引用一致性是历史 bug 温床(poi-mixing / StrictMode remount 均源于此)。
- 建议:继续按职责抽 hook(抽屉手势/账户编排/缓存还原),component-contracts 门禁;deferred-ledger D-18 状态行数字更新。
- 需用户决策:否。

### #5-#13 [Low] 明细
- #5 Nominatim UA 联系信息非真实可验证(`'DomainMap/1.0 (job-map contact)'`,site-geocode.ts:1574),OSM 政策要求有效 contact,公共实例有封 IP 风险;需用户提供真实邮箱/URL 常量。
- #6 Nominatim 路径无 place-search memo(国内路径有,site-geocode.ts:473-475);同公司同城多海外站重复请求 OSM 公共服务。
- #7 `nominatimSearchRest` q 无长度上限(建议 ≤256);超长返回 400 → unresolved,优雅但噪音。
- #8 deferred-ledger.md:33 D-20 台账未同步 r1 的 13 文件证劵清单与 r2 新实例,决策信息不全。
- #9 `.claude/skills/frontend-component-dev/skill.md:8,34,44` 版本/OTP 表述过时(Next.js 15 / 「Aliyun SMS later」);Job-alerts 段(:39)仍正确(仅入队),勿误改。
- #10 tech/README.md:33-35 两个 `26`(26-aliyun-sms / 26-agent-memory)编号重复。
- #11 `server/src/lib/contrast.ts` 生产零引用(仅 tests/contrast.test.mjs),死代码。
- #12 markdown-text.tsx:38-47(r1 #14 未修):移动端 data-navi 直赋 `window.location.href`;数据源已被 buildNaviWebUrl 校验,残余风险低,建议双保险。
- #13 spatial-query.ts:237-243(r1 #15 未修):city ILIKE 前置通配符无索引可走,数据量到万级后优化。

## r1 修复抽验记录(供 boss 核对)

| r1 # | 结论 | 落点证据 |
|---|---|---|
| #1 OTP 单次消费 | ✅ 已修 | account-store.ts:798-805 成功路径无条件 `memConsumeOtp` |
| #2 OTP 全局限流 | ✅ 已修(残留见本轮 #1) | account-store.ts:245-269 `checkOtpSendLimits`(per-IP 20/24h + per-账号 10/24h,计数先于发送) |
| #3 密码登录限流 | ✅ 已修 | password/login/route.ts:29-60(per-账号 5/15min + per-IP 20/15min + dummy verify) |
| #4 SESSION_SECRET | ✅ 已修 | session-store.ts:80-88(生产抛错/非生产 boot 随机);docs env-variables:52-56,222、tech/15:76-78 同步 |
| #5 server/README | ✅ 已修 | 头部重写,1487 测试/三引擎/OTP 真发;残留见本轮 #3 |
| #6 测试计数 | ✅ 已修 | CLAUDE.md:43 / agent.md:360 / CONTRIBUTING.md:49 / README.md:19 / milestones:11 / server-README:120,243 统一 1487 |
| #7 CHANGELOG | ✅ 已修 | 08-22/08-23 条目已补 |
| #8 数据口径 | ✅ 已修 | README:15-17 + data-quality.md:20-25 与实测一致(radar 646 等) |
| #10 map-shell | ⚠️ 改善中 | 3210 → ~3055 行,仍追踪(本轮 #4) |
| #11 agent-chat XFF | ✅ 已修 | agent/chat/route.ts:42-51 TRUSTED_PROXY_IPS;不一致见本轮 #1 |
| #12/#13/#18 API 边界 | ✅ 已修 | pois/route.ts:34-79 / public-cache.ts:80-112 / me/route.ts:13-77 |
| #14 markdown navi | ⏳ 未修(低) | 本轮 #12 |
| #15 ILIKE | ⏳ 未修(低) | 本轮 #13 |
| #17 时间侧信道 | ✅ 已修 | session-store.ts:26-29 + account-store 双侧 dummy verify |
| #9/#16/#19 | ⏳ deferred | 用户决策项,沿 boss-state 指引 |

## 建议修复批次(供 boss 审批)

- **批次 A(后端限流一致性,1 worktree)**:#1(三路由统一 TRUSTED_PROXY_IPS + 契约测试)、#6(Nominatim memo)、#7(Nominatim q 上限)。
- **批次 B(数据名称,需用户先拍板)**:#2(embodied 2 实锤 + 2 疑似 + 与 r1 #9 证劵 13 文件合并执行)、#8(D-20 台账扩展)。
- **批次 C(文档事实同步)**:#3(deploy/architecture 迁移范围 + SMS/email 表述)、#9(frontend-component-dev skill)、#10(tech/README 编号)。
- **批次 D(清理,可并入 A/C)**:#11(contrast.ts 删除或标注)。
- **延续项(不新派,追踪)**:#4(map-shell 拆分,D-18)、#12(r1 #14 navi)、#13(r1 #15 ILIKE,数据量达标时)。
- **需用户决策(暂不派)**:#2(改名与旧 id 别名;疑似项人工核对)、#5(Nominatim UA 真实联系方式值)、r1 #9(证劵改名)、r1 #16(robots 失败口径)、r1 #19(slug 合并口径)、r1 #2(全局发送预算数值)。
