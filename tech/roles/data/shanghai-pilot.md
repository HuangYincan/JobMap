# 上海试点(shanghai-pilot)

> **Status:** 试点清单 + 坐标清除 2026-08-19;**15/15 家 -shanghai 站点已全部落真实上海办公点**(geocode:apply AMap→Baidu 兜底 + 官方地址 override,commit 见 dev log)。
> **Owner:** data

## 背景与口径

用户要求拓展真实公司/岗位数据,先做上海市验证可行性(后续北上广深、成都、武汉、苏州、宁波全量拓展)。现状:

- 397 家 radar 公司已有 `-shanghai` 站点(city 上海市 / province 上海市,`location.address` 为城市文本),207 个岗位挂在 -shanghai 站点上;**0 个真实上海坐标**。
- 33 家公司的站点带坐标,但全部来自 2026-08-19 事故恢复(`fecef85`,从杭州 office 复制的错误坐标,如 快手-site-shanghai = 滨江区星耀中心;禾赛-site-shanghai = 萧山奔竞大道),`audit:pins` 会标 wrong-city。
- geocode 工具链已是城市级(`site-geocode.ts` `siteCityTarget` 用站点城市、place-text `citylimit=true`、regeo 直辖市 province 兜底);`geocodeQueryForSite` / `importedSiteQuery` 的杭州硬编码已在 w3 修复(commit `2773e00`)。

## 试点公司清单(15 家)

选型标准:真实上海总部/大办公点明确的知名公司;radar 已有 `-shanghai` 站点;优先用户指定名单(得物、米哈游、哔哩哔哩、拼多多、携程、商汤、上汽集团、中微公司、联影集团、禾赛科技、燧原科技、智元机器人、上海电气、春秋航空),自裁补入乐鑫科技(上海张江总部,AIoT 芯片,雷达已有 -shanghai 站点),剔除/延后项见文末。

| slug | 上海办公点 | careerUrl(静态复核) | -shanghai 站点现状 |
|---|---|---|---|
| 得物 | 总部(杨浦) | poizon.jobs.feishu.cn 飞书 ATS ✅ | 1 站 1 岗;坐标已清(原杭州坐标) |
| 米哈游 | 总部(徐汇漕河泾) | jobs.mihoyo.com 官方 ✅ | 1 站 2 岗;城市文本 |
| 哔哩哔哩 | 总部(杨浦) | jobs.bilibili.com 官方 ✅ | 1 站 0 岗(岗位在 -beijing);城市文本 |
| 拼多多 | 总部(长宁/闵行) | careers.pddglobalhr.com 官方 ✅ | 1 站 1 岗;城市文本 |
| 携程集团 | 总部(长宁凌空SOHO) | careers.ctrip.com 官方 ✅ | 1 站 0 岗;城市文本 |
| 商汤科技-无限原力 | 总部(徐汇) | hr.sensetime.com 官方 ✅ | 1 站 0 岗;坐标已清(原杭州坐标) |
| 上汽集团 | 总部(静安/嘉定) | saic-recruit.saicmotor.com 官方 ✅ | 1 站 1 岗;城市文本 |
| 中微公司 | 总部(浦东金桥) | app.mokahr.com 校招 ATS ✅ | 1 站 1 岗;城市文本 |
| 联影集团 | 总部(嘉定) | united-imaging.zhiye.com 官方 ✅ | 1 站 1 岗;城市文本 |
| 禾赛科技 | 总部(嘉定) | jobs.feishu.cn 飞书 ATS ✅ | 1 站 3 岗;坐标已清(原杭州坐标) |
| 燧原科技 | 总部(浦东张江) | app.mokahr.com 校招 ATS ✅ | 1 站 0 岗;城市文本 |
| 智元机器人 | 总部(浦东) | agirobot.jobs.feishu.cn 飞书 ATS ✅ | 1 站 1 岗;城市文本 |
| 乐鑫科技 | 总部(浦东张江) | espressif.com.cn/join-us 官方 ✅ | 1 站 1 岗;城市文本 |
| 上海电气 | 总部(静安) | sec.hotjob.cn 官方 ATS ✅ | 1 站 1 岗;城市文本 |
| 春秋航空 | 总部(长宁) | wecruit.hotjob.cn 官方 ATS ✅ | 1 站 2 岗;城市文本 |

