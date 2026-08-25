// ============================================================
// 静态城市中心表 — 聚合徽章锚点 + 下钻落点取「行政中心」而非 pin 均值
//
// 背景(tech/21 + ws-b):北京这类 20–40 个散落办公室的城市,pin 坐标
// 算术均值可能落在城郊甚至跨城,用户反映「聚合点不在市中心」。仓库无
// 城市中心静态表(唯一城市坐标都是杭州),DB 迁移无 city center 列,
// AMap geocode/regeo 又是 Env-only(要 key 调 REST),于是新增本静态表:
// 命中的城市用表中行政中心作徽章锚点,未命中回退组内均值(确定性不变)。
//
// 纯静态,无 AMap/Env 依赖,node 下可单测。
// ============================================================

/**
 * 海外城市中心(2026-08-21 补全, 有岗位公司海外站点可见性)。
 * 海外无 GCJ-02 偏移, 直接采用 WGS84 值(近似行政中心)。
 */
const OVERSEAS_CENTERS = {
  新加坡: { lng: 103.82, lat: 1.35 },
  洛杉矶: { lng: -118.24, lat: 34.05 },
  伦敦: { lng: -0.13, lat: 51.51 },
  东京: { lng: 139.69, lat: 35.69 },
  慕尼黑: { lng: 11.58, lat: 48.14 },
  吉隆坡: { lng: 101.69, lat: 3.14 },
  悉尼: { lng: 151.21, lat: -33.87 },
  纽约: { lng: -74.01, lat: 40.71 },
  旧金山: { lng: -122.42, lat: 37.77 },
  巴黎: { lng: 2.35, lat: 48.86 },
  柏林: { lng: 13.4, lat: 52.52 },
  首尔: { lng: 126.98, lat: 37.57 },
  曼谷: { lng: 100.5, lat: 13.76 },
  迪拜: { lng: 55.27, lat: 25.2 },
} as const;

/** 海外城市 key(供测试区分大陆/海外坐标范围)。 */
export const OVERSEAS_CITY_KEYS: ReadonlySet<string> = new Set(Object.keys(OVERSEAS_CENTERS));

/**
 * 城市中心坐标(key 为裸城市名,无「市/省」后缀,如 '北京' / '杭州'。
 * 取值大致为各市政府/市中心一带,约 0.01° 精度足够做 zoom 11 落点)。
 * 可按需补充公司数据出现过的城市。
 */
export const CITY_CENTERS: Record<string, { lng: number; lat: number }> = {
  北京市: { lng: 116.4, lat: 39.9 }, // 表内 key 与 regeo cityname「北京市」直接兼容(见 bareCityName)
  北京: { lng: 116.4, lat: 39.9 },
  上海: { lng: 121.47, lat: 31.23 },
  杭州: { lng: 120.15, lat: 30.27 },
  深圳: { lng: 114.06, lat: 22.55 },
  成都: { lng: 104.07, lat: 30.66 },
  广州: { lng: 113.26, lat: 23.13 },
  武汉: { lng: 114.3, lat: 30.59 },
  南京: { lng: 118.78, lat: 32.06 },
  苏州: { lng: 120.58, lat: 31.3 },
  西安: { lng: 108.94, lat: 34.34 },
  重庆: { lng: 106.55, lat: 29.56 },
  长沙: { lng: 112.94, lat: 28.23 },
  天津: { lng: 117.19, lat: 39.13 },
  青岛: { lng: 120.38, lat: 36.07 },
  厦门: { lng: 118.09, lat: 24.48 },
  // —— 2026-08-20 ws-w5 站点城市扩展: 以下为 server/data/recruitment 实际出现
  // site.city 且此前未收录的中国大陆站点城市(≥3 个站点), 取值同为行政中心一带。
  东莞: { lng: 113.75, lat: 23.02 },
  佛山: { lng: 113.12, lat: 23.02 },
  福州: { lng: 119.3, lat: 26.08 },
  合肥: { lng: 117.28, lat: 31.86 },
  湖州: { lng: 120.09, lat: 30.89 },
  金华: { lng: 119.65, lat: 29.08 },
  九江: { lng: 116, lat: 29.71 },
  宁波: { lng: 121.55, lat: 29.87 },
  南宁: { lng: 108.37, lat: 22.82 },
  石家庄: { lng: 114.51, lat: 38.04 },
  芜湖: { lng: 118.43, lat: 31.35 },
  肇庆: { lng: 112.47, lat: 23.05 },
  郑州: { lng: 113.62, lat: 34.75 },
  珠海: { lng: 113.57, lat: 22.27 },
  鄂尔多斯: { lng: 109.78, lat: 39.61 },
  // —— 2026-08-21 boss city-centers-extend w1: 残余站点补全 ——
  // 以下同样为 server/data/recruitment 实际出现的有岗位公司 site.city
  // (多城市拆分 / 单城市无坐标补中心点需要), 取值同为行政中心一带(≈0.01° 精度)。
  柳州: { lng: 109.41, lat: 24.32 },
  无锡: { lng: 120.31, lat: 31.49 },
  兰州: { lng: 103.83, lat: 36.06 },
  沈阳: { lng: 123.43, lat: 41.8 },
  大连: { lng: 121.61, lat: 38.91 },
  长春: { lng: 125.32, lat: 43.82 },
  哈尔滨: { lng: 126.63, lat: 45.75 },
  太原: { lng: 112.55, lat: 37.87 },
  南昌: { lng: 115.86, lat: 28.68 },
  贵阳: { lng: 106.63, lat: 26.65 },
  昆明: { lng: 102.83, lat: 24.88 },
  海口: { lng: 110.2, lat: 20.04 },
  乌鲁木齐: { lng: 87.62, lat: 43.83 },
  呼和浩特: { lng: 111.75, lat: 40.84 },
  银川: { lng: 106.23, lat: 38.49 },
  西宁: { lng: 101.78, lat: 36.62 },
  拉萨: { lng: 91.11, lat: 29.66 },
  济南: { lng: 117.0, lat: 36.65 },
  温州: { lng: 120.7, lat: 28.0 },
  嘉兴: { lng: 120.76, lat: 30.75 },
  绍兴: { lng: 120.58, lat: 30.0 },
  台州: { lng: 121.42, lat: 28.66 },
  泉州: { lng: 118.68, lat: 24.88 },
  烟台: { lng: 121.45, lat: 37.46 },
  潍坊: { lng: 119.16, lat: 36.71 },
  常州: { lng: 119.97, lat: 31.81 },
  徐州: { lng: 117.28, lat: 34.26 },
  扬州: { lng: 119.41, lat: 32.39 },
  南通: { lng: 120.89, lat: 31.98 },
  淄博: { lng: 118.05, lat: 36.81 },
  威海: { lng: 122.12, lat: 37.51 },
  临沂: { lng: 118.36, lat: 35.1 },
  洛阳: { lng: 112.45, lat: 34.62 },
  襄阳: { lng: 112.12, lat: 32.01 },
  宜昌: { lng: 111.29, lat: 30.69 },
  绵阳: { lng: 104.68, lat: 31.47 },
  泸州: { lng: 105.44, lat: 28.87 },
  株洲: { lng: 113.13, lat: 27.83 },
  湘潭: { lng: 112.94, lat: 27.83 },
  衡阳: { lng: 112.57, lat: 26.89 },
  赣州: { lng: 114.93, lat: 25.83 },
  ...OVERSEAS_CENTERS,
};

