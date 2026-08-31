# 质量扫描报告(2026-08-27 · scope: all)

## 摘要
- 扫描对象与规模:静态只读扫描 `tech/`、根级契约文档、`.claude/skills/`、`server/src`、`server/tests`、`server/scripts`、`server/data/recruitment`、`crawler/app|tests`、`db/migrations|scripts`。目录清单可确认至少 **2,334** 个一方文档/源码/测试/数据文件（含 `tech/**/*.md` 909、招聘 JSON 1,090、Server TS/TSX/CSS 178、Server 测试 116、脚本 19、DB 文件 22；未计入依赖与构建产物）。沙箱拒绝只读 shell 行数统计，故不臆造总行数。
- 执行边界:未运行 `npm`/`make`/测试/构建/迁移/采集；结论来自逐文件阅读、跨库引用搜索、数据与来源记录对照。
- 发现总数 **26**，按严重度: **High 8 / Medium 15 / Low 3**。
- 按类别: **文档 3 / 前端 4 / 后端 12 / 数据库 2 / 数据 5**。
- 最高风险集中在:采集授权边界、Agent 思考内容与记忆隐私、招聘数据被真实性过滤器整源丢弃、来源溯源丢失、百万 POI 无边界查询、认证写入非事务、匿名限流全局互相影响。

