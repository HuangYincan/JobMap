# Deferred Notes — 20260823-boss-scan-fix-r2

来源:质量扫描 r2 `tech/roles/development/quality-scans/20260823-all-r2/scan-report.md`。以下项 boss 判定**需用户决策/Env-only/追踪**,本轮不派发。

## 需用户决策

| 时间 | 类型 | 内容 |
|---|---|---|
| 2026-08-23 | 数据口径 | #2(并入 r1 #9):**实锤 2 处**——embodied-jobs/embj-上海市交通大学.json(careerUrl postd.sjtu.edu.cn=上海交通大学)、embj-北京市大学.json(postdocs.pku.edu.cn=北京大学);**疑似 2 处**——qqdoc-jobs/qqj-北京润料.json(mokahr 租户 runketongyong=润科通用)、qqj-OCC欧晰折咨询.json(OC&C 官方中文=欧晰析)。改名影响已保存/投递引用,需旧 id 别名策略(016 site_key 作锚);疑似项人工核对 |
| 2026-08-23 | 其他 | #5:Nominatim UA 常量 `'DomainMap/1.0 (job-map contact)'` 不符合 OSM Usage Policy(要求可验证联系方式/URL);需用户提供真实联系邮箱/URL 常量后替换(代码侧值已定位 `server/src/lib/site-geocode.ts:1574`) |

## 追踪(不派,条件触发)

| 时间 | 类型 | 内容 |
|---|---|---|
| 2026-08-23 | 追踪 | #4(D-18):map-shell ~3055 行(较 r1 3210 略降),继续抽 hook(抽屉手势/账户编排);台账 D-18 行已由 ws-c 更新 |
| 2026-08-23 | 追踪 | #12(r1 #14):markdown-text.tsx data-navi 直赋 window.location.href——数据源已经 buildNaviWebUrl 校验,残余风险低,双保险改法待评估 |
| 2026-08-23 | 追踪 | #13(r1 #15):spatial-query city ILIKE 前置通配符无索引;数据量到万级后补 pg_trgm GIN(2026-08-23 companies 1040,未达触发线) |

## 用户操作(一行命令)

| 时间 | 类型 | 内容 |
|---|---|---|
| 2026-08-23 | 其他 | #10 遗留:`tech/26-agent-memory.md` 已重编号为 `tech/30-agent-memory.md`(索引/CHANGELOG/7 处代码注释均已指向 30),旧文件删除被权限分类器拒绝(boss 会话亦需显式授权)。用户确认后一行删除:`git rm tech/26-agent-memory.md`。当前旧文件为无引用孤儿,与 30 同内容并存,不阻塞任何功能 |

## 沿用 r1 deferred(不重派)

r1 `20260823-boss-scan-fix/deferred-notes.md`:数据改名与别名策略(r1 #9 证劵 13 文件)、#19 slug 合并口径、#16 robots 失败口径、#2 全局 OTP 发送预算数值、Env-only SESSION_SECRET 生产设值。
