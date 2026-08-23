// ============================================================
// GET /api/suggest — 搜索建议（Autocomplete）
//
// 遵循 tech/10-search-filter.md + tech/22-hangzhou-poi-local.md：
//   - work：匹配公司名、岗位标题、行业标签；返回建议 + 热门搜索
//   - domain：本地优先（hz_pois name 前缀匹配，adname 作 subtitle）；
//     本地 0 命中 / 无库 → 空列表，客户端回退高德 AutoComplete 一次
//   - center=lng,lat 可选：服务端算好每行 distance（米）
// 加固（quality-scan #10）：q 长度上限（超长 q 直接 400，防进全 catalog 匹配循环 + key 膨胀）。
// ============================================================

import { NextResponse } from 'next/server';
import { countPoisMatchingTag, matchKeyword, suggestSearchTags } from '@/lib/search';
import { loadServerCatalog } from '@/lib/server-catalog';
import { isRecruitmentMode, haversineDistance } from '@/lib/types';
import type { MapMode, RecruitmentPOI } from '@/lib/types';
import { loadHzPoiSuggestions } from '@/lib/hz-poi-store';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';
import { trendingForMode } from '@/lib/trending-search';

/** q 上限：与 /api/search 一致。超长 q 对 autocomplete 无意义，直接 400。 */
const MAX_Q_LENGTH = 100;
/** mode 是短枚举；center 只接受“lng,lat”两个十进制数。 */
const MAX_MODE_LENGTH = 32;
const MAX_CENTER_LENGTH = 128;

/** 解析可选 center=lng,lat。非法值返回 null(客户端自行按位置算距离)。 */
function parseCenter(raw: string | null): { lng: number; lat: number } | null {
  if (!raw) return null;
  const [lngStr, latStr] = raw.split(',');
  const lng = Number.parseFloat(lngStr ?? '');
  const lat = Number.parseFloat(latStr ?? '');
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawQ = url.searchParams.get('q') || '';
  const mode = (url.searchParams.get('mode') || 'work') as MapMode;
  const centerRaw = url.searchParams.get('center');
  if (
    rawQ.length > MAX_Q_LENGTH ||
    mode.length > MAX_MODE_LENGTH ||
    (centerRaw && centerRaw.length > MAX_CENTER_LENGTH)
  ) {
    return NextResponse.json(
      { code: 'PARAM_TOO_LARGE', message: 'one or more query parameters exceed their length limit' },
      { status: 400 }
    );
  }
  const q = rawQ.trim().toLowerCase();
  const center = parseCenter(centerRaw);
  const cacheKey = publicCacheKey(['suggest', mode, q]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const catalog = await loadServerCatalog(mode);
  const suggestions = [];

  if (q && isRecruitmentMode(mode)) {
    const work = catalog.filter((poi): poi is RecruitmentPOI => poi.kind === 'recruitment');
    for (const poi of work) {
      // 公司名匹配
      if (matchKeyword(poi.company.name, q)) {
        suggestions.push({
          type: 'poi',
          id: poi.id,
          title: poi.company.name,
          subtitle: poi.company.summary || poi.company.industries.join(' · '),
          icon: poi.company.logo || '🏢',
          location: poi.location,
          distance: center && poi.location ? haversineDistance(poi.location, center) : undefined,
        });
        continue; // 公司已匹配，避免重复推岗位
      }
      // 岗位标题匹配
      for (const pos of poi.positions) {
        if (matchKeyword(pos.title, q)) {
          suggestions.push({
            type: 'position',
            id: pos.id,
            title: `${poi.company.name} · ${pos.title}`,
            subtitle: pos.department ? `${pos.department} · ${pos.education || ''}` : undefined,
            icon: '💼',
            poiId: poi.id,
            location: poi.location,
            distance: center && poi.location ? haversineDistance(poi.location, center) : undefined,
          });
        }
      }
    }
    for (const tag of suggestSearchTags(q, 6)) {
      const count = countPoisMatchingTag(work, tag);
      suggestions.push({
        type: 'tag',
        id: tag.id,
        title: tag.title,
        subtitle: `${count} 个公司`,
        icon: '🏷️',
      });
    }
  } else if (q && mode === 'domain') {
    // 本地优先：hz_pois name 前缀匹配。无库/表缺失(null)或 0 命中 → 空列表，
    // 客户端回退高德 AutoComplete 一次（见 map-shell suggest effect）。
    const rows = await loadHzPoiSuggestions(q, 10);
    if (rows) {
      for (const row of rows) {
        const location = { lng: row.lng_gcj, lat: row.lat_gcj };
        suggestions.push({
          type: 'poi',
          id: row.poi_id,
          title: row.name,
          subtitle: row.adname,
          icon: '📍',
          location,
          distance: center ? haversineDistance(location, center) : undefined,
        });
      }
    }
  }

  const payload = {
    suggestions: suggestions.slice(0, 10),
    // Recent is account-scoped (`/api/me/search-history`). Do not invent a guest cloud list here.
    recentSearches: [],
    hotSearches: q ? [] : trendingForMode(mode).map((item) => item.query),
  };
  // 只在有建议时缓存：空结果被缓存会掩盖「0 命中→高德回退」信号，也符合
  // tech/22「回退不可伪装成成功 200」的约定。
  if (suggestions.length > 0) {
    writePublicCache(cacheKey, payload);
  }
  return NextResponse.json(payload, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
