# Deferred Notes — 20260819-data-quality-shanghai-poi

> 需用户决策 / 口径确认 / 不自动执行的项,任务全部完成后统一告知。

## Env-only(boss 合并后执行,执行结果记入总汇报)

1. **试点爬取** ✅ 已执行(boss 直接跑 pilot crawl,礼貌限速):拼多多/中微/燧原经 HTML 启发式各获 +1 聚合职位(仅作证据,未合入 drops——与 radar 聚合行同质量问题);3 家飞书 ATS 公司(得物/智元/禾赛)报 `non-JSON response body`。
2. **LLM 全量质检** ✅ 已执行(2026-08-19,deepseek-v4-flash):816 岗位 通过 90 / 警告 719 / 失败 7 / 错误 0;报告 `tech/roles/data/validation-report-20260819.json`。失败 7 条:6 条为门户入口式标题(人才计划/训练营,已知聚合语义);1 条为真实坐标 bug(**tencent-hangzhou 钉在网易地址**)——已修复并推送 `e3e1934`。
3. **上海 geocode** ✅ 已执行(2026-08-19,用户提供 BAIDU_MAP_AK):15/15 家 -shanghai 站点全部落真实上海办公点。路径:AMap place-text(10044)→ 百度地点检索(免费 100 次/天耗尽)→ 官方地址核实(上市公告/工商注册/年报)+ 百度正逆地理编码 v3(配额 0%)→ 城市门控 override。**经验:百度地点检索免费配额极小(100 次/天),主路径应优先地址 geocode v3。**
4. **`import:seed:apply`** ⏳ 待用户授权:DB 当前与 drops 有差异——pilot 公司 -shanghai 等站点坐标、tencent-hangzhou 坐标修正均未同步到 DB;授权后执行并验证上海公司上地图。

## 口径/决策

5. **非试点公司的杭州复制坐标保留现状**(fecef85 恢复的「全站点=杭州 office」语义与事故前一致,移动地图显示为杭州 pin);全量多城市 geocode 是后续里程碑,到时统一修正。
6. **聚合行全量拆解**(700 条)仍为后续 B2 里程碑;本批交付官网真实数据获取能力 + 试点样例,聚合行维持「汇总岗位」诚实展示。LLM 报告已含 694 条 `suggestedSplit`(拆解可直接基于此报告),如:4399「策划、技术、美术、运营、职能」→ 5 个具体岗位。
7. **苏州/宁波/成都/武汉/广深**等城市的真实数据拓展:上海试点验证通过后再排期。
8. ~~w5 方案 B 提示~~ 已随 w5 合入(方案 A,无此条)。

## 待办(用户侧验收)

9. POI 按类加载行为验收:默认无 POI → 选「餐饮服务」→ 当前视图全量加载 → 换类重载 → 平移按新视图重拉。
10. 收藏图层启停不再清空 POI;上海试点公司(geocode 后)以真实上海办公室显示在地图上。
11. **飞书 ATS 真实 JD 路径缺口** ✅ 已解锁(2026-08-19):旧 `/api/v1/search_job` 是猎头平台 catch-all(假端点)。JS bundle 分析(模块 60877)逆向出真实端点 `POST /api/v1/search/job/posts`(query+body,`website-path` 头选校招池,`_signature` 可省略,浏览器 UA 必需)。三家全量爬取完成:得物 155 校招+585 社招 / 智元 52+928 / 禾赛 54+137;`cli.py feishu --write` 产出 official-career drops(`portal-feishu-*` 真实 JD);详情见 `tech/roles/data/etl/feishu-ats.md`。数据策略:公司有 portal-* 岗位时抑制其 radar-* 聚合行(`suppressRadarForPortalCompanies`)。
