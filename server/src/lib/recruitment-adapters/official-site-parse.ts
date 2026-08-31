// Pure helpers for extracting a company HQ city + street address from official
// site page text. No I/O, no fetch — unit-testable in isolation.
//
// Used by scripts/extract-qqdoc-addresses.mjs (polite crawl) to fill
// qqdoc-official drops: sites[0].city (full name, e.g. 长沙市) and
// sites[0].location.address. Companies whose name contains a known city
// (广州银行 → 广州市) get a factual city fallback when the crawl finds no
// address — the city-named bank HQ is always its namesake city.

export interface ExtractedAddress {
  /** 城市全称，如「长沙市」 */
  city: string;
  /** 省份全称，如「湖南省」 */
  province?: string;
  /** 街道地址，如「长沙市岳麓区XX路X号」；只有市级信息时缺省 */
  address?: string;
}

interface CityInfo {
  full: string;
  province: string;
}

/** 已知地级市/直辖市/重要县级市表（覆盖本数据集总部城市 + 省会）。 */
const CITY_TABLE: Record<string, CityInfo> = {
  北京: { full: '北京市', province: '北京市' },
  上海: { full: '上海市', province: '上海市' },
  天津: { full: '天津市', province: '天津市' },
  重庆: { full: '重庆市', province: '重庆市' },
  // 河北
  石家庄: { full: '石家庄市', province: '河北省' },
  唐山: { full: '唐山市', province: '河北省' },
  秦皇岛: { full: '秦皇岛市', province: '河北省' },
  邯郸: { full: '邯郸市', province: '河北省' },
  保定: { full: '保定市', province: '河北省' },
  廊坊: { full: '廊坊市', province: '河北省' },
  沧州: { full: '沧州市', province: '河北省' },
  // 山西
  太原: { full: '太原市', province: '山西省' },
  大同: { full: '大同市', province: '山西省' },
  长治: { full: '长治市', province: '山西省' },
  临汾: { full: '临汾市', province: '山西省' },
  // 内蒙古
  呼和浩特: { full: '呼和浩特市', province: '内蒙古自治区' },
  包头: { full: '包头市', province: '内蒙古自治区' },
  鄂尔多斯: { full: '鄂尔多斯市', province: '内蒙古自治区' },
  // 辽宁
  沈阳: { full: '沈阳市', province: '辽宁省' },
  大连: { full: '大连市', province: '辽宁省' },
  鞍山: { full: '鞍山市', province: '辽宁省' },
  抚顺: { full: '抚顺市', province: '辽宁省' },
  锦州: { full: '锦州市', province: '辽宁省' },
  营口: { full: '营口市', province: '辽宁省' },
  盘锦: { full: '盘锦市', province: '辽宁省' },
  // 吉林
  长春: { full: '长春市', province: '吉林省' },
  吉林: { full: '吉林市', province: '吉林省' },
  // 黑龙江
  哈尔滨: { full: '哈尔滨市', province: '黑龙江省' },
  大庆: { full: '大庆市', province: '黑龙江省' },
  齐齐哈尔: { full: '齐齐哈尔市', province: '黑龙江省' },
  // 江苏
  南京: { full: '南京市', province: '江苏省' },
  无锡: { full: '无锡市', province: '江苏省' },
  徐州: { full: '徐州市', province: '江苏省' },
  常州: { full: '常州市', province: '江苏省' },
  苏州: { full: '苏州市', province: '江苏省' },
  南通: { full: '南通市', province: '江苏省' },
  连云港: { full: '连云港市', province: '江苏省' },
  淮安: { full: '淮安市', province: '江苏省' },
  盐城: { full: '盐城市', province: '江苏省' },
  扬州: { full: '扬州市', province: '江苏省' },
  镇江: { full: '镇江市', province: '江苏省' },
  泰州: { full: '泰州市', province: '江苏省' },
  宿迁: { full: '宿迁市', province: '江苏省' },
  常熟: { full: '常熟市', province: '江苏省' },
  昆山: { full: '昆山市', province: '江苏省' },
  江阴: { full: '江阴市', province: '江苏省' },
  // 浙江
  杭州: { full: '杭州市', province: '浙江省' },
  宁波: { full: '宁波市', province: '浙江省' },
  温州: { full: '温州市', province: '浙江省' },
  嘉兴: { full: '嘉兴市', province: '浙江省' },
  湖州: { full: '湖州市', province: '浙江省' },
  绍兴: { full: '绍兴市', province: '浙江省' },
  金华: { full: '金华市', province: '浙江省' },
  义乌: { full: '义乌市', province: '浙江省' },
  衢州: { full: '衢州市', province: '浙江省' },
  舟山: { full: '舟山市', province: '浙江省' },
  台州: { full: '台州市', province: '浙江省' },
  丽水: { full: '丽水市', province: '浙江省' },
  // 安徽
  合肥: { full: '合肥市', province: '安徽省' },
  芜湖: { full: '芜湖市', province: '安徽省' },
  蚌埠: { full: '蚌埠市', province: '安徽省' },
  安庆: { full: '安庆市', province: '安徽省' },
  阜阳: { full: '阜阳市', province: '安徽省' },
  马鞍山: { full: '马鞍山市', province: '安徽省' },
  // 福建
  福州: { full: '福州市', province: '福建省' },
  厦门: { full: '厦门市', province: '福建省' },
  泉州: { full: '泉州市', province: '福建省' },
  漳州: { full: '漳州市', province: '福建省' },
  莆田: { full: '莆田市', province: '福建省' },
  宁德: { full: '宁德市', province: '福建省' },
  // 江西
  南昌: { full: '南昌市', province: '江西省' },
  九江: { full: '九江市', province: '江西省' },
  赣州: { full: '赣州市', province: '江西省' },
  上饶: { full: '上饶市', province: '江西省' },
  宜春: { full: '宜春市', province: '江西省' },
  景德镇: { full: '景德镇市', province: '江西省' },
  // 山东
  济南: { full: '济南市', province: '山东省' },
  青岛: { full: '青岛市', province: '山东省' },
  淄博: { full: '淄博市', province: '山东省' },
  烟台: { full: '烟台市', province: '山东省' },
  潍坊: { full: '潍坊市', province: '山东省' },
  济宁: { full: '济宁市', province: '山东省' },
  泰安: { full: '泰安市', province: '山东省' },
  威海: { full: '威海市', province: '山东省' },
  日照: { full: '日照市', province: '山东省' },
  临沂: { full: '临沂市', province: '山东省' },
  德州: { full: '德州市', province: '山东省' },
  聊城: { full: '聊城市', province: '山东省' },
  菏泽: { full: '菏泽市', province: '山东省' },
  // 河南
  郑州: { full: '郑州市', province: '河南省' },
  开封: { full: '开封市', province: '河南省' },
  洛阳: { full: '洛阳市', province: '河南省' },
  平顶山: { full: '平顶山市', province: '河南省' },
  安阳: { full: '安阳市', province: '河南省' },
  新乡: { full: '新乡市', province: '河南省' },
  焦作: { full: '焦作市', province: '河南省' },
  南阳: { full: '南阳市', province: '河南省' },
  商丘: { full: '商丘市', province: '河南省' },
  信阳: { full: '信阳市', province: '河南省' },
  周口: { full: '周口市', province: '河南省' },
  驻马店: { full: '驻马店市', province: '河南省' },
  // 湖北
  武汉: { full: '武汉市', province: '湖北省' },
  黄石: { full: '黄石市', province: '湖北省' },
  十堰: { full: '十堰市', province: '湖北省' },
  宜昌: { full: '宜昌市', province: '湖北省' },
  襄阳: { full: '襄阳市', province: '湖北省' },
  荆州: { full: '荆州市', province: '湖北省' },
  孝感: { full: '孝感市', province: '湖北省' },
  黄冈: { full: '黄冈市', province: '湖北省' },
  // 湖南
  长沙: { full: '长沙市', province: '湖南省' },
  株洲: { full: '株洲市', province: '湖南省' },
  湘潭: { full: '湘潭市', province: '湖南省' },
  衡阳: { full: '衡阳市', province: '湖南省' },
  岳阳: { full: '岳阳市', province: '湖南省' },
  常德: { full: '常德市', province: '湖南省' },
  益阳: { full: '益阳市', province: '湖南省' },
  郴州: { full: '郴州市', province: '湖南省' },
  // 广东
  广州: { full: '广州市', province: '广东省' },
  深圳: { full: '深圳市', province: '广东省' },
  珠海: { full: '珠海市', province: '广东省' },
  汕头: { full: '汕头市', province: '广东省' },
  佛山: { full: '佛山市', province: '广东省' },
  韶关: { full: '韶关市', province: '广东省' },
  惠州: { full: '惠州市', province: '广东省' },
  东莞: { full: '东莞市', province: '广东省' },
  中山: { full: '中山市', province: '广东省' },
  江门: { full: '江门市', province: '广东省' },
  阳江: { full: '阳江市', province: '广东省' },
  湛江: { full: '湛江市', province: '广东省' },
  茂名: { full: '茂名市', province: '广东省' },
  肇庆: { full: '肇庆市', province: '广东省' },
  清远: { full: '清远市', province: '广东省' },
  潮州: { full: '潮州市', province: '广东省' },
  揭阳: { full: '揭阳市', province: '广东省' },
  // 广西
  南宁: { full: '南宁市', province: '广西壮族自治区' },
  柳州: { full: '柳州市', province: '广西壮族自治区' },
  桂林: { full: '桂林市', province: '广西壮族自治区' },
  北海: { full: '北海市', province: '广西壮族自治区' },
  钦州: { full: '钦州市', province: '广西壮族自治区' },
  玉林: { full: '玉林市', province: '广西壮族自治区' },
  // 海南
  海口: { full: '海口市', province: '海南省' },
  三亚: { full: '三亚市', province: '海南省' },
  // 四川
  成都: { full: '成都市', province: '四川省' },
  自贡: { full: '自贡市', province: '四川省' },
  攀枝花: { full: '攀枝花市', province: '四川省' },
  泸州: { full: '泸州市', province: '四川省' },
  德阳: { full: '德阳市', province: '四川省' },
  绵阳: { full: '绵阳市', province: '四川省' },
  遂宁: { full: '遂宁市', province: '四川省' },
  内江: { full: '内江市', province: '四川省' },
  乐山: { full: '乐山市', province: '四川省' },
  南充: { full: '南充市', province: '四川省' },
  眉山: { full: '眉山市', province: '四川省' },
  宜宾: { full: '宜宾市', province: '四川省' },
  达州: { full: '达州市', province: '四川省' },
  // 贵州
  贵阳: { full: '贵阳市', province: '贵州省' },
  遵义: { full: '遵义市', province: '贵州省' },
  六盘水: { full: '六盘水市', province: '贵州省' },
  // 云南
  昆明: { full: '昆明市', province: '云南省' },
  曲靖: { full: '曲靖市', province: '云南省' },
  玉溪: { full: '玉溪市', province: '云南省' },
  丽江: { full: '丽江市', province: '云南省' },
  // 西藏
  拉萨: { full: '拉萨市', province: '西藏自治区' },
  // 陕西
  西安: { full: '西安市', province: '陕西省' },
  宝鸡: { full: '宝鸡市', province: '陕西省' },
  咸阳: { full: '咸阳市', province: '陕西省' },
  渭南: { full: '渭南市', province: '陕西省' },
  延安: { full: '延安市', province: '陕西省' },
  汉中: { full: '汉中市', province: '陕西省' },
  榆林: { full: '榆林市', province: '陕西省' },
  // 甘肃
  兰州: { full: '兰州市', province: '甘肃省' },
  天水: { full: '天水市', province: '甘肃省' },
  酒泉: { full: '酒泉市', province: '甘肃省' },
  白银: { full: '白银市', province: '甘肃省' },
  // 青海
  西宁: { full: '西宁市', province: '青海省' },
  // 宁夏
  银川: { full: '银川市', province: '宁夏回族自治区' },
  石嘴山: { full: '石嘴山市', province: '宁夏回族自治区' },
  // 新疆
  乌鲁木齐: { full: '乌鲁木齐市', province: '新疆维吾尔自治区' },
  克拉玛依: { full: '克拉玛依市', province: '新疆维吾尔自治区' },
  // 港澳
  香港: { full: '香港', province: '香港' },
  澳门: { full: '澳门', province: '澳门' },
};

