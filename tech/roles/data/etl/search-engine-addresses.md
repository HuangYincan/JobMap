# 搜索引擎地址源(百度/搜狗/360/必应 HTML 抓取)— 来源审查

> **Status:** reviewed — **not approved as a data source**(deferred exploration item)
> **Reviewed:** 2026-08-23(批次 `20260823-boss-poi-datasource` ws-d)
> **Owner:** product / data
> **Scope:** 用户手动探索的「用搜索引擎找公司真实办公地址」尝试(`.address-work/`),审查其作为正式数据源 / 自动抓取管线的合规与工程可行性。

## 探索物证(主工作树 `/.address-work/`,未入库)

用户为给无地址 / 城市中心假坐标公司找真实办公地址,手动用 curl 脚本探索了四家搜索引擎的 HTML 抓取路径。目录内容:

| 文件 | 内容 | 证据意义 |
|---|---|---|
| `fetch.py` | curl + Chrome UA 伪装、去标签提取正文的通用抓取器 | 脚本以浏览器 UA 请求(伪装) |
| `search360.py` | 360(`so.com`)+ 搜狗(`sogou.com`)SERP HTML 解析、跳转链接解析 | SERP 自动化解析尝试 |
| `bd1.html` | 百度 SERP 返回的**验证码跳转页**(`wappass.baidu.com/static/captcha/tuxing_v2.html`,带 backurl) | 实测命中验证码墙 |
| `sg1.html` / `sg_link1.html` | 搜狗 SERP 快照(查询例:「中国空间技术研究院 地址」)+ 跳转页 | 抓取成功,但页面含反爬机制(见下) |
| `so1.html` / `bing1.html` / `bing2.html` | 360 / 必应 SERP 快照 | 抓取成功样例 |
| `cj.txt` | libcurl cookie jar(`BAIDUID` / `BAIDUID_BFESS`) | cookie 持久化尝试 |

探索意图:为 drops 中无地址 / 中心钉点站点找真实办公地址(SERP 摘要 → 人工整理)。**未进入任何 import / geocode 管线,抓取代码未入库**(保持未跟踪;不提交)。

## 合规风险(逐源)

| 风险 | 证据 | 判定 |
|---|---|---|
| 验证码墙 | 百度实测返回验证码跳转页(`bd1.html` → wappass captcha) | **高**——百度已对自动化请求启用验证码;绕过需过验证码,违反「不绕过」红线 |
| 反爬 token / 风控 | 搜狗 SERP 注入 `/approve?uuid=…&token=…` beacon、`reventonCode` 校验、`cuid/ipsec` 字段(`sg1.html`) | **高**——引擎有明确反自动化风控,继续抓 = 对抗风控 |
| 条款禁止 | 各搜索引擎服务条款普遍禁止未经许可的自动化 SERP 抓取(未逐字核对各 ToS 版本,属通用认知,标注待实测确认) | **中高**——即便无验证码,自动化抓取 SERP 亦处于条款灰色/违规区 |
| UA 伪装 | `fetch.py` / `search360.py` 均以 Chrome UA 请求,隐藏 curl 身份 | **高**——伪装绕过爬虫识别,直接违反「不绕过」红线 |
| cookie 持久化 | `cj.txt` 保存百度 cookie 供复用 | **高**——绕过匿名/频控意图 |

## 审查结论:为何不作为正式数据源

1. **合规红线(硬性)**:项目规则「不得绕过登录、验证码、限流」。四源中百度已实测上验证码墙,搜狗有反爬风控;继续自动化 = 必须对抗验证码 / 伪装 / cookie 复用,全部踩线。
2. **工程上不可靠**:SERP 结构与风控随时变动(百度实测已断);解析即断,维护成本无限。
3. **数据质量不达标**:SERP 摘要是非结构化文本片段,无坐标、无结构化地址字段、无来源审计链;拿到文本后仍需 geocode,而 geocode 正是现有管线的能力。
4. **已有合规替代**:
   - 国内:AMap / 百度 / 腾讯 place 检索 API(结构化、带坐标、有配额契约与官方文档;即 r5 geocode 链,见 `tech/29-geocode-r5-status.md`);
   - 海外:OSM Nominatim(2026-08-23 批次 ws-b 集成,1 req/s + UA 标识政策,来源审查见同目录 ws-b 文档);
   - 无地址站兜底:geocode 链的「公司名 place-text 检索」通道(address-first,2026-08-21 批次)。

**判定:列为 deferred 探索项——不建自动管线,不进数据源清单。**

## 后续若使用的必要条件(全部满足才可重新评估)

1. **来源审查先行**:先完成逐源 ToS / robots / 条款核对(本文档为起点,注明「条款细节待实测核对」);
2. **限流**:≥1 秒/请求、低并发、总量不超人工频率,不连发;
3. **不绕过**:不求解验证码、不复用 cookie 绕过风控、不伪装 UA;遇到验证码 / 登录墙 / 风控页**立即停止**;
4. **定位**:仅作**人工抽查**(human-in-the-loop)与人工录入辅助,不自动入库;数据进入管线前须人工复核 + 记录来源;
5. **代码治理**:抓取脚本保持在工作树外 / 未跟踪(`.address-work/`),不提交仓库。

## 关联

- geocode 链与 r5 runbook:`tech/29-geocode-r5-status.md`
- 海外数据源审查(OSM Nominatim):`tech/roles/data/etl/`(2026-08-23 批次 ws-b 文档)
- 数据质量总账:`tech/roles/data/data-quality.md`