## 发现清单(按严重度排序)
| # | 严重度 | 类别 | 位置(file:line) | 问题 | 建议 |
|---|--------|------|-----------------|------|------|
| 1 | High | 后端 | `crawler/app/domain_map_importer/ats_feishu.py:315` | Feishu 适配器明确用浏览器 UA“伪装”以绕过端点对爬虫 UA 的 405 门禁，与诚实 UA/不规避检测契约冲突。 | 停止 UA 伪装；仅在来源方明确授权该 API/UA 方式后恢复，并同步来源审查。需用户决策:是(数据源授权口径)。 |
| 2 | High | 后端 | `server/src/app/api/agent/chat/route.ts:35` | 路由声明的 SSE 白名单不含 `reasoning`，但白名单常量未使用，`runAgent` 的思考内容仍被原样发给网络客户端。 | 在 SSE 边界真正执行 allowlist，禁止公开 `reasoning`;仅保留服务端 provider 回传所需的内部全文。需用户决策:否。 |
| 3 | High | 后端 | `server/src/lib/agent/tools/builtin.ts:49` | 记忆工具只靠 LLM 描述禁止密码/密钥，存储层会接受敏感文本，并在后续会话注入第三方 LLM system prompt。 | 增加硬性敏感信息检测/拒绝、显式确认与审计；在决策前禁用自动 memory-save。需用户决策:是(PII/隐私口径)。 |
| 4 | High | 数据 | `server/src/lib/freshness.ts:25` | `isAuthenticPositionId` 仅接受 `radar-*`/`portal-*`，而 embodied-jobs 全部使用 `embj-*`，导入 apply 会整源过滤掉这批岗位。 | 将已批准真实来源纳入真实性判定，或把 externalId 规范迁移为受支持前缀并加整源回归测试。需用户决策:否。 |
| 5 | High | 数据 | `server/src/lib/recruitment-import.ts:232` | 跨源同 slug 合并后只保留首家公司 `source`，其余来源新增的站点/岗位统一写成首源；如 radar 的 DeepSeek 站点会被记为 official-career。 | 把 provenance 下沉到 site/position，合并时保留每条记录 source，再按记录写 `source_id`。需用户决策:否。 |
| 6 | High | 后端 | `server/src/app/api/pois/domain-local/route.ts:50` | `bounds` 非必填；缺失时百万级 `hz_pois` 执行 `count(*) OVER()` + 全结果排序，公开请求可反复制造重查询。 | 浏览端点强制合法杭州 bbox；若保留全局搜索，拆成受限的独立 SQL/端点并设置硬超时。需用户决策:否。 |
| 7 | High | 后端 | `server/src/lib/account-store.ts:388` | OAuth/注册/绑定手机邮箱等多语句认证写入直接使用 `Pool.query`，无事务；后续语句失败时前序写入已提交，产生半完成身份。 | 每个多语句认证操作改用单一 client + `BEGIN/COMMIT/ROLLBACK`，并对失败注入做一致性测试。需用户决策:否。 |
| 8 | High | 后端 | `server/src/lib/client-ip.ts:27` | 未配代理时所有匿名用户共用 `anon:public` 限流桶；配置后仅判断列表非空，根本不校验请求是否来自列出的代理 IP。 | 使用平台可信 peer IP/受信代理注入值；匿名桶避免全站单桶，限流状态迁到共享存储。需用户决策:是(Env-only/部署拓扑)。 |
| 9 | Medium | 数据库 | `server/src/lib/recruitment-import.ts:565` | `positions.retrieved_at/expires_at` 存在但导入 INSERT 不写；实现也未写 `import_runs/source_records`，招聘导入缺少契约要求的批次/内容哈希链。 | 写入抓取时间/失效时间，并为每次导入建立 import_run/source_record 与 parser/hash 证据。需用户决策:否。 |
| 10 | Medium | 后端 | `server/src/lib/account-store.ts:340` | OAuth 邮箱冲突会仅凭邮箱字符串自动挂接已有用户；Google 的 `email_verified` 未检查，GitHub 也未走 verified-email 端点。 | 仅对明确 verified 的邮箱执行自动链接；否则要求已登录绑定或二次 OTP。需用户决策:否。 |
| 11 | Medium | 数据 | `server/data/recruitment/embodied-jobs/embj-迦智科技.json:29` | 多个 `zhipin.com` 投递链接被标为 `applySource:"official"`，且 ETL 记录写“不涉及 BOSS”，产品会把商业平台入口展示成官网。 | 按 hostname 归类为 `boss`/聚合源；用户确认第三方快照是否允许携带该类链接并更新审查记录。需用户决策:是(数据源/展示口径)。 |
| 12 | Medium | 后端 | `crawler/app/domain_map_importer/acquire.py:233` | robots 解析在同一 UA 出现多个匹配 group 时取最后一组，而 RFC 9309 要合并匹配组规则；前组限制会被丢弃。 | 合并所有最具体匹配 group 后再做最长路径/Allow tie-break，补重复 group fixture。需用户决策:否。 |
| 13 | Medium | 后端 | `crawler/app/domain_map_importer/acquire.py:297` | robots 获取网络失败/状态 0 会按空文本放行并继续抓页面，实际是 fail-open，而文档称“robots-gated”。 | 网络/解析失败默认跳过该 host，或记录人工批准的 fail-open 例外。需用户决策:是(数据源访问策略)。 |
| 14 | Medium | 后端 | `server/src/lib/server-catalog.ts:20` | 单 POI 详情先加载全站点、全公司、全部在招岗位，再在 Node 中 `.find`；详情请求复杂度等于全目录读取。 | 新增按 slug/site id 的定向 SQL，直接返回一个 POI 及其岗位。需用户决策:否。 |
| 15 | Medium | 后端 | `server/src/app/api/suggest/route.ts:63` | 每个未命中缓存的关键词先加载完整工作目录，再双层遍历公司和全部岗位，只返回前 10 条。 | 将公司/岗位前缀或 trigram 查询下推 SQL，`UNION ALL` + `LIMIT 10`，避免全 catalog 物化。需用户决策:否。 |
| 16 | Medium | 数据库 | `db/migrations/006_recruitment_sites.sql:47` | `positions.company_id` 与 `site_id` 是独立 FK，数据库不能保证 site 属于同一 company；可形成跨公司岗位。 | 为 `company_sites(id,company_id)` 建唯一键并改用复合 FK `(site_id,company_id)`。需用户决策:是(Env-only migration apply)。 |
| 17 | Medium | 前端 | `server/src/hooks/use-search-state.ts:61` | Domain 查询在引擎未就绪时直接返回；effect 只依赖 query/mode，引擎随后就绪不会重跑，建议列表会保持空。 | 把 engine identity/readiness 纳入触发条件，或在引擎总线就绪时重放当前 query。需用户决策:否。 |
| 18 | Medium | 前端 | `server/src/lib/agent/action-schema.ts:60` | Agent `flyTo.zoom` 只校验 finite，不限制地图支持范围，极大/负值会直接传给地图引擎。 | 统一限制 zoom 到项目/引擎共同范围，并在 bridge 侧再次 clamp。需用户决策:否。 |
| 19 | Medium | 后端 | `server/src/app/api/search/route.ts:75` | POST search 的 `pageSize` 不要求整数，`page` 完全未校验；非法值被静默 floor/钳制，NaN 可形成不稳定响应。 | 与 GET `/api/pois` 共用严格分页解析器，非法值返回 400。需用户决策:否。 |
| 20 | Medium | 数据 | `server/data/recruitment/qqdoc-jobs/qqj-施耐德电气AI星火实习生计划.json:53` | 至少两条投递 URL 含 `.html/./...html` 的拼接残片，现有 scheme 校验会放过该类语义坏链。 | URL 归一时解析 pathname，并拒绝重复文件段/`/./`；修复现有 drops。需用户决策:否。 |
| 21 | Medium | 数据 | `server/data/recruitment/embodied-jobs/embj-Tactus.json:9` | Tactus 已写 Fremont 地址，但 career/apply 指向 Calvin University；数据审查已明确标“疑错配需人工复核”，当前仍处于可导入状态。 | 复核实体；确认前将该站点/岗位 closed 或 quarantine。需用户决策:是(数据实体口径)。 |
| 22 | Medium | 前端 | `server/next.config.ts:16` | 全站 CSP 对所有路由开放 `'unsafe-inline'` 与 `'unsafe-eval'`，显著削弱 XSS 防线；地图 SDK 需求被扩散到整个应用。 | 评估 nonce/hash 与 route-specific CSP；至少把非地图/账号页面收紧。需用户决策:否。 |
| 23 | Medium | 文档 | `tech/05-milestones.md:8` | “当前”文档仍写离线 seed fallback、迁移 001–016、1610 测试、669/1440/877 数据；实现/CHANGELOG/数据台账已是 strict DB-only、001–019、1686、1052/2411/12890。 | 建立单一生成式状态块，同步 README/CLAUDE/agent/CONTRIBUTING/milestones/data-model/deploy。需用户决策:否。 |
| 24 | Low | 文档 | `server/docs/environment-variables.md:114` | 示例把 `NEXT_PUBLIC_API_BASE_URL` 配成 `http://localhost:3000/api`，客户端又拼 `/api/...`，会得到 `/api/api/...`;同节多个 API_* 开关无代码消费者。 | 示例改成 origin 或空串，删除/标注未实现 env。需用户决策:否。 |
| 25 | Low | 前端 | `server/src/lib/viewport-search.ts:384` | `query.maxTier ? ...` 把合法值 0 当成未设置，无法发出 tier 0 过滤。 | 改为 `query.maxTier !== undefined/null` 并补 0 边界测试。需用户决策:否。 |
| 26 | Low | 文档 | `agent.md:178` | 契约要求 ESLint/Prettier/Black，但 `server/package.json` 与 `crawler/pyproject.toml` 没有对应依赖、脚本或配置，质量门禁不可执行。 | 要么落地实际 formatter/linter 命令，要么把契约改为当前真实工具链。需用户决策:否。 |

