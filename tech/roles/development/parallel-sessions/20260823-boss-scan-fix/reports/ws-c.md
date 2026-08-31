# ws-c 汇报(2026-08-23 · feature/scan-docs-factsync)

## 实际改动

### #5 [Medium] server/README.md 大段过时(commit `0ddee6c` + `250ab5a`)
- 头部:Status 改为「Phase 2–4 + 全国 work 模式已合入 dev(2026-08-21 起)… 以根 README 与 tech/ 为准」;Framework `Next.js 15.5` → `Next.js 16.3.1 + React 19.2.8`(以 package.json 为准);Map Engine 改为三引擎插件契约(AMap / 腾讯 TMap / 百度 BMapGL,图层面板「地图源」切换,偏好 localStorage,tech/23)。
- Quick Start:环境变量节补三引擎 key 指引(server/docs/environment-variables.md)。
- Fallback Behavior:改述为 mount.ts 真实语义(偏好引擎 → ENGINE_PRIORITY 回退其余已配置引擎 → 全部失败回退 CSS fallback 地图)。
- Development Commands:删除不存在的 `npm run lint`(package.json 无 lint script);补 `npm test`(1470)并注明 env-only 数据命令在根 README。
- Architecture「Map Adapter Pattern」:删除已删文件 `lib/map-adapter.ts` 的代码示例(零引用,tech/23 已确认删除),改写为 `lib/map-engine/` 契约层(types / amap / tencent / baidu / registry / preference / switch / mount)+ `searchPOI` 注入 poi-service。
- Data Flow:`Map Engine (AMap)` → 契约层三引擎;市外检索改为「活跃引擎 searchPOI(未注入回落 amap-api)」——已核实 `use-map-engine.ts:305,356,395` 调 `setActiveSearchProvider`。
- Known Limitations:删「Single map engine: AMap only」(已三引擎+切换);OTP 条目重写为真发(phone 阿里云短信、email Resend,未配置 → 503 EMAIL_NOT_CONFIGURED / SMS_NOT_CONFIGURED,000000 stub 已删,server/src grep 0 命中);「DB write fallback 是已知加固项」改为设计决策:写路径抛 DbUnavailableError → 503 DB_UNAVAILABLE,绝不静默回落内存(account-store.ts:135-136,223-234 实测);mount 失败改述为 retry 覆盖层。
- Automated Tests:`600/598` → `1470 tests / 1468 pass / 0 fail / 2 skip(2026-08-23,npm test 实测)`。
- Account & API:OTP 行重写(真发 + OAuth 登录 tech/27);footer Last Updated `2026-08-19` → `2026-08-23`。
- 修正 tech/23 引用为仓库根相对路径(2 处)。