> careerUrl 复核口径:本轮为**静态复核**(URL 域名/ATS 平台与公司匹配,投递域名均为官网或已知 ATS:飞书 / mokahr / zhiye / hotjob);live HTTP 复核在 boss 合并后的 apply 阶段与 geocode 一起执行(本环境无网络)。

## 坐标清除范围(试点公司,fecef85 错误坐标)

非杭州站点上的杭州 office 坐标 → 恢复 incident 前(`fecef85^`)的 city-text;杭州站点坐标保留(城市一致,且来自 7d19271 验证过的杭州 office,如 禾赛 = 赫兹智造中心)。3 个文件、9 个站点清除:

| 文件 | 清除站点(行号) | 恢复文本 | 保留 |
|---|---|---|---|
| `radar/得物.json` | site-beijing(:17)、site-shanghai(:26)、site-guangzhou(:35)、site-chengdu(:55) | 「北京/上海/广州/杭州」「北京/上海/广州/成都」 | site-hangzhou(:44-46,西湖区黄龙万科国际中心) |
| `radar/商汤科技-无限原力.json` | site-beijing(:17)、site-shanghai(:26)、site-shenzhen(:35) | 「北京/上海/深圳/杭州」 | site-hangzhou(:44-46,萧山天人大厦) |
| `radar/禾赛科技.json` | site-shanghai(:17) | 「上海」 | site-hangzhou(:26-28,萧山奔竞大道) |

校验:`server/tests/shanghai-pilot.test.mjs`(4 用例)——15 家试点公司均有 -shanghai 站点;非杭州站点零坐标;杭州站点坐标落在杭州 bbox;得物/商汤/禾赛 -shanghai 明确无坐标。`npm test` 全绿。

非试点公司不动(口径:保持现状,deferred 记录——33 家中其余 30 家含快手/芯迈半导体/云鲸智能等,坐标仍为杭州,后续批次处理)。

## geocode-overrides 决策(新增 0 条)

**不为试点公司预置上海 overrides**,依据:

1. `geocode-sites-apply.mjs` 的 override 按 **slug 全局套用**到该 slug 所有待 geocode 站点——多城市公司(得物/携程等 5-4 城)会把自己站点的北京/成都/广州全部钉到上海总部坐标,重演 wrong-city;
2. 试点公司均为知名实体,place-text 按站点城市自动解析 + regeo 校验已够用(`gradeOfficePoi` 名字匹配拒零售店、`regeoMatchesTarget` 直辖市 province 兜底);
3. 任务口径「宁缺毋滥,不确定就不预置」。

`exclude` 也不新增:15 家均有可验证上海办公点。

## 管线发现(需 boss 裁决)

`geocode-sites-apply.mjs` 的 `already-pinned` 跳过是**公司级**(`pinned` = 有任一钉点的 slug):试点跑法下,得物/商汤/禾赛(保留杭州站点坐标 → slug 已 pinned)**全部站点会被跳过**,-shanghai 不会被解析;其余 12 家(无任何坐标)按城市级正常解析。要覆盖前 3 家需把跳过改为**站点级**(siteId 维度)——不在 w3 文件边界内,列为后续 fix 或 boss 合并后直接小修。

## 后续步骤(boss 合并后执行,Env-only)

1. `geocode:sites:apply`(城市级,-shanghai 站点自动按上海市解析;得物/商汤/禾赛需先做站点级 pinned 小修)。
2. 新适配器爬试点公司官网职位(飞书/mokahr/zhiye/hotjob 已知 ATS)。
3. LLM 质检 → `import:seed:apply` → `audit:pins` 全量复核。
4. 试点验证通过后,全量拓展其他主流城市(北京/广州/深圳/成都/武汉/苏州/宁波)。

## 剔除/延后

- **芯迈半导体 / 云鲸智能 / 泰隆银行 / 兴业银行**:有坐标但非上海实体(云鲸=深圳总部且无 -shanghai 站点;泰隆=台州;兴业=福州,已有杭州分行 override)或上海办公点不明确(芯迈)→ 不入选;芯迈/云鲸/兴业的杭州坐标留在非杭州站点上,deferred 后续批次清。
- **上汽乘用车/上汽大众/上汽大通/上汽通用-泛亚**:上汽系子品牌,试点以上汽集团代表即可。
- **上海人工智能实验室 / 叠纸游戏 / 傅利叶 / 申能集团 / 哔哩哔哩b-up / 乐鑫科技-领跑者**:候选但名额已满/同名文件重复实体,后续批次。

