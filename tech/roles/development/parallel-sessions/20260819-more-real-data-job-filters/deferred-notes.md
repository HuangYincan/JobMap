# Deferred Notes — 20260819-more-real-data-job-filters

> 需用户决策 / Env-only / 不自动执行的项,任务全部完成后统一告知。

## Env-only(合入后执行,执行结果记入总汇报)

1. **radar 沪杭公司批量 geocode 落点**(「沪杭公司少」的另一半解法):radar 630 家公司
   中上海 348 / 杭州 98,目前大多只有城市文本站点(无坐标,不上图)。`AMAP_WEB_KEY` 与
   `BAIDU_MAP_AK` 均已配置,`geocode-sites-apply.mjs` 已支持多城市(上海试点验证)。
   但批量落点有公司名歧义风险(同名不同实体),需要人工审批 override/exclude
   (现有 44 条 override 就是为此积累的)。待用户授权后执行:
   ```
   ! cd /Users/acccan/domain-map/server && set -a && source .env.local && set +a && npm run geocode:sites:apply -- --dry-run
   ```
   (先 dry-run 看计划,再 apply)
2. **import:seed:apply**:本批 feishu 新 drops 合入 dev 后,由用户运行:
   ```
   ! cd /Users/acccan/domain-map/server && set -a && source .env.local && set +a && npm run import:seed:apply
   ```

## 口径/决策

3. 本批 feishu 爬取只覆盖 **21 家沪杭优先租户**(探索发现共 53 个 feishu 租户,49 未爬)。
   其余 28 家 + mokahr(142 家)/zhiye(138 家)/hotjob(42 家)留后续批次(mokahr 需先评估
   WAF 风险,项目规则禁止绕过)。
4. 岗位筛选为纯本地视图过滤(不写全局 FilterState/sessionStorage),不联动地图 marker。
5. **2026-08-19 下午:geocode 已部分解锁(经 ATS address_list + 百度正逆地理编码 v3)**:
   - 发现飞书 ATS 岗位自带 `job_post_info.address_list`(区+路+门牌精确办公地址),
     不需要 place-search(配额已耗尽)也能打点 —— 用 5000 次/天的 geocoding v3;
   - 修复 province 缺失 bug(site 缺省浙江省 → 上海/北京地址被 regeo 误拒):
     `CITY_PROVINCE` 映射补齐 + 多城市文本('北京/上海')基座站点也走 ATS 地址填充;
   - **结果:21 个沪杭办公点落成**(波克普陀/莉莉丝徐汇/蔚来闵行+杭州上城/元气森林
     黄浦+杭州上城/小鹏浦东+杭州余杭/度小满金桥/影石中科路/游戏精酿普陀/轻舟闵行/
     锐石浦东/光轮嘉定/小马智行安亭/它石徐汇/MiniMax徐汇/Momenta浦东+杭州滨江),
     全部 regeo 区级验证通过,import 后 10533 真实岗位入 DB;
   - **仍待解决**(不影响本批):
     - **radar 沪杭公司批量落点**:630 家 radar 公司(上海 348/杭州 98)大多只有城市
       文本站点,需 place-search(百度地点检索 100 次/天,明日重置)+ 人工审批
       override/exclude(公司名歧义风险)。执行:
       ```
       ! cd /Users/acccan/domain-map/server && set -a && source .env.local && set +a && npm run geocode:sites:apply -- --cities 上海,杭州 --dry-run
       ```
     - 卡尔动力上海(ATS 无上海地址)、拓竹/国科长三角(manual-exclude)保持离图。
