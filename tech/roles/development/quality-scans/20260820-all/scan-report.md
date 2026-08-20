# 质量扫描报告(2026-08-20 · scope: all)

## 摘要

- 扫描对象与规模:全库(HEAD `933f972`,已同步 `dev`)—— 根文档(README/CHANGELOG/CLAUDE/agent/CONTRIBUTING/Makefile)、`tech/**`(约 234 个 md,含 22 篇技术文档 + 14 个批次目录)、`.claude/skills/` 16 个、`server/src`(19 路由 / 44 lib / 18 components / 2 hooks,约 21000 行 TS)、`server/tests` 46 个测试文件(488 处 `test(`)、`crawler/app` 10 个 py + 66 个 `def test_`、`db/migrations` 001–016、`server/data/recruitment` 721 个 drop JSON(radar 630 + official-career 91)。
- 发现总数:**15**,按严重度 **High 0 / Medium 6 / Low 9**。
- 按类别:文档 7 / 前端 1 / 后端 1 / 数据库 0 / 数据 5 / 仓库卫生 1。
- 上轮复核:20260819-docs(27 条)与 20260819-all(16 条)的发现**大部分已修复**(README/CONTRIBUTING/tech-README/agent.md 重写、geom_geog 索引接线、OTP 限流、写路径不再静默降级、search/suggest/saved 输入上限、notifications 冷却、api.ts/modes.ts 死代码清理、data-quality 范围标注、b2-u1-u6 目录移除等);仍未修复/复发项在下方清单中标注「上轮 #N」。本轮新发现集中在:测试计数第三次漂移、CHANGELOG 缺 2 个合入条目、radar 数据同公司多 slug 重复与 URL/拼写缺陷。

## 发现清单(按严重度排序)

