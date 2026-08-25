# 公司官网/工商公开地址 → geocode overrides — 来源审查

**接入日期:** 2026-08-25
**数据文件:** `server/data/recruitment/geocode-overrides.json`(仅本次上海批次条目)
**方法:** WebSearch 定位来源页 → WebFetch 提取地址文本 → 高德 geocode v3(`geocodeAddressRest`,
AMAP_WEB_KEY, 5000 次/日配额, 不耗公司网关额度)→ 写入 overrides(`city` 字段 = 目标城市)。
**状态:** 3 个批次共 12 家(上海 194 站剩余中检索无解的知名公司;第 2/3 批为
券商/国企研究院, 检索命中弱但地址可从工商公开渠道确认)。

## 1. 合规纪律(本批次执行)

- 只写**办公/分公司经营地址**:官网联系页、上市公告、工商公开转载(分公司条目)。
- **注册地址不写**:工商"注册地址"常为园区注册格子间(实测: 网易(上海)网络有限公司
  注册地址 = 青浦区赵巷镇嘉松中路5399号3幢B8-4F-D区388室, 与实际办公地不符 → 不写)。
- 来源记录到具体 URL;坐标经高德 geocode v3 校验(非 POI 检索, 不耗网关/place 配额)。
- 不做任何登录/验证码绕过;仅公开网页礼貌 GET(WebFetch 单页)。

## 2. 批次清单(12 家)

| slug | 地址(写回 drops) | 来源类型 | 来源 URL |
|---|---|---|---|
| 58集团 | 徐汇区漕宝路1535号1号楼4层 | 工商公开转载(58集团上海徐汇分公司) | https://www.chinabyte.com/eclub/814.shtml |
| wind万得 | 浦东新区浦明路1500号万得大厦 | 上市公告(万得基金销售 办公地址) | http://static.cninfo.com.cn/finalpage/2020-04-21/1207546088.PDF |
| 中兴微电子 | 浦东新区碧波路889号中兴通讯大厦 | 官网联系页(英文) | https://www.sanechips.com.cn/en/lianxiwomenEn/index.html |
| nvidia英伟达 | 浦东新区张江纳贤路600号 | 新闻(2025-09 新办公楼, 16层 张江科学城) | https://www.chinastarmarket.cn/detail/2268670 |
| 中汇会计师事务所 | 浦东新区银城中路68号时代金融中心22层 | 官网上海分所页 | https://www.zhcpa.cn/index.php/about1/network/detail/15.html |
| dji大疆 | 闵行区紫星路588号(紫竹) | 工商公开转载(DJI 上海分公司) | https://shuidi.cn/company-ebb44c8cfaab892fc5b0392b56c41925.html |
| vivo | 浦东新区博霞路57号 | 高校就业网工商信息(艾酷软件=vivo 上海主体) | https://job.xidian.edu.cn/company/view/id/817978 |
| 中国银河证劵 | 浦东新区富城路99号震旦国际大楼31层 | 城市黄页(上海分公司) | https://sh.city8.com/financial/8dauq779557sbb7294 |
| 中国商飞公司 | 浦东新区世博大道1919号 | 高校就业网工商信息(中国商用飞机有限责任公司) | https://career.csu.edu.cn/company/view/id/504454 |
| 中国航空无线电电子研究所 | 闵行区桂平路432号 | 高校就业网工商信息 | http://career.csu.edu.cn/company/view/id/514423 |
| 中望软件 | 虹口区海伦路440号金融街海伦中心A座23层 | 工商公开转载(广州中望龙腾上海分公司) | https://www.dianhua.cn/dt/eccbc34ea9714892a0455b10b4ee8bb4/457a5e917744e39e1a2f177353897af8 |
| 中国电信天翼云 | 浦东新区秀沿西路189号中国电信信息园区25号楼 | 高校就业网工商信息(天翼云科技上海分部) | https://job.xidian.edu.cn/company/view/id/818771 |

(注: 表格列出 12 家 — 每条的 `city: "上海市"` 由
apply 的 override-city 闸门消费, 缺失即被默认杭州市误拒。)

## 3. 失败与拒绝记录(不写)

- 网易(上海): 仅青浦注册地址, 无办公地址确认 → 不写。
- 零跑汽车: 官网/新闻只写"上海虹桥核心区", 无街道地址 → 不写。
- 九坤投资: 启信宝/天眼查登录墙, city8 TLS 失败 → 不写。
- 上汽乘用车: 就业网模板未渲染地址 → 不写(百度 POI 检索有"上海汽车集团股份
  有限公司乘用车公司"嘉定安研路201号, 但独立来源未确认 → 不写)。
- OPPO: 百度百科 403; 上海分公司已注销 → 不写。
- 初速度/Momenta: 工商转载页登录墙/无地址 → 不写。
- 拓竹 Bambu Lab: 官网关联公司页无上海地址(只有深圳/广州等) → 不写。

## 4. 后续

- overrides 在下次 `geocode-sites-apply` 时按 slug 生效(manual-override, 不走检索,
  不耗网关额度); 之后 `import:seed:apply` 入库。
- 若需扩批: 按 §1 纪律对剩余知名公司继续; 注册地址一律不写。
