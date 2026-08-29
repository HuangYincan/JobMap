# e-search-suggest 汇报(2026-08-25)

## 实际改动
- `server/src/lib/search.ts` → priceDesc 缺失项置末:`priceSortValue` 对无 priceLevel / 招聘 POI 改返回 `null`(原 `Number.MAX_SAFE_INTEGER`);`sortValue` 返回类型 `number | null`;`sortPOIs` 比较器先处理 null 哨兵——某侧为 null 则置后(与 desc 无关),两方向都置末。其余键:distance/deadline(MAX 哨兵,仅升序)、rating/salaryDesc/positionCount(0 哨兵)行为不变。
- `server/src/app/api/suggest/route.ts` → cache key 加 center:`centerKey = center ? \`${center.lng},${center.lat}\` : 'none'`(基于 parseCenter 解析后的有限数,与响应 distance 口径一致),`publicCacheKey(['suggest', mode, q, centerKey])`;TTL / 空结果不缓存 / 响应结构不变。
- `server/tests/search-logic.test.mjs` → 新增 `sortPOIs: priceDesc ranks priced POIs high→low, missing price last`(DOMAIN_SEED 无 priceLevel 的 4 条 domain POI 全排尾、有价按 4→3→2 降序、首条 hz-yinyuequan(4)、并附 priceAsc 缺失仍排末的保持断言)。
- `server/tests/search-integration.test.mjs` → suggest contract 测试补两条断言:centerKey 形态(`const centerKey = center ? ... : 'none'`)与 key 含 center(`publicCacheKey(['suggest', mode, q, centerKey])`)。

## 门禁结果
- npm test: 1610 通过 / 0 失败 / 2 skip(共 1612;全量跑两轮)
- typecheck: 通过(tsc --noEmit 无输出)
- docs-check: 通过(Documentation policy check passed)
- git diff --check: 通过

## 遇到的问题
- 无阻塞。口径说明:priceSortValue 仍只认 priceLevel,无 priceLevel 但有 cost 的 POI 在 priceDesc 下仍按「缺失」置尾——按 prompt 要求保持现状(deferred:matchFilter case 'price' 优先 cost 的口径差异未动)。
- 测试计数与 CLAUDE.md 记录的 1610(1608 pass/2 skip)差 +2,为 dev 基线漂移(本 WS 仅新增 1 个 test),非本批引入的失败。

## 证据
- `sortPOIs: priceDesc ranks priced POIs high→low, missing price last` ✔ (0.078ms)
- `applyFilters: price range maps priceLevel to tier midpoints` ✔(priceAsc 保持)
- `sortPOIs: salaryDesc ranks highest salary first` ✔ / `sortPOIs: distance sorts by distance field` ✔(抽查保持)
- `GET /api/suggest domain: 本地优先 hz_pois…空结果不缓存` ✔(含新增 cache-key 断言)
- 汇总:ℹ tests 1612 / pass 1610 / fail 0 / skipped 2
- 提交:a29c7d3 fix(search)、84cd0c5 fix(suggest);分支 fix/price-suggest-fixes,未 merge 未 push。
- 改动文件:git status 仅 4 个拥有文件(server/src/lib/search.ts、server/src/app/api/suggest/route.ts、tests/search-logic.test.mjs、tests/search-integration.test.mjs),「不碰」清单零改动。

门禁: PASSED
结论: OK
