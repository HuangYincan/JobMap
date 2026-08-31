# 31 — 求职导航 Agent 下一阶段开发计划

**文档版本:** 1.0

**创建日期:** 2026-08-27

**状态:** WS0–WS4 已完成并合并；§8 布局已于 2026-08-28 用户明确批准；WS4/M3 前端体验已完成并合并（生产仍为 estimate-only，无真实路况、无 live provider、无 live traffic）；用户研究仍待办；WS5 未实现；Playwright 桌面/移动截图由合并后补采集

**目标岗位:** 腾讯地图 AI 产品培训生（导航 Agent）

**相关:** `tech/05-milestones.md`、`tech/20-development-plan.md`、`tech/23-map-engines.md`、`tech/24-agent-feature.md`、`tech/30-agent-memory.md`

> 本文是下一阶段的产品、技术和验收总计划。WS0 的导航契约、纯校验、40 条离线评测基线、
> 供应商约束审查和对应 ADR，以及 WS1 的 provider-neutral 路线服务、显式 estimate、
> 会话隔离 artifact 与两个 route handler 已实现；WS2 的 Work/Navigation 域工具、`showRoute` 动作与 chat 会话共享已实现；
> WS3 的可替换事件 sink、离线 runner 与 SQL/Python 报告已完成并合并(不落库、不复用 `audit_events`)。
> §8 的 ASCII 布局已于 **2026-08-28 用户明确批准**；WS4 已完成并合并 MapView polyline、
> 客户端 `GET` artifact 后画线、Work 通勤对比表组件与地图来源条。Explore 内页签（岗位 / 对比 / 行程）已于 2026-08-31 移除。
> Explore 通勤粗筛头（起点/方式/上限分钟/严格命中页签）已于 2026-08-29 按用户要求移除。
> 生产构造器仍注册零个 live provider，规划结果仍是明确标注的直线 `estimate`，不宣称真实道路或实时路况。

---

## 1. 执行摘要

下一阶段不把 Domain Map 扩成通用导航 App，而是把已经可用的 Work 模式从
「在地图上找岗位」升级为一个边界清晰的**求职导航 Agent**：围绕岗位发现、
通勤约束、岗位对比和面试到达计划，帮助用户从“哪里有岗位”走到“这个岗位是否
适合我的日常出行，以及面试当天应该如何安排”。

产品闭环按导航 Agent 的三层能力设计：

| 层 | P5 要解决的问题 | 主要产物 |
|---|---|---|
| 感知 Perception | 理解岗位、城市、出发地、通勤上限、出行方式、面试时间等显式或缺失条件 | `NavigationIntent`、槽位校验、澄清策略 |
| 规划 Planning | 联合真实岗位数据与可信路线结果，完成筛选、对比和到达时间倒推 | Work 工具、Route Provider、比较器、路线产物 |
| 交互 Interaction | 用自然语言、结构化对比和受控地图动作呈现结果，并明确不确定性 | `showRoute`、岗位/通勤对比、降级提示、会话内主动建议 |

该阶段直接形成岗位 JD 所需的可展示证据：用户需求分析、原型设计、LLM 工具编排、
地图路线数据处理、SQL/Python 分析、离线评测和跨模块产品推进。最终演示的核心不是
“接了一个聊天框”，而是 Agent 能否基于项目自己的岗位数据完成可验证的导航任务。

## 2. 当前基线与能力缺口

### 2.1 已实现且可复用

1. **全国 Work 数据与检索。** 招聘公司、办公点和在招岗位由 PostgreSQL/PostGIS
   提供，公共 Work 读路径为严格 DB-only；已有关键词、30+ 维筛选、排序、空间裁剪、
   岗位详情、收藏、申请记录和提醒队列。
2. **受控 AI Agent。** `server/src/lib/agent/**` 已实现 OpenAI 兼容 Agent 循环、
   白名单工具、SSE、六类受控地图动作、停止/撤销和异常收敛；登录用户已有个性化记忆。
3. **地图引擎适配。** `server/src/lib/map-engine/**` 已隔离浏览器地图视图、覆盖物和
   POI 搜索；高德为当前启用引擎，腾讯/百度实现保留但暂未开放切换。
4. **通勤展示地基。** `server/src/lib/commute.ts` 可按直线距离估算步行、骑行、公交、
   驾车时长，并生成外部高德导航链接。
5. **WS0 导航契约与验证。** `server/src/lib/navigation/{constants,errors,index,types,validation}.ts`
   已存在，包含导航契约、错误对象和纯校验。
6. **WS0 离线评测与供应商约束审查。** `server/tests/fixtures/navigation-eval-cases.json`
   已建立恰好 40 条基线，分布为 12/10/10/8；路线供应商审查记录和阶段性 ADR 已完成。
7. **WS1 路线可信地基。** `route-provider.ts`、`route-service.ts`、`estimate-provider.ts`、
   `route-artifacts.ts`、navigation session/HTTP runtime 和两个 navigation route handler 已实现；
   provider fake、超时/中止、降级、geometry、TTL、entry/aggregate-point 双容量、会话隔离和
   API 错误矩阵均有本地测试。