## 发现详情

### #1 [High][后端] Feishu 采集通过伪装浏览器 UA 绕过 405 门禁
- **位置:** `crawler/app/domain_map_importer/ats_feishu.py:315-317`; `tech/roles/data/etl/feishu-ats.md:25-26`; `CLAUDE.md:31`。
- **现状:** 代码注释明确写“爬虫 UA 一律 405，浏览器 UA 200”，随后覆盖为 Chrome UA；来源文档和项目契约同时声明诚实 UA、不绕过检测/限制。
- **问题:** 这是代码与来源授权边界的直接冲突；即使端点公开，服务端对 UA 的拒绝已被实现主动规避。
- **建议修法:** 禁用该 UA override；取得来源方明确授权或改用官方允许入口后，再把访问方式写入 ETL 审查与 source metadata。
- **影响面:** Feishu 28 tenants 的刷新流程、合规台账、后续所有同类 ATS 适配器。
- **需用户决策:** **是（数据源授权/访问方式）**。

### #2 [High][后端] Agent 思考内容实际暴露在 SSE 网络流
- **位置:** `server/src/app/api/agent/chat/route.ts:35-37,241-263`; `server/src/lib/agent/run-agent.ts:367-376`; `server/src/lib/agent-panel-state.ts:13-14`。
- **现状:** route 定义 `delta/tool/action/done/error` 白名单但从未检查；runner 会生成 `{type:'reasoning',text}`；前端收到后明确丢弃。
- **问题:** 没有 UI 价值的内部推理仍对任意 API 客户端可见，可能泄露内部推理、工具上下文或系统行为细节；白名单注释与执行事实相反。
- **建议修法:** route 发送前按真实 allowlist 过滤；runner 只在服务端累积 `turnReasoning` 供 provider tool-call replay，不生成公开事件。
- **影响面:** `/api/agent/chat` 全部推理模型会话。
- **需用户决策:** **否**。

