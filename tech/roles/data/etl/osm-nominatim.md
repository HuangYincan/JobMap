# OSM Nominatim source review(海外站第四 provider)

> **Status:** ✅ 代码已集成(2026-08-23, `feat/poi-nominatim`, `server/src/lib/site-geocode.ts` + `server/scripts/geocode-sites-apply.mjs`);实际联网执行 Env-only(用户后续跑,见批次 deferred-notes)。
> **Reviewed:** 2026-08-23
> **Owner:** data

## 数据来源

- **OpenStreetMap**(OSM)公共 Nominatim 实例:`https://nominatim.openstreetmap.org/search`(前向检索)与 `/reverse`(反向)。全球地名覆盖 — 海外站(悉尼/新加坡/东京/英文城市等)在 AMap/百度/腾讯 place 检索范围之外,这是唯一能落真实坐标的 provider。
- **坐标系统**:Nominatim 输出 WGS-84(原生);与 `city-centers.ts` `OVERSEAS_CENTERS` 的 WGS-84 约定一致(海外无 GCJ-02 偏移),无需转换。国内站仍走 AMap→百度→腾讯(GCJ-02)链,永不进 Nominatim 路径。
- **数据实测背景**(2026-08-23 摸底):drops 2410 站中海外站 114 站(CJK 海外/港澳台城市名 91 站/65 城 + 纯拉丁城市串 23 站/18 城串),其中 88 站无可用坐标;另有海外站钉中心(地址占位留中心,地址真实自动重跑)。

## 使用政策合规(Nominatim Usage Policy)

来源:[Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)。硬性要求与实现对照:

| 政策要求 | 实现 |
|---|---|
| UA 必须标识应用(缺失/通用 UA 会被封 IP) | 所有请求带 `User-Agent: DomainMap/1.0 (job-map contact)`(`NOMINATIM_USER_AGENT` 常量,测试钉住) |
| 限速 ≥1 req/s | 调用方 `geocode-sites-apply.mjs` 每次 Nominatim 调用后 sleep ≥1000ms(`throttleMs('nominatim')`;`NOMINATIM_MIN_INTERVAL_MS` 常量 + 测试钉住) |
| 不并发轰炸 | apply 脚本主循环严格串行;每站点检索变体 ≤2 次(`nominatimQueryVariants`),无并发启动 |
| 请求量节制 | 只对**三级兜底链全部失败**的海外站尝试(不是全量轮询);命中即停,同站点不重复检索 |
| 错误/超时优雅处理 | 单请求 10s 超时(`AbortSignal.timeout`),http/超时/解析失败一律降级 `{ ok: false }` → 记 unresolved,不重试不崩溃 |

**不绕过登录/验证码/限流**:Nominatim 公共实例无登录/验证码;限流靠调用侧节流(≥1s)遵守,不做任何提速/并发绕过。

## 集成位置与路由

- `server/src/lib/site-geocode.ts`:
  - `nominatimSearchRest(query, target)` / `nominatimReverseRest(lng, lat)` — REST 调用(format=jsonv2, limit=3, addressdetails=1, 可带城市文本约束)。
  - `isOverseasCity(city)` — 海外站判定(独立命名,不污染国内路径):拉丁城市名 / `OVERSEAS_CITY_KEYS` / 实测 CJK 海外名单(`OVERSEAS_CJK_CITIES`) / 「海外」标记。
  - `gradeNominatimHit` / `pickBestNominatimPoi` / `nominatimQueryVariants` — 海外独立评分(公司名强匹配 + 地址 token 重叠 ≥2 双通道,含跨语言归一 Straße↔Street / CJK 滑窗 bigram)与检索变体(每站 ≤2 次)。
- `server/scripts/geocode-sites-apply.mjs`:AMap→百度→腾讯三级兜底失败(no-result / regeo-outside)且 `isOverseasCity` → Nominatim;命中后跳过国内 regeo 闸门(三 provider 对海外无 regeo 覆盖),reverse 结果作证据文本。`--dry-run` 无 key(纯计划模式)不联网。
- 国内路径零改动:不触发 Nominatim 的站点行为与合并前完全一致(既有测试全绿)。

## 校准点(Env-only 实跑后回填)

1. 真实命中率:地址级(high)与城市级(medium,不写回)的实际分布。
2. OSM 实例可用性/限流观察(429/403 时的降级行为,当前为静默 unresolved)。
3. 海外 POI 名与中文公司名的实际匹配情况(公司名通道命中率)。

## 后续

- boss Env 实跑 `npm run geocode:sites:apply` 后按校准点回填本文档。
- `tech/roles/data/data-sources.md` 台账同步(若该台账收录 Nominatim,补一行)。