8. **WS3 离线评测与事件 sink。** `analytics.ts`、`eval-policy.ts`、`eval-runner.ts`、
   playbook sidecar 与 `server/scripts/navigation-eval/` 已实现；产品事件不落库，不接到
   生产 chat / RouteService。

### 2.2 尚未实现

1. 当前生产路线规划仍只返回明确标注的直线距离估算；虽已有服务端路线服务与可信 geometry
   seam，但没有注册真实路线供应商，因此没有生产真实路径几何、换乘信息、路况属性或供应商
   arrival-by 规划。
2. 浏览器 `map-engine` 是地图渲染/搜索适配器，不能直接充当服务端路线规划层；两者的
   key、权限、坐标、失败语义和调用位置不同。
3. Agent 已有通用地图/MCP/记忆工具，以及项目域内的岗位搜索、岗位详情、通勤过滤和
   岗位-通勤联合比较工具；系统提示含求职导航纪律。生产路线默认仍是直线 `estimate`。
4. 第七种受控动作 `showRoute { routeId }` 已在服务端与客户端校验；合法 `showRoute` 会
   `GET /api/navigation/routes/:routeId`（`credentials: 'include'`）并在 200 + geometry 时经
   `MapBridge.drawRoute` 画实线。estimate 没有 `routeId`，不得走该 GET；选中岗位可画虚线直线估算。
   LLM 不得输出 polyline。生产无 live provider 时不会出现真实道路折线。
5. 已有无敏感信息的 40 条离线评测基线、WS3 离线 runner、可替换事件 sink 与 SQL/Python
   报告；产品事件仍不持久化，不复用 `audit_events`。真实用户样本与 UI 评测仍未实现。
6. 尚无后台定位、后台提醒或持续重规划能力；P5 也不应暗示已具备这些能力。

## 3. P5 目标、非目标与成功定义

### 3.1 P5 目标

1. 支持自然语言生成结构化求职导航意图，并对缺失的关键槽位进行最少一次的有效澄清。
2. 在官方授权与配额允许时返回真实路线；供应商不可用时保留当前估算能力，但必须把
   `provider_route` 与 `estimate` 明确区分。
3. 让 Agent 能使用项目自己的岗位数据完成检索、详情读取、通勤过滤和多岗位比较。
4. 支持“按时到达面试”的出发时间倒推，并展示计算依据、时间基准和安全余量。
5. 只让前端根据服务端签发的 `routeId` 展示路线，禁止 LLM 生成或修改路线几何。
6. 建立 30–50 条离线任务集、产品事件字典和可复现的分析方法，为后续迭代提供数据依据。
7. 产出一套可在求职面试中完整讲述的 PRD、原型、架构、实验和复盘材料。

### 3.2 明确非目标

- 不做逐向导航、车道级引导、语音播报、偏航重算或实时驾驶安全能力。
- 不做通用“去哪儿都能导航”的超级入口；P5 仅服务 Work 模式的求职决策与面试到达。
- 不做后台持续定位、地理围栏、系统级推送或离开 App 后的主动提醒；这些进入 P6。
- 不默认保存家庭地址、精确起点、完整对话文本或完整路线轨迹。
- 不让 LLM 生成路线坐标，也不把路线供应商返回的文本直接当作可信 UI 指令。
- 不上线未经验证的黑盒“岗位推荐总分”；先呈现可解释的多维事实和规则命中。
- 不新增未经来源审查的数据采集，不启用第三方可执行插件，不绕过供应商权限或配额。

### 3.3 P5 完成定义

P5 只有在三条核心场景全部端到端通过、路线来源与降级状态 100% 可见、非法动作 100%
被阻断、前端完成用户批准后的桌面/移动验证、离线评测达到 §7 暂定门槛后，才可从
“Planned”改为“Complete”。

## 4. 必须打通的产品场景

### 4.1 场景 A：通勤约束下找岗位

**用户输入:**“杭州 AI 产品实习，地铁 45 分钟内。”

**目标链路:**

1. 识别城市、岗位方向、求职类型、出行偏好和通勤上限。
2. 若缺少起点，只询问一次高价值信息，例如当前地点、附近地铁站或用户愿意提供的
   粗粒度区域；不得猜测家庭地址。
3. 先用岗位条件与空间粗筛得到候选集，再对 Top-K 办公点执行真实路线规划，避免为全国
   全量岗位逐一请求路线。
4. 返回满足 45 分钟约束的岗位；没有严格命中时，明确说明并给出最接近的候选或建议放宽
   到 60 分钟，不得把超限结果伪装成命中。
5. 每个结果展示岗位事实、通勤方式/时长、路线质量和获取时间。

### 4.2 场景 B：岗位与通勤联合比较

**用户输入:**“帮我比较腾讯和阿里的 AI 产品岗位，岗位本身和通勤都要看。”

**目标链路:**

1. 从当前 DB 中解析用户指向的公司、办公点和仍在招的岗位；有多个城市或多个同名岗位时
   先澄清或让用户勾选，不能私自挑选。
2. 对岗位维度展示职位名称、地点、求职类型、薪资（若有）、学历/经验、截止时间、来源和
   数据新鲜度；缺失字段显示“未提供”。
