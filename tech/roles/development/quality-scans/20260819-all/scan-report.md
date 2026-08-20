# 质量扫描报告(2026-08-19 · scope: all)

> 状态追踪见 20260820-all 复核段(quality-scans/20260820-all/scan-report.md「上轮复核」+「修复状态回填」)。

## 摘要

- 扫描对象与规模:全库 —— `tech/**` 171 个 md、根文档(README/CHANGELOG/CONTRIBUTING/agent/CLAUDE)、`.claude/skills/`、`server/src`(lib 33 文件 / components 18 文件 / app 17 路由 / hooks / 24 个测试)、`crawler/app`(10 文件 + 6 测试)、`db/migrations`(001–016)、`server/data/recruitment`(radar/official-career/boss/nowcoder/shixiseng drops)、`tech/roles/data/`(data-quality/etl/批次目录)。合计约 480 个源/文档/数据文件。
- 发现总数:**16**,按严重度 **High 2 / Medium 5 / Low 9**。
- 按类别:文档 4 / 前端 3 / 后端 6 / 数据库 2 / 数据 1。
- 与先前 docs 扫描的关系:20260819-docs(27 条)的发现**全部仍未修复**(同一工作树,证据见 #2),本报告不重复展开,只做状态确认与新增发现;本次新发现集中在代码侧(DB 索引未使用、OTP 安全、静默降级、死代码)与最新数字漂移(测试计数 288→299)。

## 发现清单(按严重度排序)

| # | 严重度 | 类别 | 位置(file:line) | 问题 | 建议 |
|---|--------|------|-----------------|------|------|
| 1 | High | db | db/migrations/011_national_scope.sql:17-24 + server/src/lib/spatial-query.ts:181 | 011 建的 `company_sites.geom_geog` STORED 列 + gist 索引(gist && / ST_DWithin 约定)在查询中**从未被使用**:全部距离裁剪走 `ST_DWithin(s.geom::geography, …)` cast 表达式,无法命中 geom_geog 索引;全 src grep 无 `geom_geog` 引用 | SQL 改用 `s.geom_geog` 或补建 `(s.geom::geography)` expression index;`&&` bbox 继续用 `s.geom`(006:46 已有 gist) |
| 2 | High | docs | tech/roles/development/quality-scans/20260819-docs/scan-report.md(27 条)+ README.md:19,24,17 | 先前 docs 扫描 27 条(README 185 tests / "No external source acquisition" / 迁移 001–010 / CONTRIBUTING 脚手架态等 High 条目)逐条复核仍在原状,未修复 | 按 docs 扫描建议批次派 worker 修复;本报告不再重复 27 条明细 |
| 3 | Medium | docs | CLAUDE.md:43 vs CHANGELOG.md:18 vs tech/16-bug-fixes.md:632 vs parallel-sessions/20260819-mobile-ux/boss-state.md:36 | 测试计数四处漂移:CLAUDE.md「288 测试(2026-08-19)」、CHANGELOG「297 通过/0 失败」、16-bug-fixes「297 通过(2 跳过)」、boss-state「299 tests/297 pass/0 fail」;b2-u1-u6/merge-report.md:41 曾建议同步 CLAUDE.md 但未落实 | 跑一次 `cd server && npm test` 取权威值,统一写回 CLAUDE.md / CHANGELOG / README |
| 4 | Medium | backend | server/src/app/api/auth/otp/send/route.ts:21-36 + otp/verify/route.ts | OTP 无速率限制、无尝试次数上限,且响应直接回显 `hint: '000000'`(demo 固定码):任何知道目标手机/邮箱的人可直接登录该账号;无限 send 会无限写 auth_otp_challenges(仅 consume 时清过期) | 上线前接入真实发送(去 demo hint);至少按 target 限流 + 尝试次数上限 + 过期清理任务 |
| 5 | Medium | backend | server/src/lib/account-store.ts:100-111 | `withDb` 对所有非 UsernameTakenError 的 DB 错误 console.warn 后静默降级内存实现:DB 故障时收藏/投递/会话在内存与 DB 间分裂,保存看似成功实则丢失,用户无感知 | 写路径(收藏/投递/历史)DB 错误应返回 5xx 而非静默降级;读路径可保留降级 |
| 6 | Medium | frontend | server/src/components/map-shell.tsx:215-330,2822 行 | 单组件 2822 行、30+ state、20+ ref、12+ effect;历史 Bug 7/poi-mixing 均源于此处的跨 ref 状态一致性 | 将地图控制器/视口加载/搜索状态拆为独立 hooks 或模块 |
| 7 | Medium | backend | server/src/app/api/search/route.ts:38-64 + src/lib/recruitment-store.ts:108-158 | 无 bounds 的搜索每次全量加载 3 张表(companies/sites/positions,全国 672 公司),缓存 key 含完整 filters JSON 无大小上限;全国规模下每个不同 q+filter 组合都绕过 30s 缓存全量重建 | 对 q/filters 长度设上限;无 bounds 时也限制返回或走专用聚合查询 |
| 8 | Low | frontend | server/src/lib/modes.ts:190-203 | `MODES.internship` 死代码:canonicalMode(:297) 恒把 internship→work,getMode 永不读 MODES.internship;grep 无任何引用,与 work 定义完全重复 | 删除 internship 条目(类型兼容由 canonicalMode 保证) |
| 9 | Low | frontend | server/src/lib/api.ts:12,90,125 | `fetchPOIs`/`fetchModes` 导出无任何调用方(src+tests);头部注释「Phase 2 使用 seed/AMap 数据,DB 就绪后无缝切换」「GET /api/search」均过时(已在用 DB;search 是 POST) | 删除死导出;注释改为当前契约 |
| 10 | Low | backend | server/src/app/api/suggest/route.ts:32 + search/route.ts:38 | q/center/filters 无输入长度上限:超长 q 进入全 catalog 匹配循环(669 公司 × 岗位),超大 body 进缓存 key | 对 q(如 ≤100)与 body 大小设上限,超限 400 |
| 11 | Low | backend | server/src/app/api/me/notifications/route.ts:13-36 | POST 无 body、无节流:可被反复触发全量 job-alert 扫描 + enqueue(有 ON CONFLICT 防重行,但仍全量计算) | 加冷却(如 60s/用户)或幂等参数 |
| 12 | Low | backend | server/src/app/api/me/saved/route.ts:33-39 | name/poiId 无长度上限,lng/lat 无范围校验(-180..180 / -90..90) | 按 account.ts 的 sanitize 风格加边界校验 |
| 13 | Low | db | crawler/app/domain_map_importer/acquire.py:143-152 | robots.txt 获取失败(网络/超时)时 `robots_allows` 返回 True(允许抓取);「polite acquisition」契约下更保守应为拒绝 | 改为失败即拒(与 blocked_host 同路径返回 blocked_by) |
| 14 | Low | docs | tech/roles/data/data-quality.md:21-29 vs 44-50 | 「Live apply not yet run on the national drops」与「geocode apply 65/86 → 79 pins」两段并存,未标注范围(全国 vs 杭州 pilot),易被读成矛盾 | 加「范围:杭州 pilot」/「范围:全国 drops」标注与时间线 |
| 15 | Low | data | server/data/recruitment/radar/腾讯.json:13,21,29,37 | 多城市 site 的 name 为占位名「腾讯—剩余岗位」,4 个站点同名同地址文本("北京/上海/广州/深圳"),无坐标;全国 drops 过渡态,展示质量低 | geocode:sites:apply 落坐标后,站点名按城市/办公点补真实名称(或读路径按 city 派生) |
| 16 | Low | docs | tech/roles/development/parallel-sessions/20260819-b2-u1-u6/ | 批次目录仅 merge-report.md,缺 README manifest/prompts/reports(违反 CLAUDE.md 批次约定;merge-report:3 说明汇报系内联) | 补 manifest 或加说明(与 docs 扫描 #22 同项,确认未修) |

## 发现详情

### #1 [High][db] geom_geog gist 索引建成但查询从未使用
- 位置:db/migrations/011_national_scope.sql:17-24(列+索引定义);server/src/lib/spatial-query.ts:181(实际查询)。
- 现状:011 生成 `geom_geog geography STORED` 列并建 `company_sites_geog_gist USING gist (geom_geog)`,注释明确「ST_DWithin(geom_geog, point, meters) 按米算」;但 recruitment-store/spatial-query 全链路唯一距离裁剪是 `ST_DWithin(s.geom::geography, ST_SetSRID(...)::geography, $)`(spatial-query.ts:180-182),全 src grep `geom_geog` 零引用。
- 问题:`s.geom::geography` 是 cast 表达式,PostgreSQL 无法用 geom_geog 列上的 gist 索引加速 → 带距离筛选(radius)的查询对 company_sites 全表扫描 + 逐行 cast。全国 1440 sites 规模下每次距离排序/筛选都 seq scan;项目「gist && + ST_DWithin」约定在半径路径上实际未生效。
- 建议修法:SQL 改用 `s.geom_geog`(STORED 列,免 cast,命中索引);bbox `&&` 继续用 `s.geom`(006:46 gist 已覆盖)。修后跑 `EXPLAIN` 验证 radius 查询走 index scan。
- 影响面:工作模式距离筛选/距离排序服务端路径(全国规模后的主查询之一)。
- 需用户决策:否。

### #2 [High][docs] 先前 docs 扫描 27 条全部未修复
- 位置:quality-scans/20260819-docs/scan-report.md 全文;复核点 README.md:19(仍「185 tests pass」)、README.md:24(仍「No external source acquisition」)、README.md:17(仍「001–010」)、CONTRIBUTING.md:3(仍「does not yet contain a runnable application」)。
- 现状:今天早间的 docs 扫描报告 27 条(High 7 / Medium 10 / Low 10)生成后工作树未变,逐条抽查关键行仍为旧文本。
- 问题:报告已产出但未派发修复,README/CONTRIBUTING/agent.md 对读者与 Agent 的误导持续存在。
- 建议修法:按该报告建议批次 A–D 派 worker;本 [all] 扫描不再重复 27 条明细,直接引用。
- 影响面:贡献者/Agent 的仓库状态判断、验收口径。
- 需用户决策:否(纯文档修正)。

### #3 [Medium][docs] 测试计数四处漂移(288/297/299)
- 位置:CLAUDE.md:43(「288 测试(2026-08-19)」);CHANGELOG.md:18(「+3(297 通过/0 失败)」);tech/16-bug-fixes.md:632(「297 通过 / 0 失败(2 跳过)」);parallel-sessions/20260819-mobile-ux/boss-state.md:36(「299 tests/297 pass/0 fail」)。
- 现状:2026-08-19 的 mobile-ux 批次合并后 dev HEAD 已到 299 tests / 297 pass / 2 skip;CLAUDE.md 仍写 288,README 更旧(185,见 docs 扫描 #2)。
- 问题:数字不一致会让验收与 Agent 门禁判断失真;b2-u1-u6/merge-report.md:41 的「收尾时同步 CLAUDE.md 计数」建议未落实。
- 建议修法:`cd server && npm test` 取权威值,同步 CLAUDE.md / CHANGELOG / README / tech/16。
- 影响面:验收口径、Agent 自检判断。
- 需用户决策:需先由主 Agent 跑一次测试确认权威值(只读扫描不执行测试)。

### #4 [Medium][backend] OTP 流程无速率限制且 demo 固定码回显
- 位置:server/src/app/api/auth/otp/send/route.ts:21-36(hint: '000000');otp/verify/route.ts:5-29(consumeOtp 无次数上限);account-store.ts:340-377。
- 现状:send 校验 target 格式后直接 issueOtp(固定 DEMO_OTP_CODE=000000)并把 `hint: '000000'` 写进响应;verify 只按 code_hash 比对,无尝试次数限制;挑战行仅 consume 时清理过期。
- 问题:任何知道目标手机号/邮箱的人可凭回显码直接登录(或注册)该账号;无节流的 send 可无限写 auth_otp_challenges(表膨胀)。这是已注释的 demo 行为,但属上线前必须收口的安全项。
- 建议修法:接入真实发送后删除 hint;在此之前按 target 限流(如 1 次/60s、10 次/日)+ verify 尝试上限(如 5 次锁 15 分钟)+ 定期清理过期挑战。
- 影响面:账号安全、DB 卫生。
- 需用户决策:是(何时接入真实 SMS/邮件发送属于产品决策;限流本身可直接做)。

### #5 [Medium][backend] withDb 静默降级造成 DB/内存数据分裂
- 位置:server/src/lib/account-store.ts:100-111。
- 现状:所有操作包在 withDb 中,除 UsernameTakenError 外任何 DB 错误(网络/权限/表缺)→ console.warn 后走内存 session-store 实现,调用方收到 200。
- 问题:DB 故障瞬间,收藏/投递/历史的写入落在内存,随后进程重启即丢;DB 恢复后内存与 DB 两份数据并存,用户无法分辨哪份生效。读路径降级合理,写路径静默降级危险。
- 建议修法:写操作(savePlace/recordApplication/enqueueNotification/addHistory/updateUser)DB 错误时抛 5xx 或明确降级标记;读操作保留 fallback。
- 影响面:账号数据可靠性。
- 需用户决策:否。

### #6 [Medium][frontend] map-shell 巨型组件
- 位置:server/src/components/map-shell.tsx:215-330(state/ref 密集区,文件 2822 行)。
- 现状:单一组件承载地图初始化、视口加载器、搜索/建议、抽屉手势、账户/收藏/投递/收件箱、模式缓存、移动端 sheet 等全部逻辑。
- 问题:30+ state 与 20+ ref 的跨引用一致性是历史 Bug 7(列表冻结)/poi-mixing(跨模式污染)的温床;测试对纯函数覆盖好但对组件内状态机覆盖弱。
- 建议修法:视口加载/搜索/缓存还原抽成独立 hooks(map 生命周期与 UI 状态分离),组件只做编排。
- 影响面:可维护性与缺陷密度。
- 需用户决策:否(重构需按 CONTRIBUTING 流程验证)。

### #7 [Medium][backend] 无 clip 搜索全量装载 + 缓存 key 无上限
- 位置:server/src/app/api/search/route.ts:38-64;server/src/lib/recruitment-store.ts:108-158。
- 现状:POST /api/search 的 bounds 可选;无 bounds 时 loadServerCatalog 无 clip → 三张表全量(672 公司/1440 sites/877 positions 规模)每次重建 catalog;缓存 key 拼 `JSON.stringify(body.filters)` 无长度上限。
- 问题:全国规模后每个不同 q+filter+sort 组合都触发全量 DB 读(虽有 30s 内存缓存,但组合多时命中率低);超长 body 会生成超大 key。
- 建议修法:q ≤ 100 字符、filters 深度/长度限制(400);无 bounds 的搜索可限制 pageSize 或走预聚合。
- 影响面:搜索延迟与 DB 负载。
- 需用户决策:否。

### #8 [Low][frontend] MODES.internship 死代码
- 位置:server/src/lib/modes.ts:190-203。
- 现状:internship 条目与 work 定义逐字段重复;canonicalMode(:297) 已把 internship→work,getMode(:315) 恒解析到 MODES.work;grep 全 src 无 MODES.internship 引用。
- 建议:删除条目(兼容由 canonicalMode 保证),或加注释说明为历史保留。
- 需用户决策:否。

### #9 [Low][frontend] api.ts 死导出与过时注释
- 位置:server/src/lib/api.ts:12(注释「Phase 2 使用 seed/AMap 数据,DB 就绪后无缝切换到 API」「GET /api/search」)、:90(fetchPOIs)、:125(fetchModes)。
- 现状:fetchPOIs/fetchModes 无任何调用方(客户端走 map-shell 的 fetchPOIsForMode/loadWorkViewport);search 实际是 POST /api/search;DB 早已接入。
- 建议:删除死导出;注释改为当前契约(work/domain 读路径)。
- 需用户决策:否。

### #10 [Low][backend] suggest/search 输入长度无上限
- 位置:server/src/app/api/suggest/route.ts:32(q=searchParams.get('q'))、:21-28(parseCenter);search/route.ts:38-47。
- 现状:q 与 body 未设上限;超长 q 进入 669 公司 × 岗位的 matchKeyword 循环;filters 任意 JSON 进缓存 key。
- 建议:q ≤ 100、center 解析失败即忽略(已做)、body 大小限制;超限 400。
- 需用户决策:否。

### #11 [Low][backend] /api/me/notifications 可反复触发全量扫描
- 位置:server/src/app/api/me/notifications/route.ts:13-36。
- 现状:POST 无 body 无节流,每次全量 loadServerCatalog + matchJobAlerts + enqueue(ON CONFLICT 防重行但 title 更新)。
- 建议:按用户加冷却(如 60s 内幂等返回上次结果)。
- 需用户决策:否。

### #12 [Low][backend] saved POST 缺长度/坐标边界校验
- 位置:server/src/app/api/me/saved/route.ts:33-39。
- 现状:name/poiId 仅非空校验;lng/lat 透传入库,无 -180..180 / -90..90 范围校验与长度上限。
- 建议:对齐 account.ts sanitize 风格,加长度与数值范围校验。
- 需用户决策:否。

### #13 [Low][db] robots.txt 获取失败默认允许
- 位置:crawler/app/domain_map_importer/acquire.py:143-152。
- 现状:fetch_robots 抛 OSError/URLError/TimeoutError → return True(允许);status ≥400 也视为允许。
- 问题:网络抖动时可能抓取 robots 实际禁止的页面;与「polite acquisition」自述存在张力(404 站点无 robots 允许是惯例,超时也应允许是争议点)。
- 建议:区分「404/无 robots(允许,惯例)」与「网络异常(拒绝,保守)」。
- 需用户决策:否(采集策略口径可再议)。

### #14 [Low][docs] data-quality.md 两段 geocode 口径无范围标注
- 位置:tech/roles/data/data-quality.md:21-29(「Live apply not yet run on the national drops」)vs :44-50(「geocode apply 65/86 → 79 pins」)。
- 现状:前者讲全国 drops(630 公司)被 10044 配额挡下;后者讲杭州 pilot 的 65/86 成功。未标范围时读起来互相矛盾。
- 建议:两段加「范围:全国 drops」/「范围:杭州 pilot」前缀与时间线。
- 需用户决策:否。

### #15 [Low][data] 全国 radar drops 站点占位名
- 位置:server/data/recruitment/radar/腾讯.json:13,21,29,37(site.name「腾讯—剩余岗位」、address「北京/上海/广州/深圳」,无 lng/lat)。
- 现状:多城市站点均继承雷达行原文占位名与城市文本;data-quality.md:21-29 确认此为 geocode 前的过渡态(全国 apply 尚未跑)。
- 建议:geocode:sites:apply 落坐标后按城市派生站点名,或读路径对占位名做展示层归一。
- 需用户决策:否(数据过渡态已知;何时跑全国 geocode 属 Env-only 步骤)。

### #16 [Low][docs] b2-u1-u6 批次目录缺 manifest
- 位置:tech/roles/development/parallel-sessions/20260819-b2-u1-u6/(仅 merge-report.md)。
- 现状:违反 CLAUDE.md 批次约定(README manifest + prompts/ + reports/);merge-report:3 自述汇报系 /merge-agent 参数内联。
- 建议:补 README manifest 与汇报摘要,或按约定注明豁免原因。
- 需用户决策:否。

## 建议修复批次(供 boss 审批)

- 批次 A(DB 空间查询修复):#1(geom_geog 索引接线,修后 EXPLAIN 验证)
- 批次 B(账号安全加固):#4(限流+尝试上限+过期清理;demo hint 保留与否需用户决策) #5(写路径不再静默降级) #10 #11 #12
- 批次 C(死代码/注释清理):#8 #9
- 批次 D(文档数字与口径同步):#2(执行 docs 扫描的 27 条批次)#3(先跑测试取权威计数) #14 #16
- 批次 E(组件拆分,大工程):#6(建议单列批次,配 component-contracts 测试门禁)
- 需用户决策(暂不派):#3(权威测试计数需跑 npm test 确认);#4 的「何时接入真实 OTP 发送」;#15 的「何时跑全国 geocode(Env-only,需 AMAP_WEB_KEY 配额)」;#13(robots 失败策略口径)。
