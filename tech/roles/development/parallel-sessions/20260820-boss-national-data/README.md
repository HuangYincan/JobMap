# Batch Manifest — 20260820-boss-national-data

## 目标(用户三诉求,2026-08-20)

1. **拓展真实岗位数据**到北京、成都、深圳、广州、南京、武汉、西安(南京/西安当前 0 家)
2. **修复聚合卡片计数**:徽章数被事故坐标 + 串味防御扭曲(上海 26 vs DB 44、北京 3 vs 28、广深蓉 0 vs 8)
3. **扩充上海公司**(用户:上海才二十几家,多爬一点)

## 根因(全链路已确认)

- **fecef85 事故(2026-08-19)**:refresh-radar 再生(fbc4448)丢了 8/17 geocode 坐标,fecef85 把 7d19271 的杭州 office 坐标**复制给所有城市 site** → 108 个非杭州站点坐标错误落在杭州框(118.3-120.8/29.05-30.75):上海 30/北京 25/深圳 22/成都 18/广州 9/武汉 4。
- **前端串味防御(city-cluster.ts:86 `cityLabelMatchesCoordinates`)**:「标签=上海但坐标在杭州」→ 剔除 → 徽章:上海 26(44-18)、北京 3(28-25)、广深蓉 0(8-8)。防御逻辑正确,数据脏。
- **南京/西安**:爬虫 CITY_TARGETS 已含 10 城,但 8/11 快照 remap 用 7 城默认 → 0 站点。
- **上海源数据**:xiaozhao-radar 397 家上海公司文本;DB 在招 44 家(26 真坐标 + 18 事故坐标)。
- **正确坐标唯一来源 = 重新 geocode**(git 历史无正确坐标)。

## Workstream 表

| ws | 分支 | worktree | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|---|
| w1 | fix/sweep-accident-coords | /Users/acccan/dm-wt-w1 | drops 事故坐标清理(非杭州城市 site 的杭州框坐标 → 无坐标)+ 清理脚本 + 防回归测试 | `server/data/recruitment/**`(drops 数据)、新增 `server/scripts/fix-sweep-accident-coords.mjs`、`server/tests/`(新增坐标一致性测试) | `map-shell.tsx`、`city-cluster.ts`、`spatial-query.ts`、`crawler/`(除数据文件外)、`db/migrations/` |
| w2 | feat/ats-source-extend | /Users/acccan/dm-wt-w2 | 合规源扩展代码:ats_zhiye.py 实现 + FEISHU_TENANTS 扩充 + 来源审查文档更新 | `crawler/app/domain_map_importer/ats_zhiye.py`(新)、`ats_feishu.py`(租户清单)、`cli.py`(接线)、`crawler/tests/`、`tech/roles/data/etl/zhiye-ats.md`/`feishu-ats.md` | 不实际采集(网络采集由 boss Env 阶段执行)、`server/`、`db/` |

## Env 步骤(boss 执行或 deferred,见 boss-state)

- E1: 下载最新 xiaozhao-radar jobs.json 快照(GitHub 公开,Apache-2.0,已审查)→ radar remap(10 城含南京/西安)→ 生成 drops
- E2: DB 事故坐标清理(psql UPDATE,与 w1 drops 清理配合)
- E3: 采集执行(zhiye 适配器 + 飞书租户,合规源)
- E4: geocode:sites:apply(AMap 配额,当前探测中;阻塞则 deferred)
- E5: import:seed:apply + audit:pins

## 合并顺序

1. w1(数据修复)→ 2. w2(源扩展,独立)

## 门禁

- `cd server && npm test`(基线 500 pass/2 skip)+ typecheck + docs-check + diff --check
- w2 另加:crawler pytest 由 boss 复验(worker 无 python 权限)
