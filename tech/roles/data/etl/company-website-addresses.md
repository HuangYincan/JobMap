# 公司官网/工商公开地址 → geocode overrides — 来源审查

**接入日期:** 2026-08-25
**数据文件:** `server/data/recruitment/geocode-overrides.json`
**方法:** WebSearch 定位来源页 → WebFetch 提取地址文本 → 高德 geocode v3(`geocodeAddressRest`,
AMAP_WEB_KEY, 5000 次/日配额, 不耗公司网关额度)→ 写入 overrides(`city` 字段 = 目标城市)。
**状态:** 上海 12 家 + 北京/深圳 14 家(大厂总部/上市公告级来源; 城市中心假坐标重跑
期间网关额度耗尽, 用官网/工商公开渠道补齐检索无解的大厂)。

## 1. 合规纪律(本批次执行)

- 只写**办公/分公司经营地址**:官网联系页、上市公告、工商公开转载(分公司条目)。
- **注册地址不写**:工商"注册地址"常为园区注册格子间(实测: 网易(上海)网络有限公司
  注册地址 = 青浦区赵巷镇嘉松中路5399号3幢B8-4F-D区388室, 与实际办公地不符 → 不写)。
- 来源记录到具体 URL;坐标经高德 geocode v3 校验(非 POI 检索, 不耗网关/place 配额)。
- 不做任何登录/验证码绕过;仅公开网页礼貌 GET(WebFetch 单页)。

## 2. 批次清单(28 家)

### 2a. 上海批次(12 家, `city: "上海市"`)

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

(注: 每条的 `city: "上海市"` 由 apply 的 override-city 闸门消费, 缺失即被默认杭州市误拒。)

### 2b. 北京批次(7 家, `city: "北京市"`)

| slug | 地址(写回 drops) | 来源类型 | 来源 URL |
|---|---|---|---|
| 京东 | 大兴区科创十一街18号院(亦庄总部) | 新闻(总部1号园区 DEF 座启用) | https://tech.ifeng.com/c/8bWtutDZT54 |
| 摩尔线程 | 朝阳区酒仙桥路6号电子城国际电子总部I区3号楼 | 上市公告(招股书 办公地址) | http://money.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?CompanyCode=82620734&gather=1&id=12484622 |
| 地平线 | 海淀区丰豪东路9号院2号楼 | 高校就业网工商信息(北京地平线信息技术有限公司) | http://career.csu.edu.cn/company/view/id/521475 |
| 快手 | 海淀区西二旗西路16号院12号楼 | 高校就业网工商信息(北京达佳互联) | https://myjob.dlmu.edu.cn/company/view/id/939080 |
| 小米 | 海淀区安宁庄路小米科技园 | 高校就业网工商信息(北京小米移动软件) | https://career.shiep.edu.cn/company/view/id/720021 |
| 美团longcat大模型 | 朝阳区望京东路4号院恒电大厦 | 地图标注(美团点评北京总部) | https://map.baidu.com/mobile/webapp/search/search/qt=s&wd=北京朝阳望京东路4号院恒电大厦BC座美团点评北京总部 |
| 联想 | 海淀区上地西路6号 | 联想官网 ESG 证书(ISO14001 地址) | https://www.lenovo.com/content/dam/lenovo/site-design/esg-document-library/global/corp-policies/iso-certs/iso14001/lenovo-iso-14001-certificate-cesi.pdf |

### 2c. 深圳批次(7 家, `city: "深圳市"`)

| slug | 地址(写回 drops) | 来源类型 | 来源 URL |
|---|---|---|---|
| 比亚迪 | 坪山区比亚迪路3009号六角大楼 | 高校就业网工商信息 | https://cqu.cqbys.com/company/view/id/700983 |
| 腾讯 | 南山区海天二路33号腾讯滨海大厦 | 行业协会参访通知(地址原文) | https://cmra.org.cn/m/newsshow.php?id=1014 |
| 招商银行 | 福田区深南大道7088号招商银行大厦 | 维基百科(大厦词条) | https://zh.wikipedia.org/wiki/%E6%8B%9B%E5%95%86%E9%93%B6%E8%A1%8C%E5%A4%A7%E5%8E%A6 |
| 迈瑞医疗 | 南山区高新技术产业园科技南十二路迈瑞大厦 | 上市公告(2025 年报 办公地址) | http://money.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?stockid=300760&id=12044611 |
| 荣耀honor | 福田区红荔西路8089号深业中城6号楼 | 高校就业网工商信息(荣耀终端) | https://career.hebut.edu.cn/company/index/id/11113.html |
| 华为ai | 龙岗区坂田街道华为总部基地 | 政府公开(龙岗区 华为总部基地) | https://www.lg.gov.cn/zjlg/qwlg/cy/kj/content/post_12861307.html |
| 传音控股-taig-ai顶尖 | 南山区西丽街道留仙大道传音大厦 | 上市公告(变更主要办公地址公告) | https://www.sohu.com/a/745178237_115433 |
| 正浩ecoflow | 宝安区福海街道福园一路润恒工业厂区 | 高校就业网工商信息 | https://career.shiep.edu.cn/company/view/id/722332 |
| 影石insta360 | 宝安区新安街道留仙三路1100号金利通金融中心 | 上市公告(公司概况) | https://vip.stock.finance.sina.com.cn/corp/go.php/vCI_CorpInfo/stockid/688775.phtml |

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

- overrides 在下次 `geocode-sites-apply` 时按 slug + city 生效(manual-override, 不走检索,
  不耗网关额度); 之后 `import:seed:apply` 入库。
- 操作提示(2026-08-25 实测): 高德 geocode v3 批量连发有 QPS 限流(连发 ~6 个后
  `empty`), 间隔 ≥800ms 稳定; 后续扩批按此节奏。
- 若需扩批: 按 §1 纪律对剩余知名公司继续; 注册地址一律不写。