### #3 [High][后端] Agent Memory 对敏感信息仅做软提示，仍会持久化并再次外发
- **位置:** `server/src/lib/agent/tools/builtin.ts:49-73`; `server/src/lib/memory-store.ts:32-38`; `server/src/lib/agent/run-agent.ts:57-73,237-244`; `tech/30-agent-memory.md:76-83`。
- **现状:** 工具描述禁止密码/密钥/验证码/完整地址，但代码只 trim/截断；文档和测试还明确要求“敏感词不硬拦”。保存内容会在后续请求中进入 system prompt。
- **问题:** 一旦 LLM误调用或用户诱导调用，凭据/PII 会进入 Postgres并在以后发送给配置的外部 LLM provider。
- **建议修法:** 在存储前做高置信敏感模式拒绝；保存前向用户展示待存内容并显式确认；记录 consent/version；决策前关闭自动工具注册。
- **影响面:** 所有登录用户记忆、数据库备份、外部 LLM 数据处理边界。
- **需用户决策:** **是（PII/隐私与产品交互）**。

### #4 [High][数据] embodied-jobs 岗位在 apply 阶段被真实性前缀规则整源丢弃
- **位置:** `tech/roles/data/etl/embodied-jobs.md:9-18`; `server/data/recruitment/embodied-jobs/embj-迦智科技.json:20`; `server/src/lib/freshness.ts:13-27`; `server/src/lib/recruitment-import.ts:369-374`。
- **现状:** 来源记录称有 538 个机会，externalId 约定为 `embj-*`; apply 前 `authentic` 过滤只保留 `radar-*`/`portal-*`。
- **问题:** plan 可计数、文件可存在，但 live import 不会写入任何 `embj-*` 岗位，README 所称 embodied 真岗位可见与实现不符。
- **建议修法:** 将真实性从字符串前缀改为来源注册表/显式 provenance；短期把 `embj-*` 纳入 allowlist并锁定“该源至少一条进入 authentic plan”的回归测试。
- **影响面:** embodied-jobs 整源、公司可见性、计划数与 apply 数差异。
- **需用户决策:** **否**。

### #5 [High][数据] 跨源公司合并会错误覆盖站点/岗位 provenance
- **位置:** `server/src/lib/recruitment-import.ts:208-247,269-291,412-414,561-610`; `server/data/recruitment/official-career/deepseek.json:1-3`; `server/data/recruitment/radar/deepseek.json:1-3`。
- **现状:** `SourceCompany` 只有公司级 `source`;同 slug 合并时追加 extra sites/positions，却不保存各条来源；落库时整家公司共用一个 `sourceId`。
- **问题:** 例如 official-career DeepSeek 先进入合并，radar 新增的北京/杭州站点最终也会记为 official-career，来源审计与删除/保留策略失真。
- **建议修法:** 为 `SourcePosition`/`CompanySite` 增加必填 source/provenance 引用；合并保持记录级来源；导入按记录 sourceId 写入。
- **影响面:** 所有跨 adapter 同 slug 公司、source 删除策略、来源展示与审计。
- **需用户决策:** **否**。

### #6 [High][后端] Domain 本地 POI 端点可触发百万行无边界排序/计数
- **位置:** `server/src/app/api/pois/domain-local/route.ts:23-61,77-84`; `server/src/lib/hz-poi-store.ts:62-90,148-156`; `db/migrations/013_hangzhou_pois.sql:16-60`。
- **现状:** 缺失/非法 bounds 被解析为 null后仍查询；SQL 对可达百万行执行窗口总数和 rating/photos 排序。
- **问题:** 公开端点可通过变化 zoom/categories/offset 绕过短缓存键，持续占用 DB CPU、work_mem 与连接池。
- **建议修法:** 浏览 API 要求 bounds 必填且落在杭州允许范围；给 SQL 设置 statement timeout；把无 bounds autocomplete/全局搜索拆成专用索引查询。
- **影响面:** `hz_pois` 百万表、公共连接池(max 5)、Domain 浏览可用性。
- **需用户决策:** **否**。

