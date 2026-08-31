# Workstream p-cache-snapshot — v19 bump + 中心钉契约计数快照(geocode 落地善后)

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-p-cache-snapshot`,分支 `fix/post-geocode-cache-v19`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点(应含 `313fc61` 数据落地 commit)。

## 背景

用户已执行 r5 apply:135 个站点 JSON 的 address/lng/lat 被改写为真实办公点(commit `313fc61`,纯数据 diff)。两个既定善后项:

**① 缓存版本 bump(tech/29 §4.5/§7 既定):**
`server/src/lib/mode-cache.ts` `MODE_CACHE_VERSION` 当前 **18**(v18 = 2026-08-25 读路径语义两连修占用)。r5 数据落地后需 bump **19**,让旧 sessionStorage 缓存(旧坐标目录)失效重拉。版本历史注释块(文件顶部)追加 v19 段:`// v19(2026-08-25 r5 geocode 落地):135 站占位/中心钉坐标落真实办公点——旧缓存含旧坐标, bump 使其失效重拉。`(措辞以实际数据为准,风格跟随 v14/v18 段)。

**② 数据契约测试计数快照漂移(merge-report 遗留 #2):**
`server/tests/city-center-pins.test.mjs` 用例「中心钉点站数据契约: 城市名地址留中心 / 非城市名地址重新 geocode」断言 `rows.length >= 1000`;r5 后主树实际 **977**(大量站点已离开中心桶)。test 文件头注释自述该计数是「会随 apply 重跑漂移」的量级下限,但 58 行仍钉了过时阈值。处理原则:**读测试头注释的意图(量级守卫),把阈值调到与当前数据相称的下限**(如 >= 900 或按你读到的注释语义调整),并在断言消息/注释中注明快照基准(r5 后 977,2026-08-25);若注释语义要求的是「精确快照」,改为精确数并注明重跑后会再漂。同文件其余用例(占位/无地址 → place-search 通道等)若也因数据变化红/语义过时,一并按新事实修正;**不得删除断言弱化守卫**。

> 注意:worktree 从 dev 切出,自带 `313fc61` 新数据 → 本地跑测试即复现 977 口径,无需 DB。

## 任务

1. `server/src/lib/mode-cache.ts`:v18 → **19** + 版本历史注记;检查 `server/tests/mode-cache.test.mjs` 是否有版本号断言,同步。
2. `server/tests/city-center-pins.test.mjs`:按上述原则修计数快照;跑通全部用例。
3. `tech/29-geocode-r5-status.md`:§4.5/§7 时间线勾掉「UI 验证 + bump v19」(标注完成日期与 commit);§4.2 排程表如有「多日 apply」状态同步(135 站已完成的事实);若有 Nominatim 海外执行等仍待办项保留不动。其它文档(`tech/18` 等)如描述缓存版本或中心钉计数处过时,一并最小同步。
4. 全量门禁必须绿(本地无 DATABASE_URL,3 skip 属正常):
```bash
cd /Users/acccan/dm-wt-p-cache-snapshot/server && npm test
cd /Users/acccan/dm-wt-p-cache-snapshot/server && npm run typecheck
cd /Users/acccan/dm-wt-p-cache-snapshot && make docs-check && git diff --check
```

## 文件边界

**拥有**:`server/src/lib/mode-cache.ts`、`server/tests/{mode-cache,city-center-pins}.test.mjs`、`tech/29-geocode-r5-status.md`(及其它过时文档的最小同步)。

**不碰**:数据文件(server/data/**)、`server/src/lib/{recruitment-store,server-catalog,site-geocode}.ts`、scripts/**、组件/hooks、`.env*`、主树。

## 提交

Conventional Commits(`fix(cache): bump MODE_CACHE_VERSION to 19 — r5 geocode 数据落地`、`test(pins): 中心钉计数快照 977 — r5 后站点离开中心桶`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260826-boss-post-geocode/reports/p-cache-snapshot.md`,末两行:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
