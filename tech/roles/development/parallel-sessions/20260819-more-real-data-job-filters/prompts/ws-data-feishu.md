# WS: ws-data-feishu — 21 家沪杭优先飞书租户批量爬取

> 你是 boss 派发的 headless 开发 worker。在预建 worktree **`/Users/acccan/dm-wt-ws-data-feishu`**
> 内完成本 workstream,**不要 merge/push**,完成后写汇报到
> `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-more-real-data-job-filters/reports/ws-data-feishu.md`。

## 背景

飞书 ATS 公开端点已解锁(2026-08-19 bundle 分析 + 得物/智元/禾赛端到端验证):

```
POST https://<host>/api/v1/search/job/posts?<query 镜像 body>
headers: website-path: <site_id>(可选,校招池;缺省=社招池)
         portal-channel: saas-career, portal-platform: pc
         User-Agent: 浏览器 UA(爬虫 UA 一律 405!)
body: {"keyword":"","limit":50,"offset":0,"job_category_id_list":[],"tag_id_list":[],
       "location_code_list":[],"subject_id_list":[],"recruitment_id_list":[],
       "portal_type":6,"job_function_id_list":[],"storefront_id_list":[],
       "portal_entrance":1}
→ {"code":0,"data":{"job_post_list":[{id,title,description,requirement,city_list,
   recruit_type:{name,parent:{name}}}],"count":N}}
```

适配器已就绪:`crawler/app/domain_map_importer/ats_feishu.py`(真实端点 + portal-feishu-* 外部 id + 城市落点 + 北揽→北京归一)+ `cli.py feishu` 子命令(租户配置 `FEISHU_TENANTS`,继承 radar curated 站点,岗位按城市落 site)。

## 任务

### 1. 扩展 `FEISHU_TENANTS`(crawler/app/domain_map_importer/cli.py)

把以下 21 家加入 `FEISHU_TENANTS`(保持既有 3 家在列表内)。每家字段:
`host / slug / name / industries / scale / tier / category / careerUrl / radarBase`。
**tier、category、industries、scale 从对应 radar drop 文件读取**(`server/data/recruitment/radar/<radarBase>.json`,radarBase 即文件名)。careerUrl 用 radar drop 的 careerUrl。

| host | slug(radarBase) | 城市 |
|---|---|---|
| lilithgames.jobs.feishu.cn | 莉莉丝游戏 | 上海 |
| boke.jobs.feishu.cn | 波克 | 上海 |
| arashivision.jobs.feishu.cn | 影石Insta360 | 上海/深圳 |
| anker-in.jobs.feishu.cn | 安克创新 | 北京/深圳/杭州/上海 |
| bambulab.jobs.feishu.cn | 拓竹科技 | 北京/上海/深圳/杭州 |
| k11pnjpvz1.jobs.feishu.cn | 元气森林 | 北京/上海 |
| momenta.jobs.feishu.cn | Momenta | 北京/上海/广州/深圳 |
| nio.jobs.feishu.cn | 蔚来 | 北京/上海/深圳/武汉 |
| xiaopeng.jobs.feishu.cn | 小鹏集团 | 北京/上海/广州/深圳 |
| vrfi1sk8a0.jobs.feishu.cn | MiniMax | 北京/上海 |
| duxiaoman.jobs.feishu.cn | 度小满 | 北京 |
| leadrive.jobs.feishu.cn | 臻驱科技 | 上海/杭州 |
| tarsrobot.jobs.feishu.cn | 它石智航 | 上海 |
| gamealestudio.jobs.feishu.cn | 游戏精酿 | 上海 |
| radrocktech.jobs.feishu.cn | 锐石创芯 | 上海/深圳/成都 |
| kargobot.jobs.feishu.cn | 卡尔动力 | 北京/上海 |
| lightwheel.jobs.feishu.cn | 光轮智能 | 北京/上海 |
| ponyai.jobs.feishu.cn | 小马智行 | 北京/广州 |
| qcraft.jobs.feishu.cn | 轻舟智航 | 北京/上海 |
| n0kwkp76gi.jobs.feishu.cn | 国科长三角资本 | 北京/杭州 |
| r3c0qt6yjw.jobs.feishu.cn | 新石器 | 北京/上海/成都/杭州 |

**website_path(校招池 site id)解析**:radar drop 的 careerUrl 含 `/{数字}/` 路径时
(如 `https://agirobot.jobs.feishu.cn/946993/`)取该数字段;是短链(`/s/...`)或 `/{id}/m/`
时同样尝试取第一段数字。解析不出则留空(只爬社招池)。**不要为了解析 site id 而请求
任何带 token 的分享链接**(短链如 `/s/xxx` 不带 token 可以直接 GET 看重定向,但不要
使用分享 token)。

### 2. 全量爬取并产出 drops

```
cd /Users/acccan/dm-wt-ws-data-feishu/crawler
PYTHONPATH=app python3 -m domain_map_importer.cli feishu \
  --out-dir ../server/data/recruitment/official-career \
  --radar-dir ../server/data/recruitment/radar \
  --interval 2 --max-jobs 1500 --write
```

- 先跑一次不带 `--write`(dry-run)看每租户 jobs 数,确认无大面积失败后再 `--write`。
- 单个租户失败(非 JSON / HTTP 错误 / blocked)可接受:记录 error,其余继续,不要重试激进。
- 若某租户 website_path 解析成功但校招池为空(0 岗),保留默认池结果即可。
- **礼貌红线**:间隔 ≥2s;绝不带 cookie/登录态;遇到验证码/429/403 立即放弃该租户;
  不重试、不绕 UA 之外的任何防护(浏览器 UA 已由适配器内置)。

### 3. 数据质量验证(门禁)

1. `cd crawler && PYTHONPATH=app python3 -m unittest discover -s tests -q` 全绿。
2. `cd /Users/acccan/dm-wt-ws-data-feishu/server && node --experimental-strip-types --no-warnings scripts/plan-seed-import.mjs` →
   0 issues / 0 dropped(输出格式 `{companies, sites, positions, dropped, issues}`)。
3. 抽查:每个新增 drop 打开检查——positions 全部 `portal-feishu-*` 前缀、大部分带
   description、sites 保留 radar 的 curated 坐标(有 lng/lat 的站点数量不变)。
4. 记录每家:jobs 总数 / 校招池数 / 社招池数 / 站点数,写进汇报。

### 4. 提交

Conventional Commits,小步提交(如:先 `feat(crawler): extend FEISHU_TENANTS with 21 tenants`,
再 `feat(data): crawl <N> feishu tenants -> official drops`)。**不要 merge/push**。

## 遇到问题

技术问题自裁(如某租户需要特殊处理);「无法解析的租户」「需要登录的租户」记入汇报的
「遇到的问题」段。

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-more-real-data-job-filters/reports/ws-data-feishu.md`:
- 每家租户一行:host → jobs(campus/social)/sites/drop 文件
- 门禁结果
- 遇到的问题
末两行必须精确:
```
门禁: PASSED
结论: OK
```