### #7 [High][后端] 多语句认证写入不是原子操作
- **位置:** `server/src/lib/account-store.ts:388-425`(OAuth)、`:439-470`(注册)、`:545-599`(绑定凭证)。
- **现状:** 函数直接连续调用 `Pool.query`;文件中这些路径没有 `BEGIN/COMMIT/ROLLBACK`。
- **问题:** 用户 INSERT/UPDATE 成功后，identity INSERT/DELETE 失败会返回 503，但已留下 orphan user、已改手机号/邮箱或缺失 identity；重试可能变成“已占用”。
- **建议修法:** `db.connect()` 后在一个事务内执行每个逻辑操作；冲突映射在 rollback 后完成；增加“第二/第三条 SQL 抛错”测试。
- **影响面:** OAuth 登录、密码注册、手机号/邮箱换绑、账户恢复。
- **需用户决策:** **否**。

### #8 [High][后端] 代理信任实现既不使用 allowlist，又让匿名用户共享全局桶
- **位置:** `server/src/lib/client-ip.ts:16-35,42-55`; `server/src/app/api/agent/chat/route.ts:74-99`; `server/src/app/api/auth/password/register/route.ts:81-93`。
- **现状:** `TRUSTED_PROXY_IPS` 只被检查 length；配置任意非空值后即信任请求头首段。未配置时所有匿名请求返回 `anon:public`。
- **问题:** 正确配置前，AI 10次/分钟、注册5次/小时、OTP/登录 IP 桶都可能成为全站共享限额；错误代理拓扑下又可伪造 XFF 换桶。
- **建议修法:** 使用平台提供且不可伪造的客户端地址；由唯一受信代理覆盖转发头；匿名 fallback 至少按安全 cookie/边缘注入指纹分桶；多实例用 Redis。
- **影响面:** Agent 成本控制、OTP 配额、密码爆破保护、注册可用性。
- **需用户决策:** **是（Env-only/部署拓扑）**。

### #9 [Medium][数据库] 招聘导入未形成可审计的批次/记录链
- **位置:** `db/migrations/002_plugins_and_provenance.sql:3-4`; `db/migrations/006_recruitment_sites.sql:67-68`; `server/src/lib/recruitment-import.ts:565-610`。
- **现状:** schema 有 `import_runs/source_records` 与 position 时间字段；实际招聘 INSERT 只写业务列和 source_id，不写 retrieved/expires，也没有 import run/record 写入。
- **问题:** 无法从 DB 回答“哪次导入、哪个 parser/hash、何时抓取、哪条源记录产生了该岗位”，刷新/下架审计不完整。
- **建议修法:** apply 开始先建立 import_run；每条规范化记录写 source_record；position 关联或至少保留 retrieved/expires 与 record id。
- **影响面:** 数据溯源、过期处理、takedown、重复导入诊断。
- **需用户决策:** **否**。

### #10 [Medium][后端] OAuth 自动链接未验证邮箱可信状态
- **位置:** `server/src/lib/oauth/oauth-exchange.ts:145-160,180-196`; `server/src/lib/account-store.ts:340-366,412-415`。
- **现状:** Google userinfo 的 `email_verified` 未读取；GitHub 只使用 `/user.email`;任一邮箱唯一冲突都会把 provider identity 挂到已有用户。
- **问题:** 账号链接的授权判断仅基于字符串相等，缺少“该 provider 已验证并有权声明此邮箱”的证据。
- **建议修法:** Google 要求 `email_verified===true`;GitHub 查询 verified primary email；否则只创建独立身份或要求当前账号 OTP/登录确认。
- **影响面:** 跨 provider 账号链接与账户接管边界。
- **需用户决策:** **否**。

### #11 [Medium][数据] BOSS 链接被标成 official，来源记录与实际产品数据冲突
- **位置:** `server/data/recruitment/embodied-jobs/embj-迦智科技.json:17-30`; `server/data/recruitment/radar/摩尔线程.json:82-109`; `tech/roles/data/etl/embodied-jobs.md:18-19`; `tech/roles/data/data-sources.md:14`。
- **现状:** zhipin hostname 的 career/apply URL 被标 `official`;来源记录又称“不涉及 BOSS”，台账规定 BOSS 未批准直接采集。
- **问题:** 即便数据来自第三方公开快照而非直接抓 BOSS，产品仍会把商业平台入口错误展示为官网，授权与 provenance 语义不清。
- **建议修法:** 基于 hostname 归类 applySource；单独记录“上游快照携带的外链”与“直接采集来源”；由用户拍板是否保留此类入口。
- **影响面:** 投递按钮信任、来源展示、合规审计。
- **需用户决策:** **是（数据源/展示口径）**。

