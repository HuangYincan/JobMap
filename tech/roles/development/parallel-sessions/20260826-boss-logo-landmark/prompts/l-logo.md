# Workstream l-logo — 知名大厂品牌 logo 映射 + 腾讯深圳「滨海大厦」地标

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-l-logo`,分支 `fix/brand-logo-landmark`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(boss 已验证,用户反馈)

**用户反馈**:①「很多公司 logo 都是通用占位」;②「缺失深圳腾讯滨海大厦这种 POI」(已由 fan-out 修复 + DB 读路径确认腾讯深圳存在,地址=滨海大厦;但展示识别不强)。

**根因(logo 占位)**:833 个 POI 中 822 个 logo 走 favicon(从 careerUrl 解析)。而大量 careerUrl 是**第三方招聘托管平台**:`*.mokahr.com`(140 家)/ `*.jobs.feishu.cn`(100+)/ `*.zhiye.com` / `wecruit.hotjob.cn` —— 这些平台的 favicon 是**平台默认图标**,非公司品牌。大厂自有招聘域(join.qq.com / jobs.bytedance.com 等)favicon 也未必是品牌主 logo。DB 读路径里大量 company.logo_url 为 null(旧 import)。

**logo 解析链**(`server/src/lib/company-logo.ts` `resolveCompanyLogo`,离线 `logoForSite` 与 DB 读路径 `resolveDbCompanyLogo` 共用):
siteLogoUrl → site 域名映射(favicon)→ companyLogoUrl → company 域名映射 → company favicon → emoji 🏢。
`DOMAIN_LOGO_MAP`(裸 IP → 官方域名)已有先例;但**没有「公司名 → 品牌官网」映射**,且 resolveCompanyLogo 不接收公司名。

## 任务

### 1. 品牌 logo 映射 — `server/src/lib/company-logo.ts`

- 新增 `BRAND_LOGO_MAP: Readonly<Record<string, string>>`(公司名 → 品牌官网 host,如 `'腾讯': 'www.tencent.com'`),覆盖数据里出现的**知名大厂**(建议至少:腾讯/阿里巴巴/字节跳动/美团/百度/网易/京东/小米/华为/蚂蚁集团/滴滴/快手/拼多多/哔哩哔哩/携程/小红书/得物/蔚来/理想/小鹏/极氪/大疆/商汤/地平线/寒武纪/中兴/比亚迪/宁德时代/特斯拉/苹果/微软/亚马逊/谷歌/英伟达 等——先 `node --experimental-strip-types -e "import {loadOfflineWorkCatalog} from './src/lib/server-catalog.ts'"` 列出 `p.name` 全集,只收录**实际存在**的公司名,别造表)。
- `resolveCompanyLogo` 增加可选入参 `companyName?: string`(兼容现有调用:不传 = 行为不变)。
- 解析链插入品牌映射:在 company favicon 之前(`companyFavicon` 之前)查 `BRAND_LOGO_MAP[companyName]` → 命中则 `faviconFromUrl('https://<host>/')`(source 记 `'company'`,注释说明是品牌映射)。site 层不插(站点可能不是主品牌)。
- 调用处传 companyName:
  - `server/src/lib/recruitment-source.ts` `logoForSite(company, site)` → resolveCompanyLogo 加 `companyName: company.name`。
  - `server/src/lib/recruitment-store.ts` `resolveDbCompanyLogo(company, site)` → resolveCompanyLogo 加 `companyName: company.name`(先读该函数确认入参形状)。

### 2. 腾讯深圳地标(数据,1 处)

- `server/data/recruitment/radar/腾讯.json`:深圳站(`id: 腾讯-site-shenzhen`)的 `name` 改为「腾讯·深圳(滨海大厦)」或 `location.address` 补「(腾讯滨海大厦)」—— 你判断哪个更利于搜索与展示(搜索匹配 name+address,参考 search.ts 口径),在汇报说明。只改这一个站,别动其它站。

### 3. 测试

- `server/tests/company-logo.test.mjs`(或既有 logo 测试):品牌命中(公司名 → favicon 指向品牌官网 host)、未命中(回退 favicon/emoji)、不传 companyName(行为不变)。
- 若有 recruitment-source/recruitment-store 的 logo 相关既有用例,同步补 companyName 传入断言。

### 4. 文档

- `tech/` 下 logo 相关文档(tech/06-decisions.md ADR-007 附近或 company-logo 说明)补一句:品牌映射表(公司名 → 官网 host,favicon 品牌化,2026-08-26 fix/brand-logo-landmark);第三方招聘托管平台(mokahr/feishu/zhiye)无品牌映射者维持平台 favicon。

### 5. 门禁(必须真跑)

```bash
cd /Users/acccan/dm-wt-l-logo/server && npm test
cd /Users/acccan/dm-wt-l-logo/server && npm run typecheck
cd /Users/acccan/dm-wt-l-logo && make docs-check && git diff --check
```

> 附带验收(worktree 内,汇报给数字):`resolveCompanyLogo` 对腾讯/字节/阿里等品牌命中后 favicon URL;腾讯深圳 POI 的 site.name/address 新值。

## 文件边界

**拥有**:`server/src/lib/company-logo.ts`、`server/src/lib/recruitment-source.ts`(仅 logoForSite 调用处)、`server/src/lib/recruitment-store.ts`(仅 resolveDbCompanyLogo 调用处)、`server/data/recruitment/radar/腾讯.json`(仅深圳站)、`server/tests/company-logo.test.mjs`(按需)、tech 文档。

**不碰**:其它数据文件、crawler/**、`src/lib/{city-cluster,spatial-query,server-catalog,mode-cache}.ts` 逻辑、components/hooks、`.env*`、主树。

## 提交

Conventional Commits(`feat(logo): 品牌 logo 映射 — 知名大厂 favicon 指向品牌官网`、`fix(data): 腾讯深圳站补滨海大厦地标`、`test(logo): 品牌命中/回退用例`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260826-boss-logo-landmark/reports/l-logo.md`,含改动摘要、品牌表覆盖数、验收数字、门禁结果、结论。末两行:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