3. 对通勤维度展示方式、时长、距离、换乘/步行摘要（供应商有可靠字段时）、路线质量和
   失败原因。
4. 输出多维对比和约束命中，不生成未经验证的综合推荐分。可以说明“更符合 45 分钟限制”
   或“岗位信息更完整”，但必须列出依据。

### 4.3 场景 C：面试到达计划

**用户输入:**“明天 9 点面试，几点出发，优先地铁。”

**目标链路:**

1. 补齐面试岗位/地点、出发地、时区和期望提前到达分钟数。
2. 把“明天 9 点”在服务端转换为带时区的绝对时间，并在确认文案中展示具体日期和时间，
   避免跨午夜、时区或会话延迟造成歧义。
3. 优先请求公共交通路线；供应商支持指定到达/出发时间时如实使用，否则按当前可用时长
   加可解释的候车/步行/安全余量倒推出发时间，并标注“不含实时变化”。
4. 生成主路线、备选路线和“建议最晚出发时间”；路线失败时不得凭空给出精确分钟数。
5. P5 只在当前会话内建议用户查看路线或保存计划，不承诺后台提醒。

### 4.4 边界与错误路径

| 情况 | 必须行为 |
|---|---|
| 起点缺失 | 请求当前位置、地铁站或粗粒度区域；不猜、不读未授权位置 |
| 公司/岗位/城市歧义 | 展示有限候选并要求选择，不静默决定 |
| 岗位已下线或过期 | 从比较集中移除并说明数据状态，提供重新检索入口 |
| 严格通勤条件无结果 | 返回 0 个严格命中，并单列最接近候选及放宽条件 |
| 路线供应商超时/限流/无权限 | 显式切换 `estimate`，隐藏路线几何，保留失败类别和重试入口 |
| 某种出行方式不支持 | 不伪造结果；展示可用方式或请求用户调整偏好 |
| 时间无法解析 | 追问具体日期、时间和时区；不自行补默认日期 |
| 路线过期 | 拒绝展示旧 artifact，重新规划并更新 `fetchedAt` |
| LLM 输出未知动作或 routeId | 动作校验层拒绝，前端不执行 |
| 用户拒绝位置授权 | 允许手输地铁站/商圈，或仅做岗位事实比较 |

## 5. 产品与技术契约

### 5.1 `NavigationIntent`

LLM 可以提出候选字段，但服务端必须用闭合 schema 做类型、范围、时间和枚举校验；
未经校验的对象不能进入路线供应商或岗位查询层。

```ts
type NavigationTask = 'job_search' | 'job_compare' | 'interview_arrival';
type TravelMode = 'walk' | 'bike' | 'transit' | 'drive';

interface NavigationLocationRef {
  kind: 'current_location' | 'coordinate' | 'poi' | 'text';
  label?: string;
  lng?: number;
  lat?: number;
  coordinateSystem?: 'wgs84' | 'gcj02' | 'bd09ll';
  city?: string;
  precision: 'exact' | 'approximate';
}

interface NavigationIntent {
  task: NavigationTask;
  query?: string;
  city?: string;
  companyIds?: string[];
  positionIds?: string[];
  origin?: NavigationLocationRef;
  destination?: NavigationLocationRef;
  commute?: {
    preferredModes: TravelMode[];
    maxMinutes?: number;
  };
  appointment?: {
    startsAt: string; // validated ISO 8601 with Z or a project-approved UTC offset
    timezone: string;
    arrivalBufferMinutes: number;
  };
  missingSlots: Array<'origin' | 'destination' | 'city' | 'position' | 'appointment_time'>;
}
```

约束：`maxMinutes`、缓冲时间、候选数量和文本长度必须有限；`kind: 'coordinate'` 必须同时
包含 finite 的 `lng`、`lat` 和显式 `coordinateSystem`。其他位置类型只有在确实携带坐标时才
使用 `coordinateSystem`；没有坐标时不得单独携带它，非坐标型位置不得伪造默认供应商坐标。
相对时间只有完成绝对化后才能进入规划；`missingSlots` 非空时不得调用路线规划。
`appointment.startsAt` 可以使用 `Z` 或显式 `±HH:MM`，但带 offset 的值只接受本项目的
`[-12:00, +14:00]` 闭区间；这是本项目的接受范围，不是对完整 ISO 8601 offset 范围的表述。
本阶段不验证 offset 是否与 IANA timezone 一致。

### 5.2 `RoutePlan`

```ts
type RouteQuality = 'provider_route' | 'estimate';
interface RoutePlanBase {
  mode: TravelMode;
  originLabel: string;
  destinationLabel: string;
  durationSeconds: number;
  distanceMeters: number;
  departureAt?: string;
  arrivalAt?: string;
  provider: 'amap' | 'tencent' | 'baidu' | 'estimate';
  quality: RouteQuality;
  trafficAware: boolean;
  fetchedAt: string;
  expiresAt: string;
  summary?: {
    transferCount?: number;
    walkingMeters?: number;
  };
  warnings: string[];
}

interface ProviderRoutePlan extends RoutePlanBase {
  routeId: string;
  provider: 'amap' | 'tencent' | 'baidu';
  quality: 'provider_route';
}

interface EstimateRoutePlan extends RoutePlanBase {
  routeId?: never;
  provider: 'estimate';
  quality: 'estimate';
  trafficAware: false;
}

type RoutePlan = ProviderRoutePlan | EstimateRoutePlan;
```