### #12 [Medium][后端] robots 同 UA 多组规则未合并
- **位置:** `crawler/app/domain_map_importer/acquire.py:233-244`。
- **现状:** 循环对同 UA 的每个 group 直接覆盖 `selected`，最终仅保留最后一组。
- **问题:** 前面 group 的 Disallow/Allow 规则会消失，抓取判定可能比站点声明更宽松。
- **建议修法:** 收集全部最佳 UA 匹配 group 并合并 rules，再执行最长匹配；wildcard 也按相同规则处理。
- **影响面:** 所有 official/ATS robots 判定。
- **需用户决策:** **否**。

### #13 [Medium][后端] robots 获取异常按允许处理
- **位置:** `crawler/app/domain_map_importer/acquire.py:289-305`。
- **现状:** `_http_fetch` 网络错误返回 `(0,"")`;`robots_allows` 只把 `>=400` 当缺失，状态0空文本最终返回 allow。
- **问题:** DNS/TLS/超时并不等于站点没有 robots；临时故障会让采集在缺少访问规则证据时继续。
- **建议修法:** 状态0/解析异常默认 blocked，并在 summary 标记 `robots-unavailable`;只有明确404/410才按缺失处理。
- **影响面:** 采集合规性与故障时行为。
- **需用户决策:** **是（访问策略）**。

### #14 [Medium][后端] POI 详情读取全目录
- **位置:** `server/src/lib/server-catalog.ts:20-23`; `server/src/lib/recruitment-store.ts:153-205`; `server/src/app/api/pois/[id]/route.ts:35`。
- **现状:** by-id 调用无 clip 的 `loadServerCatalog`,读取全部 sites/companies/open positions，再线性查 id。
- **问题:** 单卡片点击成本随全国目录增长，缓存 miss 时会占满小连接池并重复物化大对象。
- **建议修法:** 解析 `slug[:siteId]` 后定向查询公司/站点/岗位；只返回该站点与公司级 aggregate 行。
- **影响面:** 搜索建议选中、详情打开、移动端首点体验。
- **需用户决策:** **否**。

### #15 [Medium][后端] 搜索建议在 DB/Node 两侧均做全量工作
- **位置:** `server/src/app/api/suggest/route.ts:62-107`; `server/src/lib/server-catalog.ts:15-18`。
- **现状:** 每个 q cache miss 加载全目录，随后遍历每家公司及其全部岗位，最后 slice 10。
- **问题:** 当前 plan 已到 12,890 岗位，查询复杂度和序列化成本与返回条数无关；新关键词可持续制造 miss。
- **建议修法:** 公司 name/岗位 title 用参数化 SQL + trigram/prefix 索引，分别 LIMIT 后合并；tag count 另做受限聚合/缓存。
- **影响面:** Work autocomplete 延迟、DB/Node CPU、公共缓存命中率。
- **需用户决策:** **否**。

### #16 [Medium][数据库] 岗位可引用另一公司的站点
- **位置:** `db/migrations/006_recruitment_sites.sql:21-23,47-50`。
- **现状:** positions 分别 FK 到 companies(id) 与 company_sites(id)，没有组合约束。
- **问题:** 任意写入路径只要 company_id/site_id 配错，数据库仍接受；读取时公司、站点与岗位关系将自相矛盾。
- **建议修法:** `company_sites UNIQUE(id,company_id)`；positions 增 composite FK；迁移前做反连接校验。
- **影响面:** 招聘目录完整性、删除级联、按公司聚合。
- **需用户决策:** **是（Env-only migration apply）**。

### #17 [Medium][前端] 引擎晚于查询就绪时 Domain 建议不恢复
- **位置:** `server/src/hooks/use-search-state.ts:59-63,110-126,145`。
- **现状:** engine 只写 ref，effect 依赖保持 `[query,mode]`;domain 本地0命中且 engine 为 null 时直接 return。
- **问题:** 用户在地图引擎加载完成前输入的查询不会在引擎就绪后自动执行 AutoComplete，除非再改一次文本。
- **建议修法:** 依赖稳定的 engine id/readiness，或订阅总线后对当前 query 调度一次；保留取消守卫。
- **影响面:** 首访、慢网络、引擎切换后的 Domain 搜索建议。
- **需用户决策:** **否**。

