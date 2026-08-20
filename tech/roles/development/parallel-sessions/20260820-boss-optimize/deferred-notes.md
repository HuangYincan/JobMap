# Deferred Notes — 20260820-boss-optimize

> 需用户决策 / Env-only / 数据口径的项。boss 不询问、不中断,任务完成后统一告知。
> 承接 2026-08-19 各批(dev @ e1ace57)的 13 项,按处理所需条件分 3 类;本批新增项追加在末尾。

## ① 需用户确认后执行(Env-only:要密钥/配额/动 DB)

> **2026-08-20 用户授权更新**:用户在目标消息中明示「高德api和百度api有一定限额,请你合理使用」。
> boss 判定:该授权覆盖「有界小量」API 使用(如跨城串味 147 行修正);全国规模 geocode(630 公司 drops)仍
> 属大额配额消耗,继续 deferred,执行前记录配额消耗。

| # | 项 | 内容 | 执行条件 |
|---|---|---|---|
| D-01 | 跨城串味数据修正 | DB 147 条「city=深圳/成都/北京/上海但坐标=杭州」company_sites 行(76 公司,914 岗位)。查询层已防御,真实外地 office 修正前不显示。 | 修 import provenance(本批代码)+ 重跑 plan-site-geocode / geocode-sites:apply(有界小量,用户已授权合理使用) |
| D-02 | icon 存量导入 | npm run import:seed:apply + bump MODE_CACHE_VERSION + audit:pins | 用户确认跑导入(本地 dev DB,随 D-01 一并做有界执行) |
| D-03 | 全国 radar 站点占位名 | 腾讯等「剩余岗位」占位名 + 无坐标(geocode 前过渡态) | 全国 geocode(大额配额,继续 deferred,待用户确认) |

## ② 需产品/口径决策(技术能改,但改法要人拍板)

| # | 项 | 现状 | 待决策点 |
|---|---|---|---|
| D-04 | 真实 OTP 发送 | 限流/尝试上限/过期清理已加固;demo 固定码 000000 + hint 回显仍在 | 何时接入真实 SMS/邮件发送、删除 demo hint(上线前必须) |
| D-05 | robots 失败策略 | 网络异常抓取时默认允许(acquire.py:143-152) | 「无 robots 允许(惯例)vs 网络异常拒绝(保守)」选哪边 |
| D-06 | 移动端抽屉覆盖 | 全开抽屉遮地图,顶部已「poi 地图条带」缓解 | 困扰与否,是否单开视觉改善批次(会动布局) |
| D-07 | docs #20 | 09-secondary-sidebar 420px 口径 | **✅ 2026-08-20 已解决(w4)**:代码 380px 佐证(8aa5be2/d161e03),b2-u1-u6 merge-report.md:42 + README.md:11 补注修正;tech/09 无需改 |
| D-08 | docs #23 | regression-fix 批次状态未在文档反映 | **✅ 2026-08-20 已确认(w4)**:批次 5/5 合入 dev(6dfcf1e),repo 无 in-flight 表述,无需改 |

## ③ 验收/待办(无阻塞,找时间做)

| # | 项 | 内容 |
|---|---|---|
| D-09 | 连续交互 marker 失步 | 生产构建下复验(承接 prev 批次) |
| D-10 | B3 聚合 Playwright 验收 | zoom≤8 徽章/点已改,补一次即可(本批任务 ① 修复后合并验收) |
| D-11 | favicon.im IP 域名覆盖 | 部分公司 logo 覆盖不足,ADR-007 已记(本批任务 ② 处理代码侧,剩余口径记此) |
| D-12 | 城市中心表覆盖面 | CITY_CENTERS 15 城,未知城市回退均值;可扩表或用 AMap 行政区中心(Env) |
| D-13 | 全国数据规模 | 更多城市真实公司/岗位(本批任务 ⑤ 做代码侧 + 有界数据,全国抓取口径待定) |

## 本批新增 deferred(2026-08-20 执行后)

| # | 类型 | 项 | 内容 |
|---|---|---|---|
| D-14 | Env-only | **geocode 串味修正被 AMap 配额阻塞** | 2026-08-20 dry-run 实证:AMap 今日配额耗尽(得物 19 站点 10×quota,Resolved 2/17);百度兜底未产出(原因待探针:key 状态或兜底逻辑,探针被权限分类器误拦,未验证)。恢复命令(配额重置后):`cd server && npm run geocode:sites:apply -- --cities 深圳,成都,北京,上海,广州,武汉`(6 城共 1611 站点需补点,含 147 串味行;--dry-run 先看计划)。**DB 侧串味行 105 条(沪29/京24/深22/蓉17/穗9/汉4,杭州 bbox)仍在,查询层+聚合层双防御已覆盖显示;坐标修正后需重跑 import:seed:apply 落库** |
| D-15 | Env-only | **DB 步骤部分完成** | ✅ Docker 根密码阻塞最终解除(daemon 起来,域内容器健康);✅ import:seed:apply 成功(672/1843/10533,0 dropped);✅ MODE_CACHE_VERSION 13→14(f1);✅ 贝达 DB 行验证通过(city=杭州,120.258/30.438,tier=6,数据层无问题);⏳ audit:pins 0/107 系配额假象(每 pin 2×AMap 调用),配额恢复后重跑 |
| D-16 | 验收 | **B3 聚合浏览器验收(D-10 续)** | 贝达 DB 行已验证 ✓;修复后预期:zoom≤8 成都徽章消失(串味剔除)、zoom≥6 杭州徽章含贝达(LOD 口径)。浏览器验收待 DB 数据就绪(已就绪)+ 应用可跑时做 |
| D-17 | 口径 | **百度兜底未生效疑点** | dry-run 中 Baidu 兜底未产出任何解析;需探针区分「百度 key/配额不可用」vs「兜底逻辑缺陷」。若为逻辑缺陷,后续 fix 批次处理(探针脚本在沙箱外执行,勿打印 key)。**另:audit-pin-locations.mjs 无百度兜底(仅 AMap key 路径),配额耗尽即全红,建议后续补兜底** |
| D-18 | 技术 | **plan-seed-import.mjs 不加载 .env.local** | 实测:该脚本不读 .env.local,import 需要 shell 显式 `DATABASE_URL`(geocode-sites-apply.mjs 自带 loadEnv 但 import 没有);CLAUDE.md「需 DATABASE_URL,读 server/.env.local」的表述与此不符。建议:给 plan-seed-import.mjs 补 loadEnv(10 行,参照 geocode 脚本),或改文档表述 |