`RoutePlan` 面向产品和 Agent，只暴露可解释摘要，不包含 `geometry`。服务端 `RouteArtifact`
仅保存冻结类型字段：`routeId`、`sessionId`、`provider`、`mode`、`coordinateSystem`、
`geometry`、`fetchedAt`、`expiresAt`；原始供应商响应和校验摘要默认不保留，也不进入 LLM
上下文。

`RoutePlan` 和 `RouteArtifact` 都必须满足 `expiresAt > fetchedAt`，且有效期
`expiresAt - fetchedAt` 最大为 3600 秒。

### 5.3 路线产物与可信几何

1. WS1 路线服务校验输入后调用注入的 `RouteProvider`，将供应商结果归一化为明确坐标系，
   并校验点数、范围、长度和起终点偏差。
2. 只有 `provider_route` 结果需要路线引用；WS1 在服务端通过 CSPRNG 生成匹配
   `^rte_[a-f0-9]{32,124}$` 的不可猜测、会话绑定 `routeId`（总长度 36–128 字符，上限 128）。
   WS0 当前只校验格式，不生成 ID；
   `estimate` 不生成 `routeId`。路线 artifact 只在进程内存中短暂保存，默认同时限制 1,000
   entries 与 50,000 aggregate geometry points，并受 TTL 约束；单条超过点预算会拒绝，累计
   超预算则淘汰最老 entry。不做 DB、文件或 analytics 持久化。
3. Agent 工具只拿到 `RoutePlan` 摘要；只有 `provider_route` 摘要可带 `routeId`，LLM 不接触
   polyline。
4. 新增受控动作候选：`showRoute { routeId }`。`validateAction` 只接受格式合法的 ID；前端再从
   同会话的路线端点读取 artifact，过期、越权或不存在都不绘制。
5. `estimate` 结果没有可信道路几何，因此不能生成 `showRoute`；UI 只能显示直线估算标签和
   外部导航入口。

建议端点（规划）：

```text
POST /api/navigation/routes/plan       # 直接 UI/测试调用，返回 RoutePlan
GET  /api/navigation/routes/:routeId   # 同会话读取可信 artifact
```

### 5.4 路线供应商抽象

浏览器 `MapEngine` 与服务端 `RouteProvider` 必须分离：

```ts
interface RouteProvider {
  id: 'amap' | 'tencent' | 'baidu';
  isConfigured(): boolean;
  supports(request: RouteRequest): boolean;
  plan(request: RouteRequest, signal: AbortSignal): Promise<ProviderRouteResult>;
}
```

`RouteProvider` 接口与 `RouteService` 已在 WS1 实现；生产构造器默认 provider 列表为空，
本阶段不选择、注册、配置或调用真实路线供应商。供应商产品权限、调用顺序、服务条款、配额、
交通方式、时间参数、坐标系和缓存/展示/商业许可仍须人工确认。
每个结果必须携带 `provider`、`fetchedAt`、`trafficAware` 和 `quality`；任何失败都收敛为
稳定错误类别，不向客户端暴露 key、内部 URL 或原始响应。

WS0 的资料审查只记录已审核的产品接口，不代表已注册适配器：高德 Route Planning 2.0 按方式
记录 `/v5/direction/driving`、`/v5/direction/walking`、`/v5/direction/transit/integrated`、
`/v5/direction/bicycling`、`/v5/direction/electrobike`，不抽象成统一 endpoint 加
`mode=0/1/2/3/4`。百度 DirectionLite 单独记录 `driving`、`riding`、`walking`、`transit`；
它与普通百度 Direction API v2 分开，v2 的坐标参数和公交时间字段不外推到 DirectionLite。

现有 `commute.ts` 保留为 `estimate` provider 的算法基础，不再以“像真实路线一样”的形式
混入供应商结果。

### 5.5 Agent 域工具

| 工具 | 输入 | 输出边界 |
|---|---|---|
| `work__searchPositions` | 关键词、城市、结构化岗位条件、分页上限;检索起点=用户位置,未知才用视野中心 | 当前 DB 中的岗位摘要(岗位名/公司优先)、`mapId`(公司目录 id)、`positionId`(仅工具链)、办公点 GCJ-02;公司 logo 作可选图片;附 `mapHints` 供 runner 在 LLM 漏发时合成地图动作;不返回全量 JD |
| `work__getPositionDetail` | `positionId` | 单个仍可见岗位的事实、来源、新鲜度、办公点与 `mapId`;附 `mapHints` |
| `navigation__planRoute` | 已验证起终点、方式、时间条件 | `RoutePlan` 摘要；不返回几何或原始供应商数据 |
| `navigation__compareCommutes` | 1 个起点、2–5 个候选办公点、方式 | 统一口径的路线矩阵、失败项和质量标签 |
| `navigation__filterByCommute` | 候选岗位 ID、起点、上限、方式、Top-K | 严格命中与近似候选，含调用预算和降级说明 |