/** 公司名 → 城市特例（名字本身不含城市或含歧义）。 */
const NAME_CITY_SPECIALS: Record<string, CityInfo> = {
  // 吉林银行总部在长春（吉林为省名兼市名，易歧义）。
  吉林银行: { full: '长春市', province: '吉林省' },
  // 区名公司 → 所属地级市。
  南海农商行: { full: '佛山市', province: '广东省' },
  顺德农商行: { full: '佛山市', province: '广东省' },
};

/** 知名区名 → 城市（无「市」字样、仅有区名时的兜底）。 */
const DISTRICT_CITY: Record<string, CityInfo> = {
  海淀区: { full: '北京市', province: '北京市' },
  朝阳区: { full: '北京市', province: '北京市' },
  西城区: { full: '北京市', province: '北京市' },
  东城区: { full: '北京市', province: '北京市' },
  丰台区: { full: '北京市', province: '北京市' },
  石景山区: { full: '北京市', province: '北京市' },
  浦东新区: { full: '上海市', province: '上海市' },
  徐汇区: { full: '上海市', province: '上海市' },
  静安区: { full: '上海市', province: '上海市' },
  黄浦区: { full: '上海市', province: '上海市' },
  天河区: { full: '广州市', province: '广东省' },
  越秀区: { full: '广州市', province: '广东省' },
  海珠区: { full: '广州市', province: '广东省' },
  南山区: { full: '深圳市', province: '广东省' },
  福田区: { full: '深圳市', province: '广东省' },
  罗湖区: { full: '深圳市', province: '广东省' },
  宝安区: { full: '深圳市', province: '广东省' },
  西湖区: { full: '杭州市', province: '浙江省' },
  拱墅区: { full: '杭州市', province: '浙江省' },
  岳麓区: { full: '长沙市', province: '湖南省' },
  武侯区: { full: '成都市', province: '四川省' },
  高新区: { full: '成都市', province: '四川省' },
};

