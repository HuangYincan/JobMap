# Workstream sc-seed-city — INTERNSHIP_SEED 站点补 city 字段(zoom 小时聚合进城市徽章)

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-sc-seed-city`,分支 `fix/seed-site-city`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(boss 已验证根因,用户发现:「zoom 小时部分站不能聚合进城市」)

- 城市聚合(`city-cluster.ts` `clusterCities`)按 `poiCity(poi)` = `sites[0].city` 分组;city 空 → 该 POI 不聚合、保持个体 pin(city-cluster.ts:53-57,:89)。
- `INTERNSHIP_SEED`(src/lib/seed-data.ts,50 家骨架,mode: 'internship')的 sites **全部没有 city 字段**(写法样本 :160:`{ id, name, location, careerUrl, logoUrl }`)。
- 后果:最终离线目录里 11 家公司(alibaba-xixi/netease-hangzhou/bytedance-hangzhou/antgroup-hangzhou/didi-hangzhou/deepseek/hithink-hangzhou/h3c-hangzhou/betta-hangzhou/xiaomi-hangzhou/zhejiang-lab —— merge 后 positions>0 且未被 radar 行覆盖 city 的)在 zoom ≤ 8 不进「杭州」徽章,散落个体 pin;其余 39 个被 radar/official 数据 merge 时补上 sites 或被替换。
- boss 已核验:**50 个 seed site 的坐标 100% 在杭州参考框内**(spatial-query.ts CITY_REFERENCE_BOXES 杭州 west 118.3 / south 29.05 / east 120.8 / north 30.75)——统一补 `city: '杭州市'` 无误伤;坐标↔标签防御(cityLabelMatchesCoordinates)会全部放行。

注意:seed 里还有 DOMAIN_SEED(domain 模式),本批**不动**(domain POI 本就不参与 work 聚合,poiCity 对非 recruitment 返回 undefined 是设计)。

## 任务

### 1. 数据修复 — `server/src/lib/seed-data.ts`

- 给 `INTERNSHIP_SEED` 全部 50 个 POI 的 `sites[0]` 补 `"city": "杭州市"`(含 province 可选:若站点对象有 province 惯例则一并 `"province": "浙江省"`,先看现有 radar/official 数据写法保持一致;若无惯例只补 city 即可)。
- 用脚本化方式改(如 node/python 正则或逐个 Edit),确保 JSON 结构合法、TS 编译过;不要动 location/careerUrl/logoUrl 等其它字段。
- 改完自查:`INTERNSHIP_SEED.filter(p => !p.sites?.[0]?.city?.trim()).length === 0`。

### 2. 测试

- `server/tests/city-cluster.test.mjs`:新增用例 —— INTERNSHIP_SEED(或构造的同构数据)全部 POI 有 city → clusterCities(pois, 6) 中「杭州」组 count 含 seed 公司;以及 poiCity 对带 city seed 返回『杭州市』。
- 若 `server/tests/server-catalog.test.mjs` 有对 seed 目录结构的断言(字段白名单等),同步检查是否需要更新(先跑测试看有没有红)。
- 端到端锚点:`loadOfflineWorkCatalog()` 后无 city 的 POI 数 = 0(或按实际 merge 结果断言 ≤ 当前基线,写明数字)。

### 3. 文档

- 若 tech/21(city clustering)或 tech/18 描述「无 city 不聚合」处需补充「seed 站点已带 city(2026-08-26 修复)」,最小同步;无则不动。

### 4. 门禁(必须真跑)

```bash
cd /Users/acccan/dm-wt-sc-seed-city/server && npm test
cd /Users/acccan/dm-wt-sc-seed-city/server && npm run typecheck
cd /Users/acccan/dm-wt-sc-seed-city && make docs-check && git diff --check
```

> 附带验收(worktree 内,汇报给数字):clusterCities(loadOfflineWorkCatalog(), 6) 的「杭州」组 count 变化(修复前该组不含这 11 家;修复后应 +11 左右,以实测为准);无 city POI 数 11 → 0。

## 文件边界

**拥有**:`server/src/lib/seed-data.ts`、`server/tests/{city-cluster,server-catalog}.test.mjs`(按需)、tech 文档(最小)。

**不碰**:DOMAIN_SEED、`server/src/lib/{city-cluster,spatial-query,server-catalog}.ts` 逻辑、crawler/**、server/data/**、components/hooks、`.env*`、主树。

## 提交

Conventional Commits(`fix(seed): INTERNSHIP_SEED 站点补 city=杭州市 — zoom 小时聚合进城市徽章`、`test(cluster): seed 站聚合锚点用例`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260826-boss-seed-city/reports/sc-seed-city.md`,含改动摘要、验收数字、门禁结果、结论。末两行:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
