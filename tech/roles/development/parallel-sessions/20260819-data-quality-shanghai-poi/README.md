# Batch 20260819-data-quality-shanghai-poi — Manifest

> 目标:数据质检+官网自动爬取(真实可信)、上海城市试点(北上广深/成都/武汉/苏州/宁波中的首个)、POI 按类加载、登录卡片小字、收藏图层启停 bug。

## 根因/现状摘要(Explore 已完成)

| 问题 | 现状 | file:line |
|---|---|---|
| 岗位多合一 | 630 radar 公司 761 岗位,700 聚合(92%);LLM 校验工具链已存在(validate-positions-llm.mjs,用户 LLM key 已配);聚合标记已贯通导入/读路径;JDs 全目录仅 4 条(群核手工) | data-quality.md;validation-report-20260817.json |
| 官网爬取 | html_jobs.py 只吃 JSON-LD/链接启发;SPA 空壳失败;官方许可路径 = per-ATS JSON 适配器。ATS 分布:mokahr 141(WAF 挡)、**zhiye.com 138(可抓)***、**feishu jobs 75(可抓)***、hotjob 32(可抓)*;*已实测 200 且存了样本 | html_jobs.py;data-sources.md:10 |
| 上海试点 | 397 家公司有 -shanghai 站点(城市文本,0 个真实上海坐标);33 家的 -shanghai 坐标是 fecef85 事故恢复时从杭州 office 复制的**错误坐标**;geocode 工具链已是城市级(上海市 regeo province 兜底已处理),仅 site-geocode.ts:60-66/153-155 DB 回退分支硬编码杭州 | data-quality.md:17;site-geocode.ts |
| POI 按类加载 | 分类下拉已存在(FilterPanel,big_type 9 值),纯客户端过滤;服务端 `categories` 参数**已通但客户端从不发送**;自动加载 = init load() + 视口 moveend replace loader | modes.ts:151-176;poi-service.ts:150-160;map-shell.tsx:749-1039 |
| 收藏图层 bug | 根因:ON toggle 里 `map.setBounds`(bbf1e91 引入)触发视口 replace loader → 空批次 `setCatalog([])` → 全部 marker 消失;OFF 本身无害(是 ON 之后的残局) | map-shell.tsx:1376-1398 / 906-1026 |
| 登录卡片小字 | auth-modal 手机/邮箱 tab 存在(OTP demo),无注册提示文案 | auth-modal.tsx |

## Workstream 表

| ws | 主题 | 分支 | 拥有 |
|---|---|---|---|
| w1 | POI 按类加载(默认不加载,选类全量加载当前视图) | feat/poi-category-loading | map-shell.tsx(749-1039 + 2128 接线)、poi-service.ts、viewport-search.ts、i18n、tests |
| w2 | 官网爬取:feishu jobs / hotjob / zhiye 适配器 + 数据质检工具 | feat/official-ats-adapters | crawler/app/domain_map_importer/(新适配器)、crawler/tests/、tech/roles/data/etl/ 文档 |
| w3 | 上海试点:候选公司策展 + 错误坐标修正 + geocode 城市化小修 | feat/shanghai-pilot-data | server/data/recruitment/radar/ 上海公司、geocode-overrides.json、site-geocode.ts、scripts/geocode-sites-apply.mjs、tests |
| w4 | 登录卡片「新用户将自动注册」小字 | feat/auth-auto-register-hint | auth-modal.tsx/module.css、i18n.ts |
| w5 | 收藏图层启停 bug | fix/saved-overlay-wipe | map-shell.tsx(1376-1398 + 1029 一行)、tests |

## 合并顺序

w4 → w5 → w2 → w3 → w1(小→大;w1 最后吃全部门禁)

## 同文件分区约定

- map-shell.tsx:w1(load/视口 loader 749-1039、filters 接线 2128)、w5(toggle 1376-1398 + onViewChange 1029 加一行抑制钩子)互不重叠。
- 上海错误坐标修正(w3)只动试点公司的 -shanghai 站点;非试点保持现状(口径问题见 deferred)。

## Post-merge boss 操作(Env-only,合并后执行)

1. `make crawl-official --write`(试点公司,走 w2 新适配器;礼貌限速)
2. `node scripts/validate-positions-llm.mjs`(LLM key 已配,全量质检报告)
3. `npm run geocode:sites:apply`(上海试点,AMap 配额;8/17 曾超日配额)
4. `npm run import:seed:apply` + 验证上海公司上地图

## 已存样本(fixtures/)

- `fixtures/feishu-nio.html`(nio.jobs.feishu.cn,200/179KB,SSR)
- `fixtures/zhiye-iflytek.html`(iflytek.zhiye.com,200/35KB,含「校园招聘」)
- `fixtures/hotjob-st.html`(hr.sensetime.com,200/12KB,Next.js 壳)