| # | 严重度 | 类别 | 位置(file:line) | 问题 | 建议 |
|---|--------|------|-----------------|------|------|
| 1 | Medium | docs | CLAUDE.md:43 · agent.md:360 · CONTRIBUTING.md:49 · tech/05-milestones.md:11 vs README.md:19 · CHANGELOG.md:9 vs tech/16-bug-fixes.md:50 | 测试计数三处漂移:4 个文件写「423(421 pass/2 skip,08-19)」,README/CHANGELOG 写「477(475/2,08-20)」,HEAD 最新实测记录(poi-zoom-full-load 批)写「488(486 pass/0 fail/2 skip)」 | 以 `cd server && npm test` 实测值为准,统一写回 6 处(预计 488) |
| 2 | Medium | docs | CHANGELOG.md(2026-08-20 节) | 缺两个已合入 dev 的 merge 条目:`788e9c6` positions-dedup(b1f)与 `933f972` work 全量加载(首点刷新/聚合计数/死代码清理,实测数据见 tech/16:5-55);「This file tracks shipped work」与实际记录不符 | 补 2026-08-20 两条记录(可引用 tech/16 与批次报告) |
| 3 | Medium | data | server/data/recruitment/radar/(4399+4399游戏 · dexmai+dexmal-原力灵机 · nvidia+nvidia英伟达 · tp+tp-link · sharpa+sharpa-robotics · minimax+minmax · 上海电气+上海电气集团);server/src/lib/recruitment-source.ts:250 | 同公司多 slug 并存(同名/同官网,如 4399 两份 careerUrl 均 hr.4399om.com、原力灵机两份均 dexmal-inc.jobs.feishu.cn),dedup/merge 按**原样大小写敏感 slug** 精确匹配,official-career 的 `MiniMax`/`Momenta` 与 radar 的 `minimax`/`momenta` 不合并 → 地图同一公司多 pin | 建 slug 别名/小写归一合并表(人工确认各对后),或 read 层按名称+城市去重;数据口径需用户拍板 |
| 4 | Medium | data | radar/中国科学院空天信息创新研究院.json:10,34 · radar/bdo立信.json:10,43 | careerUrl 与 applyUrl 均为 `https://https://…` 双重协议前缀,JD 面板「投递」链接不可用(全库 grep 仅此 2 文件 4 处) | 数据修正(去重复前缀);import 校验器加 URL scheme 归一化断言防复发 |
| 5 | Medium | data | radar/akuna-capitai.json:2,4 · doiphindb智臾科技.json:2,4(显示名「DoIPhinDB智臾科技」) · hrnetgronp.json:2 · 中信证劵南华.json:2 | slug/显示名拼写错误:akuna-capitai(Akuna Capital)、DoIPhinDB(应为 DolphinDB,显示名直接可见)、hrnetgronp(HRNet Group)、证劵(→证券);slug 会作为 poiId/siteId 入库 | 修正 slug 与 name(注意已入库 id 引用,需按 site_key 迁移或别名兼容) |
| 6 | Medium | frontend | server/src/components/map-shell.tsx(2769 行,state/ref 密集区) | 上轮 all 扫描 #6 未修:单一组件承载地图初始化/加载/搜索/抽屉/账户/缓存,30+ state 与 20+ ref 的跨引用一致性是历史 Bug 7/poi-mixing 温床;2026-08-20 重构净删 566 行后仍为仓库最大组件 | 继续抽 hook(useWorkViewport 已先行,后续抽搜索状态/缓存还原/收藏图层),配 component-contracts 门禁 |
| 7 | Low | backend | server/src/app/api/pois/[id]/route.ts:19-20 | Next 已对动态段解码,再 `decodeURIComponent` 属双重解码:含裸 `%` 的 id(如 `/api/pois/100%25`)抛 URIError → 500(公共端点);且 id 无长度上限(缓存 key 膨胀) | 去掉二次解码(或 try/catch → 404/400),id 加长度上限 |
| 8 | Low | crawler | crawler/app/domain_map_importer/acquire.py:143-152 | 上轮 all 扫描 #13 未修:robots.txt 获取异常/≥400 时 `robots_allows` 返回 True(允许);网络抖动时可能抓 robots 禁止页面 | 区分「404/无 robots(允许,惯例)」与「网络异常/5xx(保守拒绝)」;口径可再议 |
| 9 | Low | docs | CLAUDE.md:7 · README.md:76 | CLAUDE.md「Next.js 15」过时(现 16.3.1);README Repository Layout「Next.js 15 app」与同文件 :19「Next.js 16.3.1」自相矛盾 | 统一为 Next.js 16 |
| 10 | Low | docs | tech/05-milestones.md:35,4 | 「Next 15.5.23, React 19.0.8」过时(现 16.3.1/19.2.8);文件头 Last reviewed 仍 2026-08-16 | 同步版本与复核日期 |
| 11 | Low | docs | README.md:14(「64 unit tests」)vs crawler/tests 66 个 `def test_`(无 skip 装饰器) | 上轮 docs 扫描 #18 的计数待复核项仍悬空:README 64 与源码 66 不一致 | 跑一次 `make test-unit` 取权威值(只读扫描不执行) |
| 12 | Low | docs | agent.md:115,185,210,246 | 引用 `tech/roles/development/implementation/<phase>.md` 作为实施记录位置,目录不存在且未像 :108/:245 那样标注「规划路径」 | 统一标注「规划,目录未建立」或改为实际位置(tech/16 等) |
| 13 | Low | hygiene | 仓库根 page-loaded.yml + state-check.png(Playwright 产物,未跟踪);tech/roles/development/parallel-sessions/ 下 12 个 20260819-* 批次目录 + quality-scans/20260819-* 均未跟踪 | Playwright 产物违反「统一存 .playwright-mcp/」约定(CLAUDE.md);已完成批次(如 20260819-regression-fix 含 merge-report)的目录从未入库 | 删除/迁移两个根文件;批次目录随 merge 一并 commit(或按 boss 约定统一收尾) |
| 14 | Low | data | server/src/lib/city-cluster.ts:16-17(引用 DB 147 行/76 家串味行) | 已知 city↔坐标矛盾行仍留在 DB(查询层 SQL+客户端双重剔除),数据修正记 deferred,确认存在未修 | 数据修正批次执行后再清「deferred」标注 |
| 15 | Low | docs | tech/16-bug-fixes.md:50 与 README/CHANGELOG 的 477 并存 | 同 #1:HEAD 实测 488(486/0/2)只记录在 bug-fixes,README/CHANGELOG 滞后 11 条 | 并入 #1 统一修正(不单列批次) |