工具必须复用现有 server catalog / search 契约，不能在 Agent 内复制一套岗位过滤逻辑。
`filterByCommute` 采用“DB/空间粗筛 → Top-K 路线请求 → 严格约束过滤”，设置并发、超时、
候选数和每轮调用预算，避免 N+1 路线风暴。

### 5.6 可解释比较，不做黑盒总分

比较结果按以下事实维度并列展示：

- 岗位：职位、岗位族、求职类型、薪资、学历/经验、城市/办公点、截止时间、来源、新鲜度。
- 通勤：方式、时长、距离、换乘数、步行距离、是否命中上限、是否含路况、获取时间。
- 数据质量：字段缺失、岗位状态、路线 `provider_route` / `estimate`、失败或不支持原因。

系统可以做确定性的约束命中、Pareto 提示和排序，例如“先显示满足 45 分钟且仍在招的岗位”，
但不得把不完整数据压成一个看似精确的 AI 推荐分。每个结论都应能回指到展示维度。

## 6. 目标架构与模块边界

当前实现状态（2026-08-28）：WS0 契约/验证、WS1 的 `route-provider.ts`、
`route-service.ts`、`route-artifacts.ts`、`estimate-provider.ts`、navigation session/HTTP
runtime 与两个 navigation API，以及 WS2 的 `compare.ts`、`work.ts` / `navigation.ts` 域工具、
`showRoute` 动作与 `/api/agent/chat` 导航 cookie 共享已实现。WS3 增加 `analytics.ts` 事件
sink、`eval-runner.ts` / `eval-policy.ts` 离线评测与 SQL/Python 报告；sink 不落库，也不接到
生产 chat / RouteService。生产没有 live provider，POST
正常结果为明确的 `estimate`，不带 geometry/`routeId`；GET 只向同一 navigation session 返回
未过期的 provider artifact 公共形状。`providers/` 与 analytics persistence 仍未实现。
WS4 已完成并合并 `MapView.createPolyline`、`MapBridge.drawRoute`、合法 `showRoute` 的同会话 GET 画线、
Work 通勤对比表组件与地图来源条；Explore 通勤粗筛头已于 2026-08-29 移除，Explore 内页签（岗位 / 对比 / 行程）已于 2026-08-31 移除。生产无 live provider，因此 UI 不会出现真实道路
或实时路况，估算直线不得伪装成 `provider_route`。以下结构图不表示真实路线或实时交通已可用。

```text
用户输入 / Work 筛选 / 已授权位置
                 │
                 ▼
POST /api/agent/chat ──> Intent + Slot Validator
                 │
        ┌────────┴─────────┐
        ▼                  ▼
 Work Domain Tools     Navigation Tools
        │                  │
 DB-only Catalog       Route Service ──> Provider Registry
        │                  │                    │
        └────候选岗位──────┘          官方路线 API / estimate
                           │
                           ▼
                 Route Artifact Store
                    │             │
              RoutePlan 摘要   routeId + geometry
                    │             │
                    ▼             ▼
                 Agent 文本   showRoute 受控动作
                                  │
                                  ▼
                         MapView 路线覆盖物
```

模块结构（WS0/WS1 实现状态；后续项见注释）：

```text
server/src/lib/navigation/
├── constants.ts             # 已实现：契约常量
├── errors.ts                # 已实现：稳定错误
├── index.ts                 # 已实现：导出
├── types.ts                 # 已实现：契约类型
├── validation.ts            # 已实现：纯校验
├── route-provider.ts        # 已实现：provider-neutral 接口与封闭结果/错误
├── route-service.ts         # 已实现：超时/中止、校验、降级、CSPRNG ID
├── route-artifacts.ts       # 已实现：entry/点预算双上限、会话指纹、TTL、读取授权
├── estimate-provider.ts     # 已实现：复用 commute/haversine 的显式估算
├── navigation-session.ts    # 已实现：Path=/api 的独立 CSPRNG cookie 与不可逆指纹
├── route-http.ts            # 已实现：有界 JSON、no-store、顶层 RouteError/HTTP 映射
├── route-runtime.ts         # 已实现：共享进程 store；生产零 live provider
├── compare.ts               # 已实现：通勤矩阵与可解释约束比较（无总分）
├── analytics.ts             # 已实现：可替换事件 sink（内存/JSONL，不落库）
├── eval-policy.ts           # 已实现：首工具策略与离线指标公式
├── eval-runner.ts           # 已实现：40 条 fixture + extra 安全用例离线 runner
└── providers/               # 未实现：经人工确认后再决定的供应商适配器

server/src/lib/agent/tools/
├── work.ts                  # 已实现：项目岗位搜索/详情
└── navigation.ts            # 已实现：路线/比较/通勤过滤工具

server/src/app/api/navigation/routes/
├── plan/route.ts            # 已实现：校验后规划；当前生产结果为 estimate
└── [routeId]/route.ts       # 已实现：同会话读取未过期 public artifact
```

