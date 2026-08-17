// ============================================================
// 杭州高德 POI CSV 导入清洗(纯函数,可测试)
//
// 数据源:/Users/acccan/Downloads/杭州市/杭州市POI.csv
//   - 1,006,185 行,58 列,utf-8-sig BOM
//   - photos 是 python-repr 单引号:[{'url':'http://...','title':[...],'provider':[...]}]
//   - location 是 "lng,lat" 字符串(GCJ-02)
//   - biz_ext 是 python-repr 单引号 dict:{'rating':'4.4','cost':[...],...}
//   - rating/cost 列:真实数值或 '[]'(空)
//   - 无 reviewCount / reviews / website;biz_ext 无 open_time
//
// 清洗决策:
//   - photos → 仅提取 url 数组(丢弃 title/provider)
//   - rating/cost 仅取真实数值('[]'/空 → undefined)
//   - 必填缺失(poi_id/name/坐标/big_type/adname)→ 弃行返回 null
//   - 坐标:GCJ-02 存 lng_gcj/lat_gcj(展示零转换),WGS84 存参考列
//   - tier:按分类映射(0=地标永显 … 21=噪声永隐)
// ============================================================

export interface HzPoiRow {
  poi_id: string;
  name: string;
  address?: string;
  tel?: string;
  rating?: number;
  cost?: number;
  lngGcj: number;
  latGcj: number;
  lonWgs84: number;
  latWgs84: number;
  bigType: string;
  midType?: string;
  smallType?: string;
  typecode?: string;
  adname: string;
  businessArea?: string;
  photos: string[];
  openHours?: string;
  tier: number;
}

/** 杭州 GCJ-02 数据实际范围(经度 118.3556-120.7029,纬度 29.1954-30.5594)+ 边距 */
export const HANGZHOU_BBOX = { west: 118.3, south: 29.1, east: 120.8, north: 30.7 };

/**
 * 解析 python-repr 单引号 photos 列表 → url 数组。
 * 容错:空串/'[]'/畸形 → []。仅提取 url 值。
 */
export function parsePhotosUrlArray(photos: string): string[] {
  if (!photos) return [];
  const urls: string[] = [];
  // python-repr 的键也带单引号:'url':'http://...' → 键可带可不带引号
  const re = /['"]?url['"]?\s*:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(photos)) !== null) {
    if (m[1]) urls.push(m[1]);
  }
  return urls;
}

/**
 * 解析 "lng,lat" 字符串 → {lng, lat}。非法/越界 → null。
 * 兼容多余空白。
 */
export function splitLocation(loc: string): { lng: number; lat: number } | null {
  if (!loc) return null;
  const parts = loc.split(',');
  if (parts.length < 2) return null;
  const lng = Number.parseFloat(parts[0]);
  const lat = Number.parseFloat(parts[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { lng, lat };
}

/**
 * 解析 python-repr 单引号 dict → { rating?, cost?, openTime? }。
 * 容错:空/'{}'/畸形 → {}。rating/cost 仅取真实数值。
 */
export function parseBizExt(bizExt: string): {
  rating?: number;
  cost?: number;
  openTime?: string;
} {
  if (!bizExt) return {};
  const out: { rating?: number; cost?: number; openTime?: string } = {};
  // python-repr 的键也带单引号:'rating':'4.4' → 键可带可不带引号
  const ratingRe = /['"]?rating['"]?\s*:\s*['"]?([0-9.]+)['"]?/;
  const ratingMatch = bizExt.match(ratingRe);
  if (ratingMatch) {
    const v = Number.parseFloat(ratingMatch[1]);
    if (Number.isFinite(v)) out.rating = v;
  }
  const openRe = /['"]?open_time['"]?\s*:\s*'([^']+)'/;
  const openMatch = bizExt.match(openRe);
  if (openMatch) out.openTime = openMatch[1];
  return out;
}

/** 数值列清洗:真实数值才取,'[]'/空/畸形 → undefined */
function parseNumericCell(value: string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[]' || trimmed === '{}') return undefined;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 分类 → tier(可见最小 zoom)。语义:zoom >= tier 时显示;0=永显,21=永隐。
 * 与 work 模式 tier(tech/19)同构。
 */
export function tierForCategory(big: string, _mid?: string, _small?: string): number {
  switch (big) {
    case '风景名胜':
    case '科教文化服务':
      return 0; // 地标:全国也显
    case '政府机构及社会团体':
      return 2; // 省级显
    case '交通设施服务':
      return 3; // 城市显
    case '购物服务':
    case '公司企业':
      return 5; // ≈现有 core 集
    case '住宿服务':
    case '体育休闲服务':
    case '医疗保健服务':
    case '金融保险服务':
      return 8;
    case '生活服务':
      return 9;
    case '餐饮服务':
      return 10; // 长尾:放大才显
    case '商务住宅':
    case '汽车服务':
    case '汽车维修':
    case '汽车销售':
    case '摩托车服务':
    case '公共设施':
      return 11;
    case '室内设施':
      return 12;
    default:
      // 地名地址信息/通行设施/虚拟数据/道路附属设施/事件活动 等噪声 → 永隐
      return 21;
  }
}

/** 单行清洗:必填缺失/坐标非法 → null(弃行) */
export function cleanCsvRow(raw: Record<string, string>): HzPoiRow | null {
  const poiId = (raw.id || '').trim();
  const name = (raw.name || '').trim();
  if (!poiId || !name) return null;

  const gcj = splitLocation(raw.location || '');
  if (!gcj) return null;

  const lonWgs = Number.parseFloat(raw.lon_wgs84 || '');
  const latWgs = Number.parseFloat(raw.lat_wgs84 || '');
  if (!Number.isFinite(lonWgs) || !Number.isFinite(latWgs)) return null;

  const bigType = (raw.bigType || '').trim();
  const adname = (raw.adname || '').trim();
  if (!bigType || !adname) return null;

  const biz = parseBizExt(raw.biz_ext || '');
  const rating = parseNumericCell(raw.rating) ?? biz.rating;
  const cost = parseNumericCell(raw.cost);

  const photos = parsePhotosUrlArray(raw.photos || '');
  const mid = (raw.midType || '').trim() || undefined;
  const small = (raw.smallType || '').trim() || undefined;

  return {
    poi_id: poiId,
    name,
    address: (raw.address || '').trim() || undefined,
    tel: (raw.tel || '').trim() || undefined,
    rating,
    cost,
    lngGcj: gcj.lng,
    latGcj: gcj.lat,
    lonWgs84: lonWgs,
    latWgs84: latWgs,
    bigType,
    midType: mid,
    smallType: small,
    typecode: (raw.typecode || '').trim() || undefined,
    adname,
    businessArea: (raw.business_area || '').trim() || undefined,
    photos,
    openHours: biz.openTime,
    tier: tierForCategory(bigType, mid, small),
  };
}

/** 杭州判定:中心点是否落在杭州数据范围框内 */
export function inHangzhouBox(loc: { lng: number; lat: number }): boolean {
  const { west, south, east, north } = HANGZHOU_BBOX;
  return (
    loc.lng >= west && loc.lng <= east && loc.lat >= south && loc.lat <= north
  );
}
