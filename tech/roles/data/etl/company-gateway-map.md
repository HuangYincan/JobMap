# 公司内部地图网关 (map.jiaoyuntong.net) — 来源审查

**接入日期:** 2026-08-25
**代码:** `server/src/lib/site-geocode.ts`(`jiaoyuntongPlaceSearchRest` / `companyPlaceSearchRest`)
**状态:** geocode place 检索链第三级后接 provider(公司网关), 官方 provider 仍保留
**相关文档:** [`tech/29-geocode-r5-status.md`](../../29-geocode-r5-status.md)

## 1. 来源与授权

- `http://map.jiaoyuntong.net` 为**公司内部部署的 ASP.NET 地图服务网关**(IIS/ASP.NET MVC 5.3, 2026-08-25 实测),
  向公司内部提供百度 `place/v2/search` 请求格式的地点检索 — 响应结构与错误码透传百度
  (实测 `{"status":101,"message":"AK参数不存在"}` = 百度风格错误码)。
- 访问 token(`JIAOYUNTONG_MAP_KEY`, 存 `server/.env.local`, 绝不打印/提交)由公司内部签发,
  网关侧统一持有地图服务配额, 供内部业务使用 — 用户声明「公司内部站点+安全合规」,
  本库为公司内部项目, 使用范围与授权一致。
- 网关为 **http 明文**传输: token 仅存本机 `server/.env.local`(已 gitignore),
  不在日志/报告/审计输出中出现; 调用失败时仅记录 reason 不记录请求串。

## 2. 接口行为(2026-08-25 实测)

| 项 | 结果 |
|---|---|
| 端点 | `GET /place/v2/search`(百度请求格式: query / region / output=json / ret_coordtype=gcj02ll / page_size / scope / ak) |
| 返回 | 百度 place/v2/search 同构 JSON(`status=0` + `results[]`, 字段 name/location/lat/lng/address/province/city/district/uid) |
| 坐标 | `ret_coordtype=gcj02ll` 请求下返回 GCJ-02(实测英伟达上海浦东坐标与官方百度一致) |
| region | 真实公司名检索时 region=目标城市生效(实测「英伟达」+region=上海 → 全部上海浦东浦西结果); 无匹配时行为同官方百度 |
| 错误码 | 百度语义(`status:101` AK 参数不存在等)→ 复用 `isTransientBaiduStatus` 单次重试 |
| 限速 | 网关透明度未知, 按百度档 600ms/请求节流(`throttleMs('jiaoyuntong')`), 保守不激进 |

## 3. 在链中的位置与失败语义

- place 检索链: **AMap(官方)→ 公司网关 → 官方百度 → 腾讯**; 网关配置 token 时才进入链,
  未配置时行为与接入前完全一致(现有调用方与测试不受影响)。
- geocode(地址→坐标)与 regeo(逆地理)链**不**接网关 — 那两接口官方日配额 5000,
  不占 place 检索 100 次/日的瓶颈。
- 网关失败(`ok=false`, 网络/网关错误/百度状态码)→ 自动落官方百度, 再落腾讯 — 不影响数据落地。
- 网关结果与官方百度同样过既有**城市-地址一致性闸门**(`addressConflictsWithCity` /
  `addressConflictsWithRegeoDistrict`)+ regeo 城市校验, 错配坐标不会写入 drops。

## 4. 配额与节流纪律

- 网关为内部服务, 无个人开发者 100 次/日限制 — 这是接入目的(2026-08-23 r5 实测
  AMap place-text 单日限额导致 backlog 1076 站需 ~4 天)。
- 仍保持礼仪限速 600ms/请求(同官方百度档), 不并发轰炸; 每站 ≤2 次检索 +
  place-search memo(同公司同城共享)逻辑沿用, 缓存行为不变。

## 5. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-25 | 接入网关 provider(分支 `feature/company-jyt-provider`); 单元测试 4 例新增; 真实网络冒烟通过(英伟达/上海) |