所有前端路线 overlay 经 `MapView.createPolyline` / `MapBridge.drawRoute` 绘制，业务组件不直连
某家地图 SDK。estimate 虚线与 provider 实线共用该 seam。
若不同底图的路线坐标系不同，转换必须在受测的适配边界完成（百度 gcj02→bd09 与 marker 同套）。

## 7. 数据、隐私、评测与指标

### 7.1 产品事件

WS0/WS1 不持久化产品分析事件；后续事件 sink 与留存策略需独立决策。先定义事件契约和可替换
sink，再决定是否持久化。**不得复用 `audit_events` 充当产品分析表**：
该表用于审计语义，产品漏斗的采样、匿名化、删除和留存要求不同。

首批事件建议：

```text
navigation_intent_parsed
navigation_slot_clarified
navigation_job_search_completed
navigation_route_requested
navigation_route_resolved
navigation_route_degraded
navigation_comparison_viewed
navigation_route_action_applied
navigation_task_completed
```

允许字段：任务类型、城市、方式、候选数、耗时、结果数、路线质量、失败类别、是否完成。
默认禁止字段：原始用户话术、完整对话、完整地址、精确起终点、路线 polyline、供应商原始响应、
密钥或用户记忆全文。若后续落库，必须先批准同意机制、用户删除、访问控制和具体留存天数。

### 7.2 离线评测集

`server/tests/fixtures/navigation-eval-cases.json` 的 40 条版本化离线 fixture 基线已实现，
恰好 40 条，分布为 12/10/10/8。fixture 覆盖意图、契约和安全边界。WS3 已增加 sidecar
playbook、离线 runner、可替换事件 sink 和 SQL/Python 报告；runner 只消费 `candidate`，
事件中不含 `utterance`。仍无真实路线供应商冒烟、无真实 key、无 UI 评测。

| 类型 | 数量 | 覆盖 |
|---|---:|---|
| 通勤约束岗位搜索 | 12 | 城市、岗位族、实习/校招、阈值、起点缺失、0 结果 |
| 岗位与通勤比较 | 10 | 同公司多地点、同名岗位、字段缺失、路线部分失败 |
| 面试到达计划 | 10 | 相对时间、跨日、缓冲时间、方式不支持、provider/estimate |
| 安全与异常 | 8 | 伪造坐标、未知动作、越权 routeId、超时、限流、过期 artifact |

后续 runner 围绕用户输入、会话上下文、期望意图、必填槽位、允许工具序列、禁止动作、
期望质量标签执行；WS3 已实现该离线 runner（`eval-runner.ts` + `navigation-eval-playbook.json`）、
指标采集和 SQL/Python 报告。真实 key 冒烟与桌面/移动 UI 评测仍未实现。

### 7.3 暂定质量门槛

| 指标 | P5 门槛 | 口径 |
|---|---:|---|
| 必填槽位识别准确率 | ≥ 90% | 离线案例逐槽位 micro accuracy |
| 工具选择准确率 | ≥ 90% | 首个必要工具和禁止工具均纳入 |
| 路线来源/质量标注 | 100% | 每个路线结果均有 provider、时间、quality |
| 非法动作阻断率 | 100% | 未签发/过期/越权/畸形 routeId 全拒绝 |
| 供应商失败显式降级 | 100% | 不静默伪装成真实路线 |
| 三条核心场景端到端 | 100% | 桌面和移动批准布局均通过 |

业务指标在没有真实基线前不拍脑袋设增长目标。P5 先建立任务完成率、澄清率、严格通勤命中率、
路线降级率、比较完成率和 P95 延迟口径；获得合规样本后再为 P6 设置实验目标。

### 7.4 SQL 与 Python 分析产物

为了让产品判断可复现，而不是只在演示中口述，WS3 已交付：

1. 事件/离线结果的数据字典和示例数据，不含上述禁止字段
   （`tech/roles/development/eval/navigation-events.md`，JSONL sink，不落库）。
2. SQL 分析：任务漏斗、路线降级率、各方式耗时分布、0 结果率和澄清后完成率
   （`server/scripts/navigation-eval/funnel.sql`，查询示例 SQLite 表，不是 `audit_events`）。
3. Python 分析脚本：读取离线评测结果，计算槽位/工具/动作指标并输出 Markdown/CSV 报告
   （`server/scripts/navigation-eval/report.py`，stdlib only）。
4. 一份基于数据的迭代结论，明确样本量、偏差、不能推出的结论和下一轮假设
   （`tech/roles/development/eval/navigation-ws3-baseline.md`）。

## 8. 前端布局审批稿

> **审批状态：已于 2026-08-28 用户明确批准。** 桌面来源条在地图底部且不得挡住 zoom/locate；
> 移动不新增第 6 个工具栏按钮。Explore 内页签（岗位 / 对比 / 行程）已于 2026-08-31 移除。生产仍为 estimate-only。

### 8.1 桌面端（建议）

