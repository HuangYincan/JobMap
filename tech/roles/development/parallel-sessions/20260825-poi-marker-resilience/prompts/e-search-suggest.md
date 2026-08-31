# Workstream e-search-suggest — priceDesc 缺失置末 + suggest cache key 加 center

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-e-search-suggest`,分支 `fix/price-suggest-fixes`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(根因已由 Explore 确认)

1. **priceDesc 把无价格 POI 排最前**:search.ts:668-671 `priceSortValue(poi)` 对缺失 `priceLevel` 及 recruitment POI 返回 `Number.MAX_SAFE_INTEGER`;:733-752 `SORT_DESCENDING = { priceDesc: true }`,`sortPOIs` 用 `desc ? -diff : diff` 反置 → 缺失项降序时排最前(被当成最贵)。参照系:rating/salaryDesc/positionCount 等 desc 字段用「缺失 → 0」置末(:706-713),distance/deadline 仅升序用「缺失 → MAX」置末。
2. **/api/suggest 缓存 key 漏 center**:suggest/route.ts:54 `publicCacheKey(['suggest', mode, q])`;但响应 distance 按 center 计算(:75/:90/:119 haversineDistance(location, center)),`Cache-Control: public` + in-memory TTL 30s(public-cache.ts:80-81)。同 mode+q 不同 center 会命中同一缓存,复用他人 center 的 distance。center 解析在 :41-49(`parseCenter`,非法返回 null,`MAX_CENTER_LENGTH=128` :25)。

## 任务(仅本 WS 范围)

### 1. `server/src/lib/search.ts` — priceDesc 缺失项置末

- 行为要求:① priceAsc 现状保持(缺失排末,`priceSortValue` 逻辑可保留);② **priceDesc 缺失项置末**(修正反置 bug);③ distance/deadline/rating/salaryDesc 等其他 key 行为一律不变。
- 实现自裁(建议方向,不为唯一):
  - 方案 A:`sortPOIs` 比较器对「缺失哨兵」(如 `Number.MAX_SAFE_INTEGER`)的值在**两个方向都置末**(比较前把缺失哨兵映射为「向后」:某侧为哨兵则其在另一侧之后,与 desc 无关)——只对 price 键生效,注意 distance/deadline 也用 MAX 哨兵且仅升序,方案要保证它们行为不变;
  - 方案 B:引入价格专用「缺失」标记(如 `null`/哨兵符号),`sortPOIs` 对缺失侧排序在末位(两方向),`sortValue` 相应调整。
- **不做**(口径问题,已记 deferred):priceSortValue 只认 priceLevel 而筛选 `matchFilter case 'price'`(search.ts:523-531)优先 `cost` 的口径不一致——**不要**顺手改排序对 cost 的语义。若你的实现让无 priceLevel 但有 cost 的 POI 被排序「误判缺失」,保持现状即可。

### 2. `server/src/app/api/suggest/route.ts` — cache key 加 center

- `cacheKey`(:54)改为 `publicCacheKey(['suggest', mode, q, centerKey])`,其中 `centerKey = center ? \`${center.lng},${center.lat}\` : 'none'`(用解析后的有限数 center,与响应 distance 口径一致;不要用未校验的原始字符串)。
- 其余不变:空结果不写缓存(:133-135)、TTL、响应结构。

### 3. 测试

- `server/tests/search-logic.test.mjs`:新增 priceDesc 用例——seed 中无 priceLevel 的 domain POI(DOMAIN_SEED 多个条目)在 priceDesc 下**排最后**,有 priceLevel 的按级别从高到低;现有 priceAsc 用例(:487-500,过滤掉缺失者)保持绿;再抽查 rating/salaryDesc/distance 用例全部保持。
- suggest 契约:search-integration.test.mjs :96-123 或 api-hardening.test.mjs :66-83(遵循现有源码契约风格)——补断言 route 的 cache key 含 center 形态(`center` 出现在 `publicCacheKey([...])` 参数中)。客户端 suggestStore(public-cache.ts:135-149)不动。

## 文件边界

**拥有**:server/src/lib/search.ts、server/src/app/api/suggest/route.ts、tests/{search-logic,search-integration,api-hardening}.test.mjs。

**不碰**:server/src/lib/public-cache.ts(客户端 LRU)、server/src/lib/poi-service.ts、server/src/components/**、server/src/hooks/**、server/src/lib/{map-markers,viewport-search}.ts、map-engine/**、hz-poi-store.ts。

## 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-e-search-suggest/server && npm test
cd /Users/acccan/dm-wt-e-search-suggest/server && npm run typecheck
cd /Users/acccan/dm-wt-e-search-suggest && make docs-check && git diff --check
```

## 提交

小步高频,Conventional Commits(`fix(search): priceDesc missing-price last`、`fix(suggest): include center in cache key`、`test(search): priceDesc cases`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-poi-marker-resilience/reports/e-search-suggest.md`,含改动摘要、门禁结果、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
