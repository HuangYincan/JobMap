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
};

/**
 * 城市名归一 key:去「省/市/区」后缀成裸名(与 spatial-query.bareCityName 同规则,
 * 参考 spatial-query.ts:32-35),'北京市' / '北京' 归一成同一 '北京' 键。
 */
export function bareCityName(value: string): string {
  return value.replace(/[省市区]$/, '');
}

/** 查静态城市中心;命中返回中心坐标,未命中返回 undefined(调用方回退均值)。 */
export function cityCenter(city: string): { lng: number; lat: number } | undefined {
  const bare = bareCityName(city);
  return CITY_CENTERS[bare] ?? CITY_CENTERS[city];
}