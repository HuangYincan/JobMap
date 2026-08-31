# Manifest — 20260819-boss-qa-fixes

## 目标

全库代码审查(boss-scanner all,`tech/roles/development/quality-scans/20260819-all/scan-report.md`)16 条发现中,技术类 14 条批派本批修复。另含先前 docs 扫描 27 条(20260819-docs/scan-report.md)。

## 裁决(2026-08-19 boss)

- **派发**:#1(geom_geog 索引)、#4(OTP 限流+尝试上限+过期清理,demo hint 保留)、#5(写路径不静默降级)、#7+#10+#11+#12(API 输入/缓存/节流/校验加固)、#8+#9(死代码)、#2+#3+#14+#16(文档同步)
- **deferred**(见 cluster-tune 批次 deferred-notes):#4 真实 OTP 发送(产品决策)、#13 robots 失败策略口径、#15 全国 geocode(Env-only)、#6 map-shell 拆分(单列批次)

## workstreams

| ws | 分支 | 主题 | 文件 | 状态 |
|---|---|---|---|---|
| ws-qa1 | fix/qa-geom-index | #1 geom_geog gist 索引接线(radius 路径免 cast) | spatial-query.ts、tests | PENDING |
| ws-qa2 | fix/qa-otp-account | #4 OTP 限流+尝试上限+过期清理 + #5 withDb 写路径不静默降级 | auth/otp/*、account-store.ts、tests | PENDING |
| ws-qa3 | fix/qa-api-hardening | #7 搜索缓存 key/无 bounds 上限 + #10 输入长度 + #11 通知冷却 + #12 saved 校验 | search、suggest、me/notifications、me/saved routes、tests | PENDING |
| ws-qa4 | fix/qa-deadcode | #8 MODES.internship 死代码 + #9 api.ts 死导出/过时注释 | modes.ts、api.ts、tests | PENDING |
| ws-qa5 | fix/qa-docs | #2 docs 扫描 27 条 + #3 测试计数 423/421/2 + #14 data-quality 口径 + #16 批次 manifest | tech/、README、CHANGELOG、CLAUDE.md、agent.md、CONTRIBUTING | PENDING |

## 合并顺序

qa1 → qa2 → qa3 → qa4 → qa5(文件互不冲突,可并行开发;合并按完成序)

## 门禁基线(2026-08-19 boss 实测)

- `cd server && npm test` → 423 tests / 421 pass / 2 skip(权威计数,文档同步以此为准)
- `npm run typecheck`、`make docs-check`、`git diff --check`

## 后续里程碑

- MERGE → VERIFY(EXPLAIN 验证 radius 走索引)
- #6 map-shell 拆分(单列批次)
- 持续优化

## 最终结果(2026-08-19)

- **qa1–qa5 全部合并**:dev @ 77ea603(443/441),5 个 merge commits,已 push origin/dev。
- **qa6(map-shell 拆分)**:dev @ 9b5f94a(447/445),map-shell 2822→2666 行(-156),3 hooks 抽取,行为零变化;浏览器 VERIFY 通过(地图渲染/搜索列表/POI 详情全正常,Bug3 契约零变化,无新 console error)。
- **扫描 16 条发现**:14 条技术项已修复合并;**deferred 4 类**:#4 真实 OTP 发送(产品决策)、#13 robots 口径、#15 全国 geocode(Env)、docs #20/#23(用户决策)。docs 扫描 27 条修复 25 条。
- **测试基线**:447 tests / 445 pass / 0 fail / 2 skip。