### #18 [Medium][前端] Agent flyTo zoom 缺少范围限制
- **位置:** `server/src/lib/agent/action-schema.ts:59-68`; `server/src/lib/agent-map-bridge.ts:88-92`。
- **现状:** 只要求 zoom 是有限数，bridge 直接传给 `view.flyTo`。
- **问题:** 负数或极大 zoom 可触发厂商 SDK 异常、相机不可恢复状态或跨引擎不一致。
- **建议修法:** 在 schema 与 bridge 双层 clamp 到共同范围（并允许引擎再收窄），加入 -1/0/21/1e6 边界测试。
- **影响面:** Agent 地图动作、三引擎切换后的回放。
- **需用户决策:** **否**。

### #19 [Medium][后端] POST search 分页验证与公开契约不一致
- **位置:** `server/src/app/api/search/route.ts:75-87`; `server/src/lib/public-search.ts:28-34`。
- **现状:** pageSize 仅检查 number/finite/range，不检查 integer；page 无校验，后续用 `Math.floor(page || 1)`。
- **问题:** 小数被静默改写，字符串/NaN/负值产生与 GET 不一致的响应；错误输入没有 400 反馈。
- **建议修法:** 抽取并复用 GET route 的 `pagedParam` 等价纯函数，page/pageSize 都严格整数。
- **影响面:** `/api/search` 客户端契约、缓存键与分页稳定性。
- **需用户决策:** **否**。

### #20 [Medium][数据] 投递 URL 语义损坏未被校验器发现
- **位置:** `server/data/recruitment/qqdoc-jobs/qqj-施耐德电气AI星火实习生计划.json:53-54`; `server/data/recruitment/qqdoc-jobs/qqj-施耐德电气.json:133-134`; `server/src/lib/recruitment-import.ts:40-49`。
- **现状:** URL 以 http(s) 开头，因此通过 `hasValidUrlScheme`;实际 pathname 含一个 HTML 文件后又拼 `/./另一个HTML`。
- **问题:** 投递按钮落到构造坏链，当前 plan 的“0 issues”不能覆盖 URL 可用性/路径质量。
- **建议修法:** 解析 URL 后增加 pathname 语义规则；对已知 host 构造 canonical URL；数据审计增加 HEAD/人工可达证据（按来源授权执行）。
- **影响面:** 两个施耐德条目及同一提取器可能生成的其他链接。
- **需用户决策:** **否**。

## 建议修复批次(供 boss 审批)
- **批次 A（采集合规与 robots）:** #1 #12 #13。#1/#13 先冻结相关 live crawl；#1、#13 含用户数据源策略决策。
- **批次 B（Agent 安全与隐私）:** #2 #3 #18 #22。#3 暂不派自动落地，先由用户确认 PII/consent 口径。
- **批次 C（招聘真实性与 provenance）:** #4 #5 #9 #11。先修整源过滤与记录级 source，再重算 plan/apply 差异；#11 需用户确认商业平台外链口径。
- **批次 D（认证一致性与 OAuth）:** #7 #8 #10。事务化可直接派；#8 的部署/IP 来源需用户/运维确认。
- **批次 E（公共读性能与输入边界）:** #6 #14 #15 #19。优先强制 domain bbox，再做 by-id/suggest 定向 SQL。
- **批次 F（数据库完整性）:** #16。先生成只读校验 SQL与 migration；实际 apply 属 Env-only。
- **批次 G（前端健壮性）:** #17 #25；#18 已归 Agent 安全批次。
- **批次 H（数据清洗）:** #20 #21。#21 暂不派实体替换，先人工裁决 Tactus 身份。
- **批次 I（文档与质量门禁）:** #23 #24 #26。以 CHANGELOG 最新证据、现行 data-quality 和代码行为回填当前文档。
- **需用户决策(暂不派):** #1(数据源授权/UA 门禁)、#3(PII/记忆 consent)、#8(Env-only/代理拓扑)、#11(BOSS 外链展示口径)、#13(robots fail-open 策略)、#16(Env-only migration apply)、#21(Tactus 实体口径)。

## 只读自查
- [x] 未创建/修改/删除任何文件（除本报告）
- [x] 每个发现均带 file:line 证据
- [x] 已区分事实问题与建议修法
- [x] 已标注改现有 UI / Env-only / 数据口径类用户决策项
- [x] 未运行写操作、依赖安装、构建、测试、迁移或采集