> 2026-08-29：用户要求移除 Explore 通勤粗筛头（起点/方式/上限分钟/严格命中·接近条件·对比计数）。
> 2026-08-31：用户要求移除 Explore 岗位 / 对比 / 行程页签。下列 ASCII 仍是 2026-08-28 已批稿；当前实现以 `tech/07-frontend-design-system.md` 为准。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Work  [杭州 AI 产品实习________________] [筛选] [对比 2]        [地图工具] │
├───────────────────────┬──────────────────────────────────────────────────────┤
│ 岗位结果 / 对比       │                                                      │
│ ───────────────────   │                地图 + 可信路线                      │
│ 起点  文三路地铁站    │          A ●━━━━━━━━━━━━━━● B                       │
│ 地铁  ≤45 分钟        │                                                      │
│                       │                                      ┌────────────┐ │
│ □ 岗位 A  38 分钟     │                                      │ AI 对话    │ │
│ □ 岗位 B  44 分钟     │                                      │ 条件确认   │ │
│ □ 岗位 C  估算 51 分  │                                      │ 路线摘要   │ │
│                       │                                      │ [看路线]   │ │
│ [严格命中] [接近条件] │                                      └────────────┘ │
├───────────────────────┴──────────────────────────────────────────────────────┤
│ 路线来源：供应商 · 获取时间 · 是否含路况 / 估算降级原因                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

交互原则：岗位列表保持高密度可扫描；对比使用列式事实表，不把每个字段做成卡片；Agent 面板沿用
现有入口；路线来源和估算状态不能只藏在 tooltip；地图与列表选择保持双向联动。

### 8.2 移动端（建议）

```text
┌──────────────────────────────┐
│ [返回] 杭州 AI 产品   [筛选] │
├──────────────────────────────┤
│                              │
│        地图 + 路线           │
│       A ━━━━━━━ B            │
│                              │
├──────────────────────────────┤
│ 岗位 | 对比 | 行程 | AI      │
│ ───────────────────────────  │
│ 起点：文三路地铁站           │
│ 地铁 ≤45 分钟 · 严格命中 2   │
│                              │
│ 岗位 A              38 分钟  │
│ 岗位 B              44 分钟  │
│ [展开路线与来源]             │
└──────────────────────────────┘
```

必须覆盖的界面状态：槽位缺失、路线加载、真实路线、估算降级、严格 0 结果、部分候选失败、
路线过期、岗位下线、位置拒绝、离线/重试。任何状态都不能造成地图控件、抽屉、Agent 输入框或
底部安全区互相遮挡。

## 9. Workstream 与实施顺序

所有开发遵守 worktree-first；每个 workstream 从 `dev` 建独立分支，提交 Conventional Commits，
通过自身门禁后按顺序合回 `dev`。本阶段建议合并顺序固定为：

```text
WS0 → WS1 → WS2 → WS3 → WS4 → WS5
```

| WS | 状态 | 目标 | 主要交付 | 进入条件 | 完成门禁 |
|---|---|---|---|---|---|
| WS0 合同/来源/隐私 | 已完成并合并 | 冻结意图、路线、错误、供应商和数据留存边界 | 契约、验证、ADR、provider 审查和 40 条 fixture 已完成；用户研究不属于已完成证据 | 已通过并合并 | 决策无悬空高风险项；不触碰前端 |
| WS1 路线核心 | 已完成并合并 | 建立 provider-neutral 路线服务与 estimate 降级 | navigation types/service/provider/artifact、API、单测 | WS0 合并后 | 超时/配额/不支持/坐标/TTL/会话隔离测试全绿 |
| WS2 Agent 域工具 | 已完成并合并 | 把岗位数据和路线服务接入 Agent | 5 个域工具、专用 prompt、`showRoute` 动作、工具预算 | WS1 | LLM 无几何；动作与岗位越权全拒绝；三主场景后端链可跑 |
| WS3 评测与事件 | 已完成并合并 | 建立可复现的产品判断闭环 | 事件 sink 契约、离线 runner、SQL/Python 报告、基线结果 | WS2 | §7 指标可自动计算；无敏感字段；不复用 `audit_events` |
| WS4 前端体验 | 已完成并合并（生产 estimate-only） | 呈现通勤筛选、比较、行程和可信路线 | 已批桌面/移动 UI、路线 overlay、来源条、完整状态文案 | §8 已于 2026-08-28 用户明确批准且 WS3 完成 | typecheck/test；Playwright 截图由合并后补；无第 6 工具栏按钮 |
| WS5 主动建议/集成 | 未实现 | 完成会话内主动思考和演示闭环 | 条件缺口提示、0 结果放宽建议、面试缓冲建议、最终复盘 | WS4 | 三主场景 100%；全量回归；文档与演示材料同步 |

WS0、WS1、WS2、WS3 与 WS4 均已完成并合并。生产规划仍为
直线 `estimate`，无真实路况、无 live traffic。WS5 尚未实现。P5 的“主动”只指当前会话中根据已知条件发现缺口、风险和
替代方案，不包含后台追踪或未经用户触发的定位。
生产 chat / RouteService 不持久化、不默认发射这些产品事件。

## 10. 里程碑与验收门禁