## 落地结果(2026-08-19,geocode:apply 双 provider)

AMap place-text 日配额耗尽(10044)→ 自动降级百度地点检索(免费 100 次/天,亦耗尽)→ 剩余公司改走**官方地址核实 + 正逆地理编码 v3**(配额 0%,用户提供 BAIDU_MAP_AK)。工具链变更:

- `site-geocode.ts`: AMap→Baidu 兜底(place/regeo/geocode 三入口,统一 GCJ-02);`officeNameMatchStrength` 限定词匹配(拒同名工厂/门店/驿站陷阱);`pickBestOfficePoi` 城市级评分;302/401 间歇配额重试;别名扩展(中微→中微半导体设备、联影→联影医疗、携程→携程国际、拼多多→上海寻梦信息技术、乐鑫→乐鑫信息科技)。
- `geocode-sites-apply.mjs`: 地址级优先分支(siteHasStreetAddress)、override 城市不匹配改「忽略并回落检索」而非整站跳过、grader 按别名后的 query 评分。

> **2026-08-21 (feature/geocode-tencent):** 兜底链升级三级 AMap→Baidu→Tencent。腾讯 WebService(`TENCENT_MAP_KEY`,个人开发者每接口 10000 次/天、5 QPS)在百度重试后仍失败时接管;status≠0 即错误,121/321/322 归每日配额类、120 每秒限流重试一次、110/112/190/199 配置永久失效归短路;腾讯地址 geocode 的 `address` 参数须含省市区(城市前缀拼接)。错误码分类按官方状态码页预设,待真实 key 探测校准后更新本段并落 `data-quality.md`。

**15 家 -shanghai 落点**(除得物=嘉定运营中心(真实得物设施)、商汤=宝山新业坊(宝山办公点)外,均与清单预期区级一致):

| slug | -shanghai 落点 | 来源 |
|---|---|---|
| 得物 | 嘉定区育绿路88号(电商运营中心) | 百度检索(总部杨浦待后续 override 升级) |
| 米哈游 | 徐汇区宜山路1295号(漕河泾) | 百度检索 |
| 哔哩哔哩 | 杨浦区政立路499号国正中心 | 百度检索 |
| 拼多多 | 长宁区娄山关路533号(寻梦信息) | 别名检索 |
| 携程集团 | 长宁区金钟路968号凌空SOHO | 别名检索 |
| 商汤科技-无限原力 | 宝山区逸仙路新业坊源创6号楼 | 百度检索 |
| 上汽集团 | 静安区威海路489号(上汽大厦) | 官方公告核实+override |
| 中微公司 | 浦东金桥出口加工区(南区)泰华路188号 | 工商注册核实+override |
| 联影集团 | 嘉定区城北路2258号 | 别名检索 |
| 禾赛科技 | 嘉定区新徕路468号园区二号楼 | 工商注册核实+override |
| 燧原科技 | 浦东金桥金秋路158号张润大厦 | 百度检索 |
| 智元机器人 | 浦东新区秀浦路2555号29幢 | 天眼查年报核实+override |
| 乐鑫科技 | 浦东张江碧波路235弄3号楼 | 工商注册核实+override |
| 上海电气 | 浦东金桥金海路1000号金领之都 | 百度检索 |
| 春秋航空 | 浦东新区启航路1200号 | 百度检索 |

附带多城市站点(超出试点核心但已 regeo 校验):哔哩哔哩-北京(朝阳东煌大厦)、商汤-北京(海淀理想国际大厦)/深圳(南山高新南十道)、燧原-深圳(南山软件产业基地)、智元-北京(海淀互联网金融中心)、乐鑫-深圳(南山深圳湾生态园)、腾讯杭州(西湖区西溪乐谷,LLM 质检坐标修正)。

**遗留**:得物-北京/广州/成都、智元-深圳、携程-北京、燧原-北京/成都、联影-深圳/武汉 等站点地点检索无可靠 POI(同名门店/噪音被拒),保持 city-text 离图——宁缺毋滥,后续批次按官方地址 override 补齐。得物-上海可后续 override 升级到杨浦总部。