## 发现详情

### #1 [Medium][docs] 测试计数三处漂移(423 / 477 / 488)
- 位置:CLAUDE.md:43、agent.md:360、CONTRIBUTING.md:49、tech/05-milestones.md:11(423);README.md:19、CHANGELOG.md:9(477);tech/16-bug-fixes.md:50(488,HEAD 最新)。
- 现状:2026-08-19 基线 423;chore/next-16 批实测 477(475 pass / 2 skip,CHANGELOG:9);merge `933f972`(work 全量加载)后该批自测「全量 488 测试通过(486 pass / 0 fail / 2 skip)」(tech/16:50)。源码静态计数 `test(` = 488,与 tech/16 吻合。
- 问题:4 个文档写 423、2 个写 477,均滞后于 HEAD 的 488;验收与 Agent 门禁判断会失真。
- 建议修法:跑 `cd server && npm test` 取权威值(预期 488/486/2),写回 CLAUDE.md / agent.md / CONTRIBUTING.md / tech/05 / README / CHANGELOG 六处。
- 影响面:验收口径、Agent 自检。
- 需用户决策:否(数字以实测为准)。

### #2 [Medium][docs] CHANGELOG 缺两个 2026-08-20 合入条目
- 位置:CHANGELOG.md 2026-08-20 节(仅 next-16 一条)。
- 现状:HEAD 链上 `788e9c6`(positions self-heal dedup,含契约测试)与 `933f972`(work 全量加载 + 聚合计数 + 净删 566 行)均已合入 dev,但 CHANGELOG 未记录;两批内容仅存于 tech/16-bug-fixes.md 与批次目录。
- 问题:违反「代码变更同步 CHANGELOG」事实契约,后续读者无法从 CHANGELOG 追溯最近 shipped work。
- 建议:补两条摘要,指向 tech/16 与 20260820-boss-bugfix 批次报告。
- 需用户决策:否。

### #3 [Medium][data] radar drops 同公司多 slug 重复(地图多 pin)
- 位置:radar/4399.json + 4399游戏.json(careerUrl 均 hr.4399om.com)、dexmai原力灵机.json + dexmal-原力灵机.json(均 dexmal-inc.jobs.feishu.cn,两招聘项目)、nvidia.json + nvidia英伟达.json、tp.json + tp-link.json、sharpa.json + sharpa-robotics.json、minimax.json + minmax.json、上海电气.json + 上海电气集团.json;合并逻辑 server/src/lib/recruitment-source.ts:250(`bySlug.get(company.slug)` 精确匹配)。
- 现状:import 去重仅按原样 slug(`recruitment-import.ts:157` dedupeSourceCompanies),同公司不同 slug 全部保留;official-career/MiniMax.json 与 radar/minimax.json、official-career/Momenta.json 与 radar/momenta.json 也因大小写不同不合并。
- 问题:地图同一城市出现同公司多个 POI(4399 与 4399游戏 同在广州),列表/搜索/聚合计数重复;「669 companies」口径含重复。
- 建议修法:人工确认各对后,建 slug 别名表或按 (名称归一,城市) 合并;修后 import plan 计数会下降,需同步 data-quality.md。
- 影响面:地图展示、聚合徽章计数、import plan 口径。
- 需用户决策:是(数据合并口径:同官网/同品牌是否合并、以哪个 slug 为准)。

### #4 [Medium][data] 双重 https 前缀导致投递链接不可用
- 位置:radar/中国科学院空天信息创新研究院.json:10,34、radar/bdo立信.json:10,43(`"careerUrl": "https://https://zhaopin.aircas.ac.cn/"` 等 4 处)。
- 现状:全库 grep `https://https://` 仅此 2 文件 4 处;JD 面板 apply 链接与公司官网链接均指向非法 URL。
- 问题:这两家公司岗位的「投递」按钮不可点/报错,属明确数据缺陷。
- 建议:数据修正去前缀;`plan-seed-import.mjs` 校验器加 URL 归一断言(以 `http(s)://` 开头且不含重复 scheme)防复发。
- 影响面:2 家公司岗位的投递转化。
- 需用户决策:否。

