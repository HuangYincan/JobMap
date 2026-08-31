# ws-5 汇报(2026-08-22)

## 实际改动

- `server/src/lib/poi-service.ts` → domain 关键词回退搜索引擎化:原硬绑 `amap-api.searchPOI`(L154),现改走活跃引擎 `activeSearchProvider.searchPOI`(与视口兜底 `viewportFallbackSearch` 同口径:`limit/page/city`,page 为契约 duck-type 扩展);未注入(SSR/测试/零配置)回落 amap-api 直连(行为与迁移前一致);provider 抛错仍为错误信号(可重试),不静默 return existing。注入机制(L42-46)核实未动:use-map-engine 挂载/卸载时 `setActiveSearchProvider`(hook L216/257/276/291)。
- `server/src/components/map-shell.tsx`(仅聚合徽章清理行段 L1343-1352)→ 徽章摘除按能力分派:核实 `createCityClusterMarker` 返回**厂商裸实例**(`wrapper.raw`,map-markers L391)→ 旧清理只调 `marker.setMap(null)` 在 BMapGL 上静默 no-op → 跨 zoom 分桶旧徽章泄漏叠图。修复:`typeof marker.setMap === "function" → setMap(null)`,否则 `remove()`,与契约 `MapMarker.remove` 引擎语义一致(AMap/TMap glMarker = setMap(null);BMapGL = remove())。
- `server/tests/map-engine-lifecycle.test.mjs`(新增)→ 三引擎 marker 生命周期贯通测试 6 项:同一套断言驱动 amap/tencent/baidu 适配器走 创建 → setZIndex → setVisible → on/off → remove,并断言 raw 摘除能力分派(baidu raw 无 setMap 坐实旧 bug 根因;分派后 overlay 注册表同步清空);徽章形态回归(offset/zIndex/bubble 透传 + 分派摘除)。
- `server/tests/poi-service.test.mjs`(追加 4 项)→ 关键词 provider 路由:杭州外走 provider / zoom≤8 全国 + pageOffset 翻页 / 杭州内本地库失败回退 provider / provider 抛错 → 错误信号。
- `tech/23-map-engines.md`(仅追加)→ 「ws-5 收尾与验证回填」节:搜索引擎化/徽章清理/验证结果表/遗留项。

## 门禁结果

- npm test: 1096 通过 / 0 失败 / 2 skip(全量,含轮 1-4 合并基线 + 本 WS 新增 10 项;切换回滚 L347/重入取代 L486/层级隔离 CSS 断言 L1073 均在基线测试内通过)
- typecheck: 通过
- docs-check: **基线红(非本批)**:仅 `parallel-sessions/20260821-boss-agent-thinkfix/merge-report.md:20` 与 `.../boss-tencent-geocode/merge-report.md:17` 复述 grep 正则自匹配(合并前已存在,与本批零关系);本 WS 新增 tech/23 追加段零违例
- git diff --check: 通过

## 遇到的问题

- **真实验证不可行(如实报告)**:本会话为 headless worker,无浏览器工具;worktree 无 `server/.env.local`(真实 key 在主树,不读取不打印);:3000 的 dev server 是主树进程,非本 worktree 代码。切三家/POI 交互/徽章聚合在腾讯(MultiMarker 降级)与百度(HTML 徽章)的呈现均无法执行 → **记 deferred #1 依赖 key + 浏览器回填**(tech/23 已记)。
- **契约 grep 边界内净,边界外有遗留(需 boss 裁决)**:徽章清理段已无裸实例 `setMap(null)` 直调。但 map-shell **distance overlay(距离圈/手柄,L1097/1101/1120/1138 等)仍持 `.raw` 直调 AMap 专属 API**(setMap(null)/setCenter/setRadius/getMap/getRadius),且不受引擎门控——腾讯/百度引擎下与徽章同款风险(无 setMap 的 raw 上直调会 TypeError/no-op)。该段在「仅聚合徽章清理行段」边界之外,本 WS 未动,已记 tech/23 遗留 + 建议后续 fix WS 契约化(distance 筛选当前 UI 无入口,风险面小)。
- docs-check 基线红 → 如实 FAILED 上报(boss 已知,非本批引入)。

## 证据

- 全量 `npm test`:`tests 1098 / pass 1096 / fail 0 / skipped 2`(基线 568 → 本批次轮 1-5 累计 1096)
- 新增测试逐项通过:
  - `map-engine-lifecycle.test.mjs`:marker 生命周期贯通(amap/tencent/baidu)3/3 + 徽章形态摘除(amap/tencent/baidu)3/3
  - `poi-service.test.mjs`:ws-5 关键词 provider 路由 4/4
- `npm run typecheck` / `git diff --check`:通过
- docs-check 输出(基线红仅两处旧 merge-report 自匹配,见上)

门禁: FAILED
结论: OK
