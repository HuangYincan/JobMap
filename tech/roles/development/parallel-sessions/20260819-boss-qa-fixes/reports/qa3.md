# ws-qa3 汇报(2026-08-19)

任务:#7 搜索缓存/无 bounds 上限 + #10 输入长度 + #11 通知冷却 + #12 saved 校验。
worktree:`/Users/acccan/dm-wt-qa3`(分支 `fix/qa-api-hardening`),4 个小步 commit,未 merge/未 push。

## 实际改动

### `server/src/app/api/search/route.ts`(#7 + #10)
- 新增输入上限常量:`MAX_Q_LENGTH = 100`、`MAX_BODY_CHARS = 64 * 1024`、`MAX_FILTERS_JSON_LENGTH = 4000`、`MAX_PAGE_SIZE = 100`。
- **body 大小上限**:先 `request.text()` 读原文,`> 64KB` → 400 `BODY_TOO_LARGE`;再 `JSON.parse`(失败仍 400 `BAD_REQUEST`,原契约不变)。
- **q 上限**:非 string 或 `> 100` 字符 → 400 `Q_TOO_LONG`(选 400 不截断:截断会静默改匹配语义)。
- **filters 卫生**:非普通对象(数组/标量)→ 400;`JSON.stringify(body.filters ?? {})` 只序列化一次,`> 4000` 字符 → 400 `FILTERS_TOO_LARGE`,序列化结果直接复用为缓存 key 组件(不再二次序列化,key 有界)。
- **pageSize 上限**:`1..100`,超限/非有限数 → 400 `INVALID_PAGE_SIZE`(管线本身 clamp ≤50,此为显式 API 防线,客户端语义不变)。
- 所有校验都在缓存 key 构造**之前**,超限输入永不进缓存。

### `server/src/app/api/suggest/route.ts`(#10)
- `MAX_Q_LENGTH = 100`:trim+lowercase 后 `> 100` → 400 `Q_TOO_LONG`,在缓存 key 构造之前拦截(超长 q 不再进全 catalog matchKeyword 循环)。
- 其余逻辑(热门搜索/domain 本地优先/空结果不缓存)原样保留。

### `server/src/app/api/me/notifications/route.ts`(#11)
- 进程内 `notifyCooldown = new Map<userId, lastScanAt>`,`NOTIFY_COOLDOWN_MS = 60_000`。
- 60s 内重复 POST → **429 `RATE_LIMITED` + `Retry-After` 头**(选 429 而非幂等回放:enqueue 在 DB 层 ON CONFLICT 已幂等,回放旧 payload 反而给过期数据;429 信号更明确)。
- **取舍说明**:内存 Map 仅单实例部署有效、重启清零。不落 DB——account-store.ts 是本批 ws-qa2 的边界文件,且每次 POST 多一次写库会把「扫描+入队」变成「扫描+写库+入队」;对「防反复触发全量扫描」的威胁模型,进程内冷却已足够。
- 附带惰性清理:map ≥1000 条时顺手删过期条目(纯防御)。
- 冷却通过后才 `loadServerCatalog("work")` + `matchJobAlerts` + enqueue(原流程不变)。

### `server/src/app/api/me/saved/route.ts`(#12)
- `MAX_NAME_LENGTH = 100`、`MAX_POI_ID_LENGTH = 200`:超限 → 400 `NAME_TOO_LONG` / `POI_ID_TOO_LONG`。
- 坐标范围:`lng ∈ [-180,180]`、`lat ∈ [-90,90]`,且 `Number.isFinite` 防御(JSON `1e999` → Infinity 可绕过范围比较);越界 → 400 `INVALID_LNG` / `INVALID_LAT`。lng/lat 缺省时不校验(保持原可选语义)。
- 校验在 `savePlace` 落库之前;其余流程(非空校验/persistable/mode 归一)原样保留。

### `server/tests/api-hardening.test.mjs`(新增,7 个契约测试)
- route.ts 含 `@/` 别名 + `next/server`,node:test 无法直接 import(tsconfig paths 仅 bundler 解析)——沿用仓库既有契约测试模式(readFileSync + 正则,同 search-integration.test.mjs)。守卫常量/状态码/顺序关系逐一断言:
  - search q 超长 → 400 且在缓存 key 之前;body 64KB → 400;filters 超限 → 400 + key 复用 filtersJson(无二次序列化);pageSize 越界 → 400。
  - suggest q 超长 → 400 且在缓存 key 之前;原契约(trending/domain 优先/空结果不缓存)保持。
  - notifications 60s 冷却 → 429 + Retry-After,冷却记录先于全量扫描;原行为(matchJobAlerts/enqueue/queued)保持。
  - saved name/poiId 长度 + lng/lat 范围 + isFinite 防御 → 400,校验先于落库;原行为保持。

## 门禁结果
- npm test:430 总数 / 428 通过 / 0 失败 / 2 skipped(基线既有 skip;含新增 7 条全绿)
- typecheck:通过
- docs-check:通过(Documentation policy check passed)
- git diff --check:通过

## 遇到的问题
- **route 层行为无法被 node:test 直接调用**(`@/` 别名仅 bundler 解析) → 按仓库既有约定用 readFileSync 契约测试(7 条),并保持守卫实现为直白常量+顺序,正则断言可精确到「校验先于缓存 key / 落库 / 扫描」;行为级幂等(enqueue ON CONFLICT)已有 account.test.mjs 覆盖。
- **#11 冷却选 429 而非幂等回放**:回放旧 payload 会给过期数据,429+Retry-After 信号明确;内存 Map 的「重启清零/单实例」取舍已注释在代码中。若 boss 希望跨重启冷却,可后续改为 DB 时间戳(需动 account-store,超出本 WS 边界)。

## 证据
- 提交:`c3465ad`(search/suggest)、`58ac466`(notifications)、`4a3cf24`(saved)、`6d0997b`(tests),基座 `7e03adf`。
- npm test 摘要:`tests 430 / pass 428 / fail 0 / skipped 2 / duration 1819ms`;新增 7 条 `✔ #7/#10/#11/#12 ...` 全部通过(见工具输出 bfqlglcar.txt)。

门禁: PASSED
结论: OK