function cityInfoOf(token: string): CityInfo | null {
  if (!token) return null;
  const bare = token.endsWith('市') ? token.slice(0, -1) : token;
  return CITY_TABLE[bare] ?? null;
}

/** 城市全称/裸名 → 省份全称 (上海市 → 上海市, 深圳市 → 广东省); 不认识 → null。
 * 2026-08-22 (fix/geocode-province-infer): site-geocode 的 siteCityTarget 在
 * province 字段为空时用它从 city 反查真实省。 */
export function cityProvinceOf(city: string): string | null {
  return cityInfoOf(city)?.province ?? null;
}

/** 公司名以已知城市开头 → 事实性城市（城商行总行必在同名城市）。 */
export function companyNameCity(companyName: string): ExtractedAddress | null {
  if (!companyName) return null;
  const special = NAME_CITY_SPECIALS[companyName];
  if (special) return { city: special.full, province: special.province };
  // 长名优先（避免「吉林」匹配到「吉」等前缀）。
  const names = Object.keys(CITY_TABLE).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (companyName.startsWith(name)) {
      const info = CITY_TABLE[name];
      return { city: info.full, province: info.province };
    }
  }
  return null;
}

const ADDRESS_LABEL_RE = /(?:总部|公司|办公|注册|企业|联系|单位)地址\s*[：:]\s*([^\s<>"']{4,160})/g;
const CITY_ROAD_RE =
  /([一-龥]{2,8}?(?:维吾尔自治区|壮族自治区|回族自治区|自治区|省))?\s*([一-龥]{2,12}?(?:市|自治州|地区))([一-龥]{1,12}?(?:区|县|市|旗))?([一-龥A-Za-z0-9]{2,80}?(?:路|街|大道|巷|环路|公路))[一-龥A-Za-z0-9号座栋层幢\-]{0,50}/g;

/** 从候选文本里解析城市（全称）。 */
function cityFromCandidate(candidate: string): ExtractedAddress | null {
  // 1) 省 + 市 或独立「X市」。
  const provinceRe = /([一-龥]{2,8}?(?:维吾尔自治区|壮族自治区|回族自治区|自治区|省))([一-龥]{2,12}?市)/;
  const pm = provinceRe.exec(candidate);
  if (pm) {
    const info = cityInfoOf(pm[2]);
    if (info) return { city: info.full, province: pm[1] || info.province };
  }
  const cityRe = /([一-龥]{2,12}?市)/g;
  for (const m of candidate.matchAll(cityRe)) {
    const info = cityInfoOf(m[1]);
    if (info) return { city: info.full, province: info.province };
  }
  // 2) 仅有区名。
  for (const district of Object.keys(DISTRICT_CITY)) {
    if (candidate.includes(district)) {
      const info = DISTRICT_CITY[district];
      return { city: info.full, province: info.province };
    }
  }
  return null;
}

/** HTML/文本 → 纯文本（去 script/style/标签/空白折叠）。 */
export function toPlainText(input: string): string {
  const withoutScripts = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ');
  return withoutScripts.trim();
}

function score(hit: ExtractedAddress): number {
  return (hit.city ? 4 : 0) + (hit.province ? 2 : 0) + (hit.address ? 4 : 0);
}

/**
 * 从页面文本提取总部城市 + 街道地址。找不到 → null（保持现状，不猜）。
 * 命中优先级：带标签的地址行 > 省市区+路街全文扫描；得分高者胜。
 *
 * 防伪: script/style 块必须能被完整剥离 (页面里残留 <script>/<style> 说明
 * 存在嵌入字符串骗过剥离 — WAF 挑战页/蜜罐脚本常把地址藏在 JS 里, 内容可能
 * 被转义损坏, 如 北京市阳区… 缺「朝」)。剥离不净 → 整页不采信, 返回 null。
 */
export function extractCityAndAddress(input: string): ExtractedAddress | null {
  // 防伪: script/style 块必须能被完整剥离。剥离后仍残留 <script>/<style>
  // 说明页面有嵌入字符串骗过剥离 (WAF 挑战页 / 蜜罐脚本常把地址藏在 JS 里,
  // 转义后内容可能损坏, 如 北京市阳区… 缺「朝」)—— 剥离不净 → 整页不采信。
  const stripped = input.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  if (/<script|<style|<\/script|<\/style/i.test(stripped)) return null;
  const text = toPlainText(stripped);
  if (!text) return null;
  let best: ExtractedAddress | null = null;

  // 1) 带标签地址行（「总部地址：」等）。
  for (const m of text.matchAll(ADDRESS_LABEL_RE)) {
    const value = m[1].trim();
    if (/http|@|电话|邮箱|邮编|传真/.test(value)) continue;
    const city = cityFromCandidate(value);
    if (!city) continue;
    const hit: ExtractedAddress = { ...city, address: value };
    if (!best || score(hit) > score(best)) best = hit;
  }

  // 2) 全文扫描 省市区 + 路/街。完整匹配 m[0] 含门牌号尾部（尾段是裸字符类，
  // 非捕获组）；address 用规整后的城市全称 + 城市之后的区/路/门牌部分。
  for (const m of text.matchAll(CITY_ROAD_RE)) {
    const provinceText = m[1];
    const cityToken = m[2];
    const info = cityInfoOf(cityToken);
    if (!info) continue;
    // indexOf/slice 必须用同一个字符串: m[0] 可能带 \s* 前缀空格,
    // 混用 trim 前后的下标会错位吃掉区名的首字 (北京市朝阳区 → 北京市阳区)。
    const trimmed = m[0].trim();
    const rest = trimmed.slice(trimmed.indexOf(cityToken) + cityToken.length);
    const hit: ExtractedAddress = {
      city: info.full,
      province: provinceText || info.province,
      address: `${info.full}${rest}`,
    };
    if (!best || score(hit) > score(best)) best = hit;
  }

  return best;
}

/** 把「北京市」式名称规整为表内全称；不认识返回原值。 */
export function normalizeCityName(raw: string): string | null {
  const info = cityInfoOf(raw.trim());
  return info ? info.full : null;
}
