# ws-a — 「/」多城市列表串 → 强制公司名检索分支

## 背景(2026-08-23 boss 实测)
r5 geocode(公司名 place 检索)是让城市中心假坐标站落真实办公坐标的关键。但 `siteHasStreetAddress` 的 STREET_RE 把「门」当街道特征,导致 6 站(radar: metapp×2 / 万物云×3 / 中电福富×1)的多城市占位串(如「北京/上海/厦门/深圳」)误判为「有街道地址」→ 走地址检索分支而非公司名检索分支。地址检索对城市列表串 no-result → 留中心(无害但白跑);或命中目标城内任意点 → 可能写非真实办公坐标(有界:6 站)。见 tech/29 §3.1。

## 任务(worktree:/Users/acccan/dm-wt-pds-a,分支 fix/poi-citylist-branch)
在 `server/src/lib/site-geocode.ts` 的 `siteHasStreetAddress`(:490-492,内部用 STREET_RE.test)引入**多城市列表串判定**:地址以「/」分隔且含 ≥2 个城市 bare 名 token(复用 `bareCityName` / `CITY_CENTERS` 判断,注意「厦门」本身是城市名)→ 视为**非街道地址**,返回 false(让调用方走公司名检索分支)。实现要点:
- 判定放在 STREET_RE 测试之前(城市列表串优先)。
- 边界:真实地址也可能含「/」(如「xx路/y路」交叉口)?检查 STREET_RE 与现有判定,确保只有「/」分隔且各段都是城市名(或城市名+「市」)的串才判非街道;含路/街/号 等街道特征段的不误杀。worker 自行通读 `geocode-sites-apply.mjs` 中 siteHasStreetAddress 的调用方(:~330-390 地址检索 vs 公司名检索分支),确认改动后 6 站确实走公司名分支。
- 更新 `server/tests/` 中相关测试(site-geocode 或 geocode 相关测试文件;先搜现有测试如何覆盖 siteHasStreetAddress / cityList),新增 6 站案例(metapp/万物云/中电福富占位串)。
- 用 `node scripts/audit-city-center-pins.mjs` 与 plan dry-run 验证:改动不改变基线数字(1330 中心钉点 / needsRerun 1076);仅改变 6 站的检索路径选择。在汇报中给出 dry-run 前后对比。

## 文件边界
- 改:`server/src/lib/site-geocode.ts`、`server/tests/`(相关测试文件)、`server/scripts/geocode-sites-apply.mjs`(仅当调用方需要适配判定返回值时)。
- 不碰:其他源文件、UI、docs(除必要的注释)。
- 不 merge / 不 push。worktree 已预建,boss 统一合并。

## 门禁(全部通过才算 PASSED)
```bash
cd /Users/acccan/dm-wt-pds-a/server && npm run typecheck
cd /Users/acccan/dm-wt-pds-a/server && npm test          # 全量(1487);先跑相关子集再全量
cd /Users/acccan/dm-wt-pds-a && make docs-check && git diff --check
node scripts/audit-city-center-pins.mjs                 # 基线数字不变(允许 needsRerun 中 6 站路径变化导致个别 reclassify,若变化需在汇报说明)
```
每次小步 Conventional Commits(`fix(geocode): ...`),便于回退。

## 回报
写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-poi-datasource/reports/ws-a.md`:
1. 改动摘要(函数/行号/调用方适配)
2. 「遇到的问题」段(如有)
3. 6 站路径验证结果 + audit 基线对比
4. 门禁逐项结果
末两行必须精确:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
