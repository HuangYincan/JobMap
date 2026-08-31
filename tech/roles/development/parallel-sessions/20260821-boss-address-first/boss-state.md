# Boss State — 20260821-boss-address-first

## meta
- slug: 20260821-boss-address-first
- date: 2026-08-21~22
- batch_dir: tech/roles/development/parallel-sessions/20260821-boss-address-first
- goal: 为所有不带地址的点配好地址(优先上网查找,可派 subagent 逐个找)✅ 终态
- owner: boss(autonomous;用户 /goal 授权执行)

## 终态(2026-08-22 数据处理闭环)
- **地址**:392 站 379 有地址(96.7%);13 真无地址(海外小公司/新成立,二轮再查后如实保留)
- **坐标**:DB 2351 站 **2152 有坐标(91.5%)**——r3 apply(province-infer 修复后)293 站新落,已 commit 05a2a85 + push;import:seed:apply 已同步 DB(wrote: true)
- **残余 199 无坐标**:41 海外(AMap 不支持海外 geocode,deferred)+ ~150 国内「城市文本站」(公司在该城无公开办公室/城市中心表 86 城未覆盖,已尽力)+ 13 无地址
- **门禁**:npm test 1299 pass/0 fail(合并时);dev = 05a2a85 已 push

## 盘点(2026-08-21)
- 无地址站点 373 个 = qqdoc-jobs 203 + qqdoc-official 123 + embodied-jobs 47(333 家公司)
- 有地址缺坐标 226 个 = official-career 205 + qqdoc-official 19 + radar 2(apply 主通道,key 就绪)
- DB company_sites 与 drop 口径一致(2351 行:no_address 373 / addr_no_coord 226)
- city 字段含脏数据(「西安 咸阳」「上海 苏州 广州…」多城市文本)

## stage
- current: DONE(终态:r4+r5 落地 + DB 同步 + 已 push)
- updated_at: 2026-08-22

## 终态(2026-08-22 城市中心堆叠修复闭环)
- **w9 合并**(5f29134):siteNeedsGeocode 扩展——中心坐标+街道地址 → 需要重跑
- **r4 apply**:1579 attempted → 288 站落真实坐标(commit 3e6deb3)
- **w10 合并**(9ef8106):office POI 匹配放宽(限定词 token 序列),831 no-result 中复合限定词类转命中
- **r5 apply**:1291 attempted → 16 站落真实坐标(腾讯北京总部大楼等,commit 9d785da);无配额信号,~800 站检索真无索引 POI
- **MODE_CACHE_VERSION 15→17**;import:seed:apply wrote:true(2351 站);测试 1419 pass/0 fail/2 skip;dev=9e693a9 已 push
- **DB 堆叠实测**:上海 376→329、北京 327→279、深圳 248→207、成都 128→111、广州 121→113、武汉 64→57、南京 52→45、西安 46→41、杭州 30→27(合计 ~234 站移出中心)

## workstreams
| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| w1 | fix/geocode-address-first | /Users/acccan/dm-wt-addr | prompts/w1.md | reports/w1.md | MERGED | acc51c6 | 2026-08-21 | 2026-08-21 | OK |
| w2 | fix/address-backfill | /Users/acccan/dm-wt-backfill | prompts/w2.md | reports/w2.md | MERGED | 790682e | 2026-08-22 | 2026-08-22 | OK(w2-fix 裁决:canary 测试更新后全绿) |
| w3 | fix/geocode-qqdoc-embodied | /Users/acccan/dm-wt-geo-ext | prompts/w3.md | reports/w3.md | MERGED | 86db7dd | 2026-08-22 | 2026-08-22 | OK |
| w4 | fix/address-backfill-r2 | /Users/acccan/dm-wt-backfill-r2 | prompts/w4.md | reports/w4.md | MERGED | 93cd40a | 2026-08-22 | 2026-08-22 | OK |
| w5 | fix/embodied-loc-contract | /Users/acccan/dm-wt-testfix | prompts/w5.md | reports/w5.md | MERGED | eb394c4 | 2026-08-22 | 2026-08-22 | OK |
| w6 | fix/seed-import-env | /Users/acccan/dm-wt-seed-env | prompts/w6.md | reports/w6.md | MERGED | db97861 | 2026-08-22 | 2026-08-22 | OK |
| w7 | fix/geocode-province-infer | /Users/acccan/dm-wt-prov | prompts/w7.md | reports/w7.md | MERGED | 4000bcf | 2026-08-22 | 2026-08-22 | OK |
| w9 | fix/geocode-citycenter-rerun | /Users/acccan/dm-wt-center | prompts/w9.md | reports/w9.md | MERGED | 8b54793 | 2026-08-22 | 2026-08-22 | OK |
| w10 | fix/geocode-grader-relax | /Users/acccan/dm-wt-grader | prompts/w10.md | reports/w10.md | MERGED | fafaf9b | 2026-08-22 | 2026-08-22 | OK |

