# ETL 来源记录 — qqdoc-official(腾讯文档官方招聘平台源)

- **日期**: 2026-08-21
- **来源**: 腾讯文档公开分享「27届秋招信息汇总(建议收藏,欢迎分享)」
  - URL: `https://docs.qq.com/smartsheet/DTkRMUVhoUWJXZEhJ?tab=tvVDZj&nlc=1&viewId=vmLdET`
  - **用户直接提供该链接**(授权采集),文档公开只读(匿名可查看)
- **采集方式**: 公开数据接口 `docs.qq.com/dop-api/get/sheet`(页面自身使用的只读端点,匿名 200,与浏览器请求一致;不登录、不绕过任何限制);smartsheet 负载经 base64+zlib 解码为 JSON
- **提取内容**: 「官方招聘平台汇总」tab 203 条(名称 + 官方招聘 URL);清洗后 144 家央企/银行/国企(排除省级人社/公务员考试网/第三方招聘平台/重复项)
- **质量评估**: 人工整理、每日更新(文档说明);与现有 catalog(682 家)重叠仅 7 家 → 新增 137 家,补齐金融/能源/制造/通信等行业的官方招聘渠道
- **后续提取**: 官网地址提取(worker 20260821-boss-qqdoc-official)—— 只礼貌 GET 公司官网(robots.txt 检查、≥500ms 间隔、UA 标识),不抓第三方招聘平台(wecruit.hotjob.cn / zhiye.com 等),不绕过反爬
- **产出**: `server/data/recruitment/qqdoc-official/*.json`(144 家,每公司一文件,含 official_url)
- **红线核对**: 不涉及 BOSS/牛客/小红书/实习僧抓取;不登录/验证码/限流绕过;来源为用户授权公开文档