### #5 [Medium][data] slug/显示名拼写错误
- 位置:radar/akuna-capitai.json:2(slug)、:4(显示名);radar/doiphindb智臾科技.json:4(显示名「DoIPhinDB智臾科技」);radar/hrnetgronp.json:2;radar/中信证劵南华.json:2。
- 现状:akuna-capitai 官网为 akunacapital.com;智臾科技官方品牌为 DolphinDB(文件名为 doiphindb);hrnetgronp 应为 HRNet Group;「证劵」为「证券」别字。slug 直接成为 poiId/siteId 入库。
- 问题:DoIPhinDB 显示名错误直接可见;错 slug 成为稳定 id,后续修正成本随引用增长。
- 建议:修正 name(显示)与 slug;slug 变更需同步 DB(016 site_key 可作迁移锚点)。
- 影响面:展示正确性、数据 id 稳定性。
- 需用户决策:是(改名是否影响已保存/投递引用,建议修正时保留旧 slug 别名)。

### #6 [Medium][frontend] map-shell 巨型组件仍未拆分
- 位置:server/src/components/map-shell.tsx(2769 行)。
- 现状:上轮 all 扫描 #6 原样存在;2026-08-20 批已把视口加载器抽到 `useWorkViewport`(净删 566 行),但组件仍承载搜索/建议/抽屉手势/账户/收藏/缓存还原/收藏图层等全部编排。
- 建议:继续按职责抽 hooks(搜索状态、模式缓存还原、收藏图层),用现有 component-contracts 测试兜底;可单列一批。
- 需用户决策:否(重构按 CONTRIBUTING 流程验证)。

### #7 [Low][backend] /api/pois/[id] 双重解码可致 500
- 位置:server/src/app/api/pois/[id]/route.ts:19-20(`const id = decodeURIComponent(rawId)`;rawId 来自 `await params`)。
- 现状:Next 动态段已解码,二次 decodeURIComponent 遇裸 `%`(如 `/api/pois/100%25` → `100%`)抛 URIError;无 try/catch → 500;id 亦无长度上限(进 publicCacheKey)。
- 问题:公共端点对畸形输入返回 500 而非 400/404;双解码也改变含 `%` 的 id 语义。
- 建议:去掉 decodeURIComponent(或包 try/catch 回 400),加 id 长度上限。
- 需用户决策:否。

### #8 [Low][crawler] robots 获取失败默认允许
- 位置:crawler/app/domain_map_importer/acquire.py:143-152。
- 现状:`fetch_robots` 抛网络异常或 status ≥400 时 `robots_allows` 返回 True(允许抓取);上轮 all 扫描 #13 未修。
- 建议:404/无 robots → 允许(惯例);超时/网络错误/5xx → 拒绝(保守)。
- 需用户决策:是(采集策略口径;失败即拒可能漏掉可用站点)。

### #9-#15 [Low] 明细
- #9 CLAUDE.md:7「Next.js 15」与 README:76「Next.js 15 app」:CHANGELOG 2026-08-20 已升级 16.3.1,README:19 亦写 16.3.1;两处 15 为遗漏/自相矛盾。
- #10 tech/05-milestones.md:35 版本号「Next 15.5.23, React 19.0.8, TS 5.9.3」过时(现 16.3.1 / 19.2.8 / 5.9.3);:4 Last reviewed 2026-08-16 与 :9-13 内容(08-19)不符。
- #11 README:14「64 unit tests pass」与 crawler/tests 66 个 `def test_` 差 2,无 skip 装饰器;需实际运行核对(只读扫描不执行)。
- #12 agent.md:115/:185/:210/:246 的 `tech/roles/development/implementation/<phase>.md` 路径不存在且未标注规划态,与 :108/:245 的标注惯例不一致。
- #13 仓库根 `page-loaded.yml`(Playwright 可访问性快照)+ `state-check.png`(1200×819 截图)未跟踪且违反 .playwright-mcp 约定;12 个 20260819-* 批次目录(含已完成的 regression-fix/mobile-ux 等)与 quality-scans/20260819-* 目录全部未跟踪(未入库)。
- #14 串味行(147 行/76 家, city 标签↔坐标矛盾)仍存于 DB,查询层(companySitesSpatialSql + cityLabelMatchesCoordinates)双端过滤,数据修正记 deferred 未执行。
- #15 tech/16:50 的 488 计数未同步到 README/CHANGELOG(并入 #1 处理)。