## VERIFY(2026-08-22)
- w10 已并入 dev(9ef8106,no-ff parents 6dfbe9a+fafaf9b;与 agent-bugfix 批次 merger 并发提交,内容核对 = w10 完整改动集 +77/+56/+19,门禁 1415 pass/0 fail/2 skip;提交信息为其批次文案,内容正确不 rewrite)
- `git branch --contains fafaf9b` = dev ✓;origin/dev 已含
- 下一步:r5 apply(grader 放宽后重跑 1248 needs)→ 提交产物 → import:seed:apply → 验证堆叠下降

## 裁决(2026-08-22)
- r4 数据引发 2 个数据契约测试红(HZ 框 sweep:蔚来-site-绍兴 真坐标 120.512/30.093 落杭州框;split-city:临界点主站不再等于 cityCenter)。boss 直接在 w10 worktree 补测试修正提交 6193ba1(在 worker 文件边界之外,无碰撞;门禁复验 1374 pass/0 fail),随 w10 一并合入。
- w10 汇报问题 1(智图案例自相矛盾):worker 裁决正确——「智图-with-百度」= no(保 2026-08-19 得物防线),子品牌名「百度智图」= strong;r5 影响 ≈ 0(百度研发大厦已过)。接受。
- w10 外部 spawn 三次被终止(API/任务不稳定)→ 改进程内 Agent 通道派发成功。

## r4 落地(2026-08-22,用户授权 Env-only)
- apply r4:1579 attempted → **288 落盘**(WRITTEN: 288),无配额短路;上海 376→347
- 残余 1346 中心堆叠 = 941 多城市占位地址 + 250 城市名(合理留中心)+ 150 街道地址(门拒,重跑可再试)+ 5 无地址
- 根因(活体诊断):831 no-result 主因 grader 严格(「百度研发大厦」复合限定词被拒)→ w10 放宽
- 已提交:`3e6deb3`(data r4)+ `df4b26d`(MODE_CACHE_VERSION 15→16);import:seed:apply wrote:true(2351 站/12285 岗位);dev 领先 origin/dev 2 commits 待 push

## 找地址批次结果(17/17 完成)
- 命中 353/398(88.7%):high 210 / medium 123 / low 1;null 45(海外小公司/无门牌,如实标注)
- 全部带来源 URL;多城市拆分与实体识别(国机重汽→国机重装、一众→一重、恪赛等)已处理
- 故障恢复:402 欠费致并发中断 → 串行续跑 → 余额恢复后并行收官

## merge_order
1. w1(单分支)

## adjudication_log
- 2026-08-21 | w1 | docs-check 红(既有基线:thinkfix/tencent-geocode merge-report 复述 grep 正则自匹配,非 w1 引入,零新增) | 接受,merger 按「排除 parallel-sessions untracked 产物」口径判定,门禁记 PARTIAL_RED 继续 | MERGED_ALL(acc51c6,已 push)
- 2026-08-21 | - | 真实 geocode 执行被权限 deny(geocode:* 硬 deny) | 记 deferred-notes,用户自行执行 | 用户 2026-08-22 已自行执行(exit 0)
- 2026-08-22 | w2 | 3 个真实数据 canary 测试(embodied location={} / 新东方西安 city='西安 咸阳' / 临界点 location 无 address)断言回填前旧值,与回填冲突 | 授权更新 3 个测试为回填后状态(re-dispatch w2-fix,同 worktree) | RUNNING

## deferred_notes
- Env-only:合并后用户需跑 `npm run geocode:sites:apply`(AMAP_WEB_KEY/百度/腾讯 key)落地真实检索;
  需同步 DB 时再跑 `npm run import:seed:apply`(DATABASE_URL)。boss 不自动执行。

## next_plan
- ✅ 找地址(17 批)+ w1~w10 全部合并 + r4(288)/r5(16) apply + MODE_CACHE_VERSION 17 + import:seed:apply + DB 验证 + push
- 剩余可选(用户决定):~800 多城市占位站需 w2 式逐公司网络检索(大工程,见 deferred-notes)

## recovery
- last_stage_written: PLAN(README/prompts/boss-state 已写)
