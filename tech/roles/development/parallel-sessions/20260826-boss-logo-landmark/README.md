# 批次 Manifest — 20260826-boss-logo-landmark(品牌 logo + 滨海大厦地标)

## 用户反馈

①「LOGO不对」—— 很多公司 logo 是通用占位(实为第三方招聘托管平台 favicon);
②「缺失深圳腾讯滨海大厦这种 POI」—— fan-out 已修(腾讯深圳存在),补地标识别。

## 根因(boss 已验证)

- logo:833 POI 中 822 走 favicon(careerUrl 解析);`*.mokahr.com` 140 家 / `*.jobs.feishu.cn` 100+ / `*.zhiye.com` / `hotjob.cn` 的平台默认 favicon 非公司品牌。大厂招聘子域 favicon 也未必是品牌 logo。DB 读路径 logo_url 大量 null(旧 import)。
- 腾讯深圳:数据存在(地址=滨海大厦),但 name/address 无「滨海大厦」字样,展示不可识别。

## Workstream

| ws | 分支 | worktree | 合并顺序 |
|---|---|---|---|
| l-logo | fix/brand-logo-landmark | /Users/acccan/dm-wt-l-logo | 1 |

门禁:`cd server && npm test` + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/l-logo.md。不 merge、不 push、不碰主树。

## 环境指引(boss 给用户,不属于代码)

- 重启 dev server(fan-out 在服务端,不重启不生效)→ 硬刷新浏览器(sessionStorage 缓存 v19 失效)。
- `npm run import:seed:apply`(Env-only,让 DB 有最新坐标+logo;腾讯元宝/腾讯音乐等 DB 坐标仍为占位)。

## final (2026-08-26)
- FINISHED — worker PASSED (1687 pass);merge `2b6d539` push origin/dev
- boss VERIFY: 主树 1689 tests/1686 pass/0 fail/3 skip;CI run 32922807681 success (64s)
- 品牌映射 49 家;腾讯深圳站 name=「腾讯·深圳(滨海大厦)」
- 遗留:用户需重启 dev server + 强刷验证;`npm run import:seed:apply` 同步 DB(Env-only)