## 建议修复批次(供 boss 审批)

- 批次 A(数据修正 — radar drops):#3(同公司 slug 合并,需人工确认表)#4(双 https)#5(slug/名称拼写)。数据修正后 import plan 计数变化需同步 data-quality.md,再跑 plan-seed-import 校验。
- 批次 B(文档数字与事实同步):#1(测试计数统一,先跑 npm test 取权威值)#2(CHANGELOG 补条目)#9 #10 #12 #15。
- 批次 C(后端/采集加固):#7(pois/:id 解码与上限)#8(robots 失败策略,口径确认后)。
- 批次 D(前端拆分,大工程):#6(map-shell 继续抽 hooks,component-contracts 门禁)。
- 批次 E(仓库卫生):#13(清理根 Playwright 产物 + 批次目录入库)。
- 需用户决策(暂不派):#3 的合并口径(同官网/同品牌是否合并、以哪个 slug 为准);#5 的改名是否影响已保存引用;#8 的 robots 失败策略;#14(串味行数据修正属数据批,需执行窗口)。

## 修复状态回填(2026-08-21)

> 依据:20260820-boss-scan-optimize 批(ws-docs/ws-api/ws-data + boss 主树 b8d5fc1)实际修复情况
> 与代码复核;未修项统一追踪见 `tech/roles/development/deferred-ledger.md`。

| # | 发现 | 状态(2026-08-21) | 说明 |
|---|---|---|---|
| 1 | 测试计数三处漂移 | 已修 | ws-docs 统一写回(488);后续批次继续维护计数 |
| 2 | CHANGELOG 缺 2 条目 | 已修 | ws-docs 补 `788e9c6`(positions-dedup)与 `933f972`(work 全量加载) |
| 3 | 同公司多 slug 重复 | **未修** | 数据口径待用户拍板 → 见 deferred-ledger **D-19** |
| 4 | 双重 https 前缀 | 部分 | JSON 已修(ws-data)+ import 校验器 URL 断言;DB 待重新 import → 见 deferred-ledger **D-21** |
| 5 | slug/显示名拼写错误 | **未修** | 数据口径待用户拍板(akuna-capitai/doiphindb/hrnetgronp/中信证劵仍在)→ 见 deferred-ledger **D-20** |
| 6 | map-shell 巨型组件 | **未修** | 2817 行(2026-08-21);继续抽 hooks → 见 deferred-ledger **D-18** |
| 7 | /api/pois/[id] 双重解码 500 | 已修 | ws-api(去二次解码 + MAX_ID_LENGTH 256;代码复核确认)→ 见 deferred-ledger D-22 |
| 8 | robots 失败策略 | **未修** | acquire.py:143-152 仍默认允许;采集口径待用户拍板 → 见 deferred-ledger **D-05** |
| 9 | Next.js 15 过时标注 | 已修 | ws-docs(CLAUDE.md/README 统一 16.3.1) |
| 10 | tech/05 版本号过时 | 已修 | ws-docs(16.3.1 / 19.2.8 / 5.9.3 + Last reviewed 更新) |
| 11 | crawler 测试计数 64 vs 66 | 已修 | 本批 ws1:README:14「64 unit tests pass」→「103」(2026-08-21 `make test-unit` 实测) |
| 12 | agent.md 引用不存在的 implementation/ 路径 | 已修 | ws-docs(统一标注「规划,目录尚未建立」) |
| 13 | 仓库卫生(根产物 + 批次目录未入库) | 已修 | boss 主树直接完成(dev b8d5fc1:9 批次目录 + 2 扫描报告入库、.gitignore 排除 logs、根 Playwright 产物已删);其余批次随后续合并陆续入库 |
| 14 | 串味行仍存 DB | **未修** | 查询层+聚合层双防御;数据修正待执行窗口 → 见 deferred-ledger **D-01** |
| 15 | tech/16 计数未同步(并入 #1) | 已修 | 随 #1 统一修正 |