/** 省级前缀(省 / 自治区 / 直辖市 / 特别行政区;3 字前缀在前, 防短前缀先命中)。 */
const PROVINCE_PREFIXES = [
  '内蒙古', '黑龙江', '广西', '新疆', '西藏', '宁夏', '香港', '澳门',
  '河北', '山西', '辽宁', '吉林', '江苏', '浙江', '安徽', '福建', '江西',
  '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南',
  '陕西', '甘肃', '青海', '台湾', '北京', '上海', '天津', '重庆',
] as const;

/**
 * 剥「省+城市」连写前缀(「广西柳州」→「柳州」): 仅当余部命中已知城市才剥,
 * 防误伤(「吉林」既是省也是城市名, 纯省名不剥)。「河南省洛阳」式带省字
 * 的连写也支持(剥前缀后再剥衔接的「省」与尾部「省/市/区」)。
 */
function stripProvincePrefix(value: string): string | null {
  for (const p of PROVINCE_PREFIXES) {
    if (value === p) continue; // 纯省名不剥
    if (value.startsWith(p)) {
      const rest = value.slice(p.length).replace(/^省/, '').replace(/[省市区]$/, '');
      if (rest && CITY_CENTERS[rest]) return rest;
    }
  }
  return null;
}

/**
 * 城市名归一 key:去「省/市/区」后缀成裸名(与 spatial-query.bareCityName 同规则,
 * 参考 spatial-query.ts:32-35),'北京市' / '北京' 归一成同一 '北京' 键;
 * 另剥「省+城市」连写前缀(「广西柳州」→「柳州」, 2026-08-21 补全,
 * 东风柳汽类公司 site.city 带省前缀, 尾部「州」不被「市」规则剥离)。
 */
export function bareCityName(value: string): string {
  const bare = value.replace(/[省市区]$/, '');
  return stripProvincePrefix(bare) ?? bare;
}

/** 查静态城市中心;命中返回中心坐标,未命中返回 undefined(调用方回退均值)。 */
export function cityCenter(city: string): { lng: number; lat: number } | undefined {
  const bare = bareCityName(city);
  return CITY_CENTERS[bare] ?? CITY_CENTERS[city];
}

/**
 * 城市中心钉判定容差(度)。≈0.0005° ≈ 55m,足以覆盖 city-centers 批次
 * 钉入的精确中心坐标,又不会误伤市中心真实办公(距市政府 55m 内的
 * 办公实体几乎不存在)。与 site-geocode.ts 的 CITY_CENTER_EPS 同值。
 */
export const CITY_CENTER_EPS = 0.0005;

/**
 * 坐标是否命中任意静态城市中心(±CITY_CENTER_EPS) — 「城市中心钉」判定。
 * 城市中心钉 = 站点无真实办公坐标、由 city-centers 批次钉在行政中心;
 * 读路径用它把「位置未知」的站点排除在展示外(2026-08-25,
 * fix/hide-center-pins),避免地图在市中心堆出假办公点。
 */
export function isCityCenterPin(lng: number, lat: number): boolean {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  for (const center of Object.values(CITY_CENTERS)) {
    if (Math.abs(lng - center.lng) <= CITY_CENTER_EPS && Math.abs(lat - center.lat) <= CITY_CENTER_EPS) {
      return true;
    }
  }
  return false;
}