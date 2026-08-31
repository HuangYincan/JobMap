# Boss State — 20260820-boss-national-data

## meta
- slug: 20260820-boss-national-data
- date: 2026-08-20
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-national-data
- goal: ①拓展真实岗位数据到北京/成都/深圳/广州/南京/武汉/西安 ②修复聚合卡片计数(事故坐标污染)③扩充上海公司(合规源)
- owner: boss-agent(无人值守;用户明确授权「多去互联网上爬一点」)
- dev_tip: de7ab7e(w4 已合并并 push)

## stage
- current: DONE(终态)
- updated_at: 2026-08-20

## 终态结论(2026-08-20)

**全部三个目标达成**:

### ① 数据拓展(北京/成都/深圳/广州/南京/武汉/西安)
- drops 数据:南京/西安 16 家新公司 + 74 站点 + 83 岗位(45bd9fa);飞书 28 租户 10400 岗位(a8a9df7)
- **import 落地(最终)**:688 家公司 / 1959 站点 / 11492 岗位(0 dropped / 0 issues)
- DB 站点分布:上海 405、北京 341、深圳 262、成都 133、广州 125、杭州 152、武汉 66、南京 51、西安 47
- 坐标覆盖(已 geocode):上海 33、北京 13、深圳 11、杭州 70、成都 4、广州 5、武汉 4、南京 3、西安 3 —— 其余待 geocode(D-1,配额明日重置)

### ② 聚合徽章计数修复
- 根因闭环:fecef85 事故(108 个杭州坐标复制到非杭州站点)→ 前端串味剔除 → 徽章低估 + 假数据
- 事故坐标已清:DB 108 行(E2)+ drops 115 站点(w1)+ 防回归测试 4 例
- **终验(API 全量 89 POI 按城市框统计,与 city-cluster 同款逻辑)**:上海 26、杭州 27、北京 11、深圳 6、广州 5、成都 4、武汉 3、南京 3、西安 3
- **事故残留 = 0**(标签≠坐标站点 0)
- 数字现在诚实:徽章 = 真实 geocode 坐标数;广深蓉徽章从「0 且假」恢复为真实坐标数

### ③ 上海公司扩充
- 上海站点 44 → **405**(飞书 26+ 租户全量 + radar 源);公司 688 家(原 ~500 余)
- 徽章 26 = 有真实坐标的站点数(诚实);其余 379 站点坐标待 geocode 后徽章自然增长
- 来源合规:xiaozhao-radar(GitHub Apache-2.0 快照)+ official-career 飞书公开 JSON + 礼貌 GET

## 门禁与合并流水
- w1(fix/sweep-accident-coords)→ w2(feat/ats-source-extend)→ w3(修复)→ w4(fix/geocode-address-strategy):全部合并,dev 绿
- server npm test 504 pass/2 skip(基线)+ crawler pytest 103 全过(boss 亲自复验)
- push origin/dev 已自动完成

## workstreams
| ws | 主题 | 分支 | status | verdict |
|---|---|---|---|---|
| w1 | drops 事故坐标清理 + 防回归测试 | fix/sweep-accident-coords | MERGED | OK |
| w2 | 合规源扩展(zhiye 适配器 + feishu 租户) | feat/ats-source-extend | MERGED | OK(w3 修复后) |
| w3 | crawler 修复(城市归一/分页/拼音) | fix/ats-source-fixes | MERGED | OK |
| w4 | geocode 地址-城市一致性门控 | fix/geocode-address-strategy | MERGED | OK |

## merge_order
1. w1(数据修复)→ 2. w2(源扩展)→ 3. w3(fix)→ 4. w4(geocode 策略)

## adjudication_log
2026-08-20 | zhiye 采集 | 148 租户全量 0 可采:robots.txt 阻断 / 新版 portal 无 API 路径 | 合规正确工作;增量转飞书源 | deferred-notes D-3
2026-08-20 | geocode 百度兜底 | geocode-sites-apply.mjs L65 未注入 BAIDU_MAP_AK → 兜底永不触发 | 一行修复(0b7c1da)+ 得物诊断验证 | 已 push
2026-08-20 | import:seed:apply no-database | 脚本不自动读 .env.local,需显式注入 DATABASE_URL | set -a; source .env.local 注入后重跑 | wrote: true(688/1959/11492)

## deferred_notes
见 deferred-notes.md:
- D-1 geocode:sites:apply(AMap place-text 10044 + Baidu 302 天配额超限,双配额耗尽)—— 明日配额重置后重跑(w4 地址门控 + fetch 超时已就位;预计徽章随坐标增长)
- D-3 zhiye 北森源 robots 阻断不可用(合规);增量由飞书源承担

## recovery
- last_stage_written: DONE
- resume_history: 无(本批无需恢复)
