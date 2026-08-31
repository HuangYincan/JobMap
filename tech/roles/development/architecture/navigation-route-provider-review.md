# 导航路线 Provider 审查

> 状态：provider-neutral 审查记录；不选择、注册或调用 live provider。
> 当前日期：2026-08-28
> 访问日期：2026-08-28

## 1. 审查边界

本记录只冻结高德、腾讯位置服务和百度地图开放平台路线产品的接口事实，供服务端
`RouteProvider` 契约后续使用。矩阵中的“未核实”表示本记录没有形成结论，不表示对应能力
不存在。

静态配额、缓存、展示和商业许可不作推测，统一保留为人工确认项。本阶段不确定主供应商、
注册顺序或降级链，不注册账号能力，不读取或输出任何 key，也不调用真实路线 API。

## 2. Provider / 产品接口矩阵

下表按已给出的官方产品资料回填，未核实项不补猜。

| Provider/产品接口 | walk | bike | transit | drive | 时间参数 | 路况证据 | 输入输出坐标 | 鉴权 | 公开配额与限制 | 人工确认 |
|---|---|---|---|---|---|---|---|---|---|---|
| 高德 / 路线规划 2.0 | 支持；`/v5/direction/walking` | 支持；`/v5/direction/bicycling` | 支持；`/v5/direction/transit/integrated` | 支持；`/v5/direction/driving`；另有电动车 `/v5/direction/electrobike` | `arrival-by` 未核实；其余时间参数不在本次冻结 | 驾车有交通态势字段/策略；更新频率、SLA 未核实 | 请求坐标顺序为 `lng,lat`；官方 FAQ 可确认 `GCJ-02`；其余输入/输出细节需复核 | `key` | 静态配额、缓存、展示、商业许可均未核实 | 权限、静态配额、缓存、展示、商业许可、`arrival-by`、更新频率、SLA |
| 腾讯位置服务 / Direction API | 支持 | 支持 | 支持 | 支持 | `departure-time`、`arrival-by` 未核实 | 距离、时长、策略可核实；实时性未核实 | `from/to` 为 `lat,lng`；该路线正文未明确输入/输出坐标系 | `key` | 静态配额、缓存、展示、商业许可均未核实 | 输入/输出坐标系、`departure-time`、`arrival-by`、实时性、静态配额、缓存、展示、商业许可 |
| 百度地图 / 普通 Direction API v2 | 支持；`walk` | 支持；`riding` | 支持；`transit` | 支持；`driving` | 公交有 `departure_date` / `departure_time`；其余出发/到达时间语义未冻结 | 驾车策略可包含躲避拥堵/时间优先；不承诺 SLA；实时更新频率未核实 | `origin/destination` 为 `lat,lng`；`coord_type` 默认 `bd09ll`，可选 `bd09ll`/`bd09mc`/`gcj02`/`wgs84`；`ret_coordtype` 默认 `bd09ll`，可选 `bd09ll`/`gcj02` | `ak`；启用 SN 校验时按官方规则携带 `sn` / `timestamp` | 静态配额、缓存、展示、商业许可均未核实 | 权限、SN 规则、静态配额、缓存、展示、商业许可、时间语义、更新频率、SLA |
| 百度地图 / DirectionLite | 支持；`walking` | 支持；`riding` | 支持；`transit` | 支持；`driving` | 本次未核实 | 本次未核实；不据此记录实时性或 SLA | DirectionLite 的输入/输出坐标系需单独确认；不继承普通 v2 的坐标规则 | 本记录仅确认 `ak`；DirectionLite 的 SN / `timestamp` 规则未单独核实 | 静态配额、缓存、展示、商业许可均未核实 | DirectionLite 权限、坐标系、鉴权细节、静态配额、缓存、展示、商业许可、时间参数、路况实时性、SLA |

## 3. 官方来源记录

### 高德

