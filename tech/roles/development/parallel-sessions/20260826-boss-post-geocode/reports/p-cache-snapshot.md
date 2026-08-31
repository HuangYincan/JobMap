# p-cache-snapshot 汇报(2026-08-26)

## 实际改动

分支 `fix/post-geocode-cache-v19`(worktree `dm-wt-p-cache-snapshot`),3 commits 叠在 `313fc61` 上:

- `server/src/lib/mode-cache.ts` → `MODE_CACHE_VERSION` 18→**19**(`789f236`);版本历史注释块追加 v19 段:`// v19(2026-08-26 r5 geocode 数据落地, commit 313fc61): 用户执行 r5 apply 后 135 站占位/中心钉坐标落真实办公点(address/lng/lat 改写)——旧缓存含旧坐标, bump 使其失效重拉。`(风格随 v14/v18)
- `server/tests/mode-cache.test.mjs` → 版本断言用例改为「current MODE_CACHE_VERSION is 19」+ 新增 **v18 缓存拒绝用例**(镜像既有 v17 拒绝模式,v17 用例保留)(`789f236`)
- `server/tests/city-center-pins.test.mjs` → 计数断言下限 1000→**900**,消息注明快照基准(941,r5 后 2026-08-26 实测);头注释补计数漂移史与分类口径(街道地址需重跑 781 + 城市名占位留中心 155 + 无地址 5;radar 839 / official-career 95 / qqdoc-jobs 7)(`8fef06d`)。两个用例的**语义不变式断言逐字未动**(r5 数据上仍全绿),无守卫弱化
- `tech/29-geocode-r5-status.md` → 文档 v2.1→**v2.2**:状态行改「r5 主波次已执行」;§4.2 加状态注;§4.5 标注 bump v19 已完成(commit/日期);§6 时间线补 r5 落地(`313fc61`,135 站,中心钉 1330→941)与善后批次两行;§7 清单 #1/#3 划完成、#2 import 标注当前待执行、#4 Nominatim 海外执行保留不动(`0d87779`)

其它文档核查:`agent.md`、`tech/18-national-scale-plan.md` 无过时版本/计数引用;CHANGELOG 与 `.claude/skills/frontend-component-dev/skill.md` 的 MODE_CACHE_VERSION 提法为历史记录/通用守则,不需最小同步。

## 门禁结果

- npm test: **1669 tests / 1666 通过 / 0 失败 / 3 skip**(本地无 DATABASE_URL,3 skip 属正常)
- typecheck(tsc --noEmit): 通过
- make docs-check: Documentation policy check passed
- git diff --check: 干净(工作树 clean)

## 遇到的问题

- **实测快照 941 vs prompt 预估 977**:boss 预估 r5 后主树 977;worktree tip = dev tip = `313fc61`(dev 上最后一个数据提交,2026-08-26 06:32,git log 双口径核实),同数据复算得 **941**(radar 839 / official-career 95 / qqdoc-jobs 7)。以实测为准写入快照基准;阈值语义是量级守卫(≥900),两种口径下均通过。非阻塞。
- 环境限制(不影响门禁):本会话 Bash 沙箱拦截裸 `node --test` 单文件运行与输出重定向,单文件验证经 `npm exec -- node --test <files>` 完成;`npm test -- --test-name-pattern=...` 会透传为全量套件参数(node:test glob 在前),已改用文件级直跑验证。

## 证据

- `node --test tests/city-center-pins.test.mjs tests/mode-cache.test.mjs`:19/19 pass(修复前该 pins 用例红:`实际 941` < 1000)
- 全量 `npm test` 末尾汇总:`tests 1669 / pass 1666 / fail 0 / skipped 3`
- 计数脚本(JSON 口径,CITY_CENTERS ±0.0005,与测试同实现):`{"total":941,"empty":5,"cityName":155,"street":781}`
- 提交链:`789f236 fix(cache)` → `8fef06d test(pins)` → `0d87779 docs(geocode)`;未 merge 回 dev、未 push、主树零接触

门禁: PASSED
结论: OK