| 里程碑 | 状态 | 退出条件 |
|---|---|---|
| M0 需求与契约冻结 | 部分完成 | 契约、供应商/隐私边界和评测骨架已完成；5–8 名目标用户任务访谈/可用性输入仍待办 |
| M1 路线可信地基 | 已完成并合并 | provider seam + estimate、来源标签、artifact 会话隔离、API 错误矩阵通过 |
| M2 Agent 求职规划 | 已完成并合并 | Work/Navigation 工具、意图槽位、比较器、`showRoute` 后端链通过 |
| M3 用户体验闭环 | 已完成并合并（生产 estimate-only） | §8 已于 2026-08-28 批准；桌面/移动通勤 UI、来源条与 overlay 已落地并合并；无 live provider、无 live traffic；Playwright 截图待合并后补 |
| M4 评测与岗位材料 | 离线指标/报告已实现，UI/真实用户样本未实现 | 指标达标、三场景录屏/截图、SQL/Python 报告、PRD/技术复盘同步 |

每个实现 workstream 至少执行：

```bash
cd server && npm test
cd server && npm run typecheck
make docs-check
git diff --check
```

涉及真实路线供应商的冒烟必须是 Env-only、低配额、可中止操作；日志和报告不得输出 key、
完整请求 URL、精确用户起点或供应商原始响应。前端验收产物统一写入 `.playwright-mcp/`。

## 11. 主要风险与控制

| 风险 | 控制 |
|---|---|
| 路线 API 产品权限、条款或配额不满足 | 人工确认供应商产品权限、调用顺序、条款、配额、缓存/展示与商业授权完成前，不选择、注册、配置或调用真实路线供应商；estimate 显式降级；不绕过限制 |
| 通勤筛选产生大量路线请求 | DB/空间粗筛、Top-K、并发/超时预算、短 TTL 会话缓存、artifact entry/geometry-point 双预算、部分结果返回 |
| LLM 幻觉路线或岗位 | 域工具只读真实 DB；LLM 不接触几何；动作 ID 白名单；来源/新鲜度可见 |
| 精确位置和出行轨迹泄露 | 起点默认瞬时处理；artifact 会话绑定并过期；事件不记录地址/坐标/polyline |
| 不同供应商坐标和字段不一致 | provider 声明坐标系/能力；归一化与固定点测试；不支持字段显示缺失 |
| “AI 推荐”制造虚假确定性 | 不做黑盒总分；展示约束、事实维度、缺失数据和路线质量 |
| 面试时间建议过于精确 | 绝对时间确认、缓冲可解释、trafficAware 标签、过期重算和失败不报精确值 |
| 前端信息密度失控 | 先原型和 ASCII 审批；列表/对比/行程分视图；桌面移动真实截图验收 |
| 岗位数据过期 | 查询时复用 alive 规则；比较前重新读取；下线项显式移除 |

## 12. 与腾讯地图 AI 产品培训生 JD 的证据映射

| JD 能力 | 本阶段可展示证据 | 面试表达重点 |
|---|---|---|
| 导航场景与用户需求 | 三主场景、边界路径、5–8 人任务访谈、PRD | 从“找岗位”识别出通勤约束和面试到达的隐性需求 |
| 感知/规划/交互设计 | `NavigationIntent`、工具编排、路线 artifact、受控动作 | Agent 不是聊天皮肤，而是可验证的感知—规划—交互链 |
| Axure/Sketch 产品设计 | 获批 ASCII、可点击高保真原型、状态矩阵、桌面/移动可用性记录 | 展示复杂地图信息在有限空间内的取舍和迭代依据 |
| 大模型原理与应用 | function calling、槽位校验、工具预算、prompt、离线 eval、防幻觉 | 说明模型负责意图与编排，确定性服务负责数据和路线 |
| 地图数据与算法 | Route Provider、坐标系、Top-K 通勤筛选、TTL/降级/来源标签 | 说明路线质量、配额、坐标和实时性的工程约束 |
| SQL/Python 数据分析 | 漏斗 SQL、离线评测 Python、指标报告、0 结果和降级分析 | 用数据发现失败点，再提出下一轮产品假设 |
| 创新与复杂问题推进 | 会话内主动澄清/风险提示、跨 Work/Agent/Map/DB workstream | 说明如何在隐私、真实性、性能和体验之间做可审计取舍 |

建议最终作品集结构：问题与用户证据 → 产品目标和非目标 → 原型 → 技术架构 → 指标与实验 →
失败案例 → 迭代结果。演示必须主动指出能力边界，避免把路线估算包装成实时导航。

## 13. 开工前仍需拍板的三项决策

1. **路线供应商顺序与授权。** 完成官方权限/条款/配额审查后，决定主 provider 和降级链；
   在此之前 WS1 只实现 provider-neutral 接口和显式 `estimate` adapter，不调用真实供应商。
2. **产品事件持久化与留存。** 决定 P5 是仅离线评测，还是新增独立事件存储；若落库，需明确
   同意、删除、访问控制和留存天数。
3. **前端布局批准。** §8 已于 2026-08-28 用户明确批准；WS4 按该布局实现。Playwright 截图由合并后补。

无 live provider 的 WS1 路线核心已实现；§8 已批准且 WS4 overlay 已完成并合并。供应商顺序与产品事件持久化
仍待决策。不得宣称真实导航、主动提醒或实时路况已经可用。
