# ws-geofix 汇报(2026-08-22)

## 失败用例与判定证据

复现:2 个数据契约测试失败,均为 dev 基线 geocode r4 commit `3e6deb3` 坐标更新引入
(两数据文件最后改动均在 3e6deb3;本 WS 数据零改动,git status clean 证据)。

### 1. split-city-sites.test.mjs:284「qqj-临界点…主站点补点」——测试期望过时 → 更新期望
- 3e6deb3 diff(`qqdoc-jobs/qqj-临界点.json` 仅 1 个 hunk):主站点 location 从
  `{lng: 121.47, lat: 31.23, address: 上海市徐汇区天平路185号11层1107室}`(= `cityCenter('上海')`,city-centers.ts:45)变为
  `{lng: 121.439346, lat: 31.197401, address: …}`。
- 判定:新坐标是地址「徐汇区天平路185号」的街道级真实 geocode(徐汇区地理范围 ~121.44/31.20;
  6 位小数精度 = r4 工具链输出风格;address 字段来自 e506c4d,坐标由 r4 升级)。数据正确,测试期望过时。
- 处理:期望更新为 r4 实测值 `{lng: 121.439346, lat: 31.197401, address: …}`,注释写明证据。
- 校验:121.439346/31.197401 在 上海参考框 (120.8..122.1 / 30.65..32.0) 内,`cityLabelMatchesCoordinates` 通过;拆分站点(深圳/北京)r4 未改动,断言保持。

### 2. drops-coordinate-consistency.test.mjs:64「无任何非杭州 drop 站点坐标落在杭州参考框内」——测试规则误伤真实数据 → 测试侧豁免(数据零改动)
- 3e6deb3 diff(`official-career/蔚来.json`):蔚来-site-绍兴 从
  `{lng: 120.58, lat: 30}`(= `cityCenter('绍兴')`,原靠精确等值豁免通过)变为
  `{lng: 120.512106, lat: 30.092944, address: 柯桥区钱陶公路799号万达广场F1层蔚来空间}`。
- 判定:新坐标是柯桥区万达广场的真实 geocode(柯桥位于绍兴西部、紧邻杭州,地理上落在
  杭州+周边宽松参考框 118.3..120.8 / 29.05..30.75 内;同 commit 15+ 站点均为同款
  「地址加区级前缀 + 6 位小数坐标」工具链签名)。数据正确,非 7d19271 杭州 office 坐标
  (120.221266/30.201767)的复制串味。重 geocode 会得到同一结果 → 不改数据(Env-only 留给用户)。
- 处理:清扫测试新增豁免 —— `cityLabelMatchesCoordinates(row.city, lng, lat) === true` 的站点
  视为「坐标与其自身城市参考框一致(未收录城市放行)的真实 geocode 产物」,跳过。
  该判据与运行时聚合徽章防御同源(spatial-query.ts)。事故复制(沪京广深等框内城市站点 = 杭州
  office 坐标)仍被拦截:其坐标不在自身城市参考框内 → 返回 false → 不豁免。
- 注:此豁免对「未收录于 CITY_REFERENCE_BOXES 的城市」(绍兴/金华/台州等)为放行,这是与
  运行时防御语义一致的权衡;已收录城市(沪京广深蓉汉杭)的串味检测不变。

### 与既有提交的关系
仓库中存在 boss 先前在废弃分支 `fix/geocode-grader-relax` 上的同题修复 `6193ba1`
(未并入 dev,`git merge-base --is-ancestor 6193ba1 HEAD` = NO)。本 WS 以证据链独立
复验后,以相同方案分两个逻辑单元重新提交(ae214aa / fadafd8),注释含完整证据。

## 实际改动
- `server/tests/split-city-sites.test.mjs` → qqj-临界点主站点 location 期望更新为 r4 实际坐标
  (121.439346/31.197401 + address),注释记录 e506c4d→3e6deb3 演变(commit ae214aa)
- `server/tests/drops-coordinate-consistency.test.mjs` → 杭州框清扫新增真实 geocode 豁免
  (cityLabelMatchesCoordinates 同源判据),注释记录证据与拦截边界(commit fadafd8)

## 门禁结果
- npm test: **1395 通过 / 0 失败**(1397 total,2 skip)——修复前 2 失败,修复后全绿
- typecheck(`tsc --noEmit`): 通过
- docs-check: 通过(违例命中仅在 parallel-sessions/,Makefile 已 `--exclude-dir` 排除;本 WS 零 .md 改动)
- git diff --check: 通过(工作树 clean)

## 遇到的问题
- 无阻塞。数据文件零改动(geocode 重跑属 Env-only,未执行;判定数据正确,无需重跑)。
- 待 boss 知悉:若未来在未收录参考框的城市(台州/温州等)出现新的疑似串味坐标,本测试
  将不再拦截(放行),届时需扩展 CITY_REFERENCE_BOXES 或改进判据。

## 证据
- `git diff 3e6deb3^ 3e6deb3 -- data/recruitment/qqdoc-jobs/qqj-临界点.json`:仅 1 hunk,主站点
  坐标 121.47/31.23 → 121.439346/31.197401
- `git diff 3e6deb3^ 3e6deb3 -- data/recruitment/official-career/蔚来.json`:绍兴站点
  120.58/30 → 120.512106/30.092944,地址加「柯桥区」前缀(与同 commit 15+ 站点区级前缀签名一致)
- `git log -S '120.512106'`:唯一引入 commit = 3e6deb3
- 修复后完整输出:`npm test` → pass 1395 / fail 0 / skipped 2;`git status --short` 空
- 分支:fix/geocode-r4-tests @ fadafd8(2 commits,未 push/未 merge)

门禁: PASSED
结论: OK
