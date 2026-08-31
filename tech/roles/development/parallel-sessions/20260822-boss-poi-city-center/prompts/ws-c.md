# Workstream ws-c — fix/geocode-r5-readiness(r5 就绪核查 + 基线诊断 + tech 文档)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree 内开发,不 merge、不 push、不碰主树。**
汇报写入批次目录 reports/ws-c.md(末两行 token,见文末)。

## 背景

「大量 POI 位于城市中心」bug 的修复链:ws-a 落地 grader 放宽 → 用户跑 geocode r5 apply
(Env-only,不自动跑)→ 用户跑 import:seed:apply(Env-only)→ UI 恢复。ws-c 负责**把 r5
这条链路钉死**:核查 apply 工具链就绪度、产出 r5 执行前基线、把操作清单写进 tech 文档
(文档维护契约:代码变更同步 tech/)。

## 任务

1. **r5 工具链就绪核查**(只读):
   - `server/scripts/geocode-sites-apply.mjs`:确认「多城市占位地址站」走公司名 place-text
     检索分支(memo 变体 key / 每站 ≤2 次 / 裸公司名 `cleanCompanySearchName`),r5 无需代码改动;
     若有缺口,如实报告(不修,记入回报「遇到的问题」,boss 裁决)。
   - `server/scripts/plan-site-geocode.mjs` dry-run(只读)记录 r5 前基线:
     `companies / alreadyLocated / needs / skippedNoAddress`(2026-08-22 实测:
     companies 916 / alreadyLocated 962 / needs 1248 / skippedNoAddress 0,以你实测为准)。
   - 中心钉点构成(口径:city-centers.ts 的 CITY_CENTERS ±0.0005):
     需重跑 / 留中心(城市名占位)/ 无地址 三分类计数(2026-08-22 实测:
     1346 = 1092 + 249 + 5;分布 radar 1232 / official-career 106 / qqdoc-jobs 8;
     1092 中 ~941 城市列表占位地址、~151 真实街道地址。以你实测为准)。
2. **tech 文档**:在 `tech/` 下新增或更新一篇「geocode r5 状态与操作清单」文档
   (先看 `tech/` 目录结构与既有 geocode 相关文档编号,对齐风格;若无合适既有文档则新增
   下一编号,如 tech/25;如有则更新)。内容:
   - 现状:城市中心钉点 1346 的构成与 top 城市表;r4 已修 288;r5 待跑 1092(前置:grader
     放宽 ws-a 落地)
   - r5 操作清单(用户执行):`cd server && npm run geocode:sites:apply`(AMap place-text
     日配额 100 次 + 百度/腾讯兜底,可分多日;w10 语义:城市名地址站留中心、有街道地址站
     重跑)
   - import 落地:`npm run import:seed:apply`(r5 后;DB 当前实测 1556 中心站 > JSON 1346,
     即 r4 数据从未 import)
   - UI 验证:地图堆叠下降;`MODE_CACHE_VERSION` bump 时机
   - 引用:batch 目录、commit hash(3e6deb3 r4)
3. **验证脚本(可选,加分)**:若 10 分钟内可完成,加一个只读诊断脚本
   `server/scripts/audit-city-center-pins.mjs`(输出 DB+JSON 双口径中心钉点计数与构成,
   复用 site-geocode.ts 的 cityCenterBareNames/matchesCityCenter);若超时则跳过并在回报说明。

## 文件边界

- 可改:`tech/` 下文档(新增或更新)、可选 `server/scripts/audit-city-center-pins.mjs`(新增)
- 不碰:site-geocode.ts / site-geocode.test.mjs(ws-a 领地)/ 数据文件 / 前端
- 不跑任何 apply/geocode/import(Env-only)

## 门禁(全部通过才算 OK)

```bash
cd /Users/acccan/dm-wt-pcc-c/server && npm test
cd /Users/acccan/dm-wt-pcc-c/server && npm run typecheck
cd /Users/acccan/dm-wt-pcc-c && make docs-check
git diff --check
```

参考基线(主树 2026-08-22 实测):全量测试 ~1360+ pass / 0 fail / 2 skip。commit 用
Conventional Commits(`docs(geocode): …`)。

## 回报(写入 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-poi-city-center/reports/ws-c.md)

- r5 工具链就绪核查结论(逐项:就绪/缺口)
- r5 前基线(plan dry-run 实测数字 + 中心钉点构成)
- 文档产出(文件路径 + 章节摘要)
- 门禁结果 + 遇到的问题 + 证据
- 末两行 token(必须精确):
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

**不要 merge、不要 push、不要碰主树。worktree 已预建。**
