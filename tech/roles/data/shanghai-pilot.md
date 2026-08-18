# 上海试点(shanghai-pilot)

> **Status:** 试点清单 + 坐标清除落地 2026-08-19;真实上海坐标待 boss 合并后 `geocode:sites:apply` 解析。
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