- [高德路线规划 2.0](https://lbs.amap.com/api/webservice/guide/api/newroute)：访问日期：2026-08-28；
  本记录采用其按方式拆分的 endpoint：`/v5/direction/driving`、`/v5/direction/walking`、
  `/v5/direction/transit/integrated`、`/v5/direction/bicycling`、`/v5/direction/electrobike`，
  以及 `key` 鉴权和 `lng,lat` 请求顺序的已审查事实。
- [高德 FAQ 46660](https://lbs.amap.com/faq/webservice/webservice-api/46660)：访问日期：2026-08-28；
  原审查入口，当前正文/重定向需复核，不作为坐标唯一证据。
- [高德官方 FAQ 39838](https://lbs.amap.com/faq/advisory/others/39838)：访问日期：2026-08-28；
  GCJ-02 依据。
- [高德 Web 服务 API 概览](https://lbs.amap.com/api/webservice/summary)：访问日期：2026-08-28。

### 腾讯位置服务

- [腾讯位置服务 Direction API](https://lbs.qq.com/service/webService/webServiceGuide/route/webServiceRoute)：
  访问日期：2026-08-28；本记录采用步行、骑行、驾车、公交、`key` 鉴权、
  `from/to=lat,lng` 以及距离/时长/策略可核实的已审查事实。该路线正文未明确输入/输出坐标系；
  `departure-time`、`arrival-by` 和实时性保留为未核实项。

### 百度地图开放平台

- [百度普通 Direction API v2](https://lbsyun.baidu.com/faq/api?title=webapi/guide/webservice-directionapi)：
  访问日期：2026-08-28；本记录采用 `walk`、`riding`、`driving`、`transit`，
  `ak` 与 SN 校验规则、`origin/destination=lat,lng`、`coord_type`、`ret_coordtype`、公交时间
  参数和驾车策略的已审查事实。
- [百度 DirectionLite](https://lbsyun.baidu.com/faq/api?title=webapi/guide/webservice-directionliteapi)：
  访问日期：2026-08-28；官方文档标注 2026-03-19 更新的 v1.0，并列出 `driving`、`riding`、
  `walking`、`transit`；本记录以 `ak` 鉴权为已审查事实。DirectionLite 的输入/输出坐标系、时间
  参数、路况实时性和 SLA 未核实；普通 Direction API v2 的坐标参数和公交时间字段不外推到
  DirectionLite。
- [百度坐标转换](https://lbsyun.baidu.com/faq/api?title=webapi/guide/changeposition)：访问日期：2026-08-28；
  作为坐标转换相关官方资料记录。
- [百度 Web API 鉴权](https://lbsyun.baidu.com/faq/api?title=webapi/auth)：访问日期：2026-08-28；
  作为 `ak` 与 SN 校验规则相关官方资料记录。

公开正文能证明接口/字段存在，不等于账号已开通、配额可用或获得缓存/展示/商业使用权。

## 4.1 与 WS0 契约的边界

本审查记录不生成或签发路线 ID。WS0 只校验匹配 `^rte_[a-f0-9]{32,124}$` 的格式，
总长度为 36–128 字符；WS1 才负责服务端 CSPRNG 生成和 session 绑定。对
`appointment.startsAt`，项目接受 `Z` 或 `[-12:00, +14:00]` 闭区间内的显式 UTC offset；
这是本项目的接受范围，不是完整 ISO 8601 规范的断言，也不在本阶段验证 offset 与 IANA timezone
是否匹配。

高德路线规划 2.0 仅按方式记录已审核的 endpoint：`/v5/direction/driving`、
`/v5/direction/walking`、`/v5/direction/transit/integrated`、`/v5/direction/bicycling`、
`/v5/direction/electrobike`，不记录统一 endpoint 加 `mode=0/1/2/3/4` 的模型。百度
DirectionLite 单独列出 `driving`、`riding`、`walking`、`transit`；它与普通百度 Direction API v2
分开，v2 的坐标参数和公交时间字段不外推到 DirectionLite。

## 4.2 RouteArtifact 与阶段性决策

`RouteArtifact` 是服务端内部的可信几何产物。本文档只冻结以下类型字段：

`routeId` / `sessionId` / `provider` / `mode` / `coordinateSystem` / `geometry` /
`fetchedAt` / `expiresAt`

原始供应商响应默认不保留，也不进入 LLM。`RoutePlan` 面向产品和 Agent 的摘要边界与
`RouteArtifact` 的内部字段边界保持分离；本记录不增加原始响应、供应商私有字段或面向 LLM 的
几何序列化字段。

在用户批准供应商顺序且完成官方权限、配额、缓存、展示和商业许可确认前，项目不选择主供应商、
不注册 `RouteProvider` 实例、不调用 live provider。当前阶段保持 provider-neutral，并继续使用
显式 `estimate` 降级作为无真实路线供应商时的边界。