### #6 [Medium] 测试计数 6 处互斥(commit `ef9cbe8`)
统一写回 **npm test 实测(本 worktree 实跑):1470 tests / 1468 pass / 2 skip,2026-08-23**:
- `CLAUDE.md:43` `568 测试(566 pass / 2 skip,2026-08-21)` → `1470 测试(1468 pass / 2 skip,2026-08-23)`
- `agent.md:360` `(568 测试,2026-08-21)` → `(1470 测试 / 1468 pass / 2 skip,2026-08-23)`
- `CONTRIBUTING.md:49` `(568 tests, 2026-08-21)` → `(1470 tests / 1468 pass / 2 skip, 2026-08-23)`
- `README.md:19` `568 tests pass (566 pass / 2 skipped, 2026-08-21)` → `1470 tests pass (1468 pass / 2 skipped, 2026-08-23)`
- `tech/05-milestones.md:11` `488 tests / 486 pass / 2 skip(2026-08-20)` → `1470 tests / 1468 pass / 2 skip(…,2026-08-23)`;Last reviewed 08-20 → 08-23
- `server/README.md:249`(见 #5)。
- **例外(CHANGELOG.md:13,需 boss 知晓)**:该行是 2026-08-21 qqdoc-official 批次**并入时**的历史计数(「19 用例(全量 568:566 pass / 2 skip)」),改写成 1470 会伪造历史;保留原值,并在新 2026-08-23 条目末尾写入当前实测(1470 / 1468 / 2)作为现行口径。

### #7 [Medium] CHANGELOG 补条目(commit `57add8f`)
- 新增 `## 2026-08-23`(Fixed):engine-polish-2 轮8–10(ws-i MultiMarker 初始渲染竞态 + icon 预检链式推进;ws-j 腾讯矢量底图排除 point「混合块」;ws-k 腾讯 POI 徽章真 logo fetch 字节内联 + pan/LOD 升级;ws-l 百度滚轮缩放徽章闪烁 markerMouseTarget pane + rAF 按帧重算)末尾附**当前套件实测 1470 / 1468 pass / 2 skip(2026-08-23)**。
- 新增 `## 2026-08-22`(Added 3 + Fixed 4):OAuth 登录(tech/27,oauth-backend/frontend/docs + oauth-callback-500 + auth-recovery)、阿里云短信 OTP 真发(feature/aliyun-sms-send,删 demo 000000 stub,tech/26-aliyun-sms.md)、Agent Memory(migration 018 + memory-store + builtin__memory_save + /api/me/memories + 管理 UI,tech/26-agent-memory.md)、收藏图层 mobile sheet 修复(fx,09a5cd7)、首访卡死 loading-hang ws1–4、三引擎打磨系列(tmap-polish 轮1–2 / tmap-interaction 轮1–3 / engine-polish-2 轮1–6)、AI agent 系列(bugfix/inputbar/navi/parallel-stream/mobile-agent-embed)、geocode r4/r5(地址回填 342/373 站、5 源覆盖、城市中心 304 站、audit-city-center-pins,tech/29)。
- **补充 2026-08-21 漏记 3 条**(证据日期均为 08-21,故按历史归属补在该节):多地图引擎插件契约落地(feature/map-engine a–f,tech/23)、头像真实存储(migration 017_avatar_data,feat/avatar-username + avatar-account-label)、i18n 选项标签(feature/i18n-option-labels-*)。
- 证据纪律:扫描报告引用的批次目录 `20260822-oauth-login` / `20260822-aliyun-sms-otp` / `20260822-boss-saved-layer-toggle` / `20260822-boss-loading-hang` **在仓库中不存在**(`ls parallel-sessions/` 复核),故条目只引用**已验证存在**的批次目录与 commit hash(如 20260822-boss-engine-polish-2、20260822-boss-tmap-polish/interaction、20260822-boss-agent-bugfix/inputbar/navi/parallel-stream、20260821-boss-address-first)及 git log 日期。

### #8 [Medium] README / data-quality 数据口径(commit `b16c0d9`)
- `README.md:15` 重写:drops 计数(实测 `ls` 复核)**radar 646 / official-career 78 / qqdoc-official 142 / qqdoc-jobs 163 / embodied-jobs 47**;boss/nowcoder/shixiseng stub;import plan **companies 1040 / sites 2351 / positions 12932 / dropped 0 / issues []**(2026-08-23 plan-seed-import dry-run,boss 实测);pin 数:79 pin(2026-08-17 杭州 pilot)保留为历史事实,当前精确 pin 数**待下次 apply 后回填**。
- `README.md:16` national scope 行:「全国 geocode 仍 pending」改为已扩 5 源 + 342/373 站地址回填 + r4/r5 分层(2026-08-22);Domain 市外检索按活跃引擎 searchPOI 改述。
- `README.md:17` migrations `001–016` → `001–018`(017 avatar / 018 memories);live-write 历史(137/137/240,2026-08-17)保留 + 后续 apply 属用户操作、实入行数待回填。
- `README.md:20` official-career 51 → 78 家(2026-08-23 计数)+ 首版 51/32 历史说明。
- `README.md:75` layout `migrations 001–016` → `001–018`。
- `tech/roles/data/data-quality.md`:Status 行更新(08-23 口径刷新说明);原「669/1440/877」行保留为 2026-08-17 历史快照并**新增**「Import plan 现行口径(2026-08-23 dry-run 实测):1040 / 2351 / 12932 / 0 / []」;新增「Drops 现状与迁移(2026-08-23)」小节(5 源计数 + etl 记录清单 + migrations 001–018)。「630 companies / 761 positions」等 08-17 段落保留(历史快照,自带日期)。

## 门禁结果
- `npm test`(本 worktree 实跑一次,取权威计数):**1470 tests / 1468 pass / 0 fail / 2 skip**(exit 0)——写回 6 处的权威数字即此值
- `npm run typecheck`:通过(exit 0,docs-only 改动,顺带验证)
- `make docs-check`:通过("Documentation policy check passed")
- `git diff --check dev...HEAD`:通过(exit 0)
- `git status`:clean;共 5 commit(0ddee6c / ef9cbe8 / 57add8f / b16c0d9 / 250ab5a),分支 `feature/scan-docs-factsync` 留在 worktree,未 merge、未 push。

## 遇到的问题
1. **CHANGELOG.md:13 历史计数**——该行是 2026-08-21 并入时的快照,按证据保留,现行数在新 08-23 条目给出(见 #6 例外)。
2. **embodied-jobs drops 数:扫描写 46,实测 47**(`ls embodied-jobs/*.json | wc -l`),按实测 47 写回。
3. **扫描报告引用的 4 个批次目录不存在**(oauth-login / aliyun-sms-otp / saved-layer-toggle / loading-hang),条目改用 git log + 实存批次目录取证。
4. **头像上传 / i18n 选项标签 / 三引擎契约**的 evidence 日期均为 **2026-08-21**(migration 017 提交 57e920d、merge f1dc329、i18n 2e79614 等),按日期补入 08-21 节而非 08-22 节——需 boss 知晓该归属判断。
5. server/README「79 pin」「2 skips 是 DB-gated」等未逐一在 DB 复验的陈述:79 pin 保留为带日期的历史事实;2 skip 归类沿用原文档。

## 证据
- 测试输出摘要:`ℹ tests 1470 / pass 1468 / fail 0 / skipped 2 / duration_ms 7566`(本 worktree `npm test`)
- 计数复核:`ls server/data/recruitment/*/*.json | wc -l` → radar 646 / official-career 78 / qqdoc-official 142 / qqdoc-jobs 163 / embodied-jobs 47;`ls db/migrations/` → 001–018
- 代码核实:`server/src/lib/account-store.ts:135-136,223-234`(DbUnavailableError 写路径)、`api/auth/otp/send/route.ts:25-26`(Resend/阿里云真发 + 503 语义)、`server/src/lib/map-engine/mount.ts`(回退链)、`use-map-engine.ts:305,356`(setActiveSearchProvider)、`grep "000000" server/src` → 0 命中、`lib/map-adapter.ts` 不存在(已删)
- git log 日期证据:OAuth d22c3f8/8e8d07ca/9300fd1(08-22)、aliyun-sms 76eec04(08-22)、agent-memory a34da06/347ee53(08-22)、avatar 57e920d/f1dc329(08-21)、i18n 2e79614(08-21)、loading-hang f5c3d17/6c780dc/8e05d2d/5165904(08-22)、engine-polish-2 轮1–6(08-22)/轮8–10(08-23)

门禁: PASSED
结论: OK
