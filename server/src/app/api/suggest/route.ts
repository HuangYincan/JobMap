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
import { suggestSearchTags } from '@/lib/search';
import {
  countWorkTagMatchesBatchFromDb,
  loadWorkSuggestionsFromDb,
} from '@/lib/recruitment-store';
import { isRecruitmentMode, haversineDistance, type MapMode } from '@/lib/types';
import { loadHzPoiSuggestions } from '@/lib/hz-poi-store';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';
import { trendingForMode } from '@/lib/trending-search';
import { parseKnownMode } from '@/lib/modes';

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
  const rawMode = url.searchParams.get('mode');
  const modeValue = rawMode || 'work';
  const centerRaw = url.searchParams.get('center');
  if (
    rawQ.length > MAX_Q_LENGTH ||
    modeValue.length > MAX_MODE_LENGTH ||
    (centerRaw && centerRaw.length > MAX_CENTER_LENGTH)
  ) {
    return NextResponse.json(
      { code: 'PARAM_TOO_LARGE', message: 'one or more query parameters exceed their length limit' },
      { status: 400 }
    );
  }
  const mode = parseKnownMode(modeValue);
  if (!mode) {
    return NextResponse.json(
      { code: 'INVALID_MODE', message: `unknown mode: ${modeValue}` },
      { status: 400 },
    );
  }
  const q = rawQ.trim().toLowerCase();
  const center = parseCenter(centerRaw);
  // 响应 distance 按 center 计算：不同 center 的响应必须分桶缓存，否则 30s public TTL
  // 内会复用他人 center 计算出的距离。用解析后的有限数 center（与 distance 口径一致）。
  const centerKey = center ? `${center.lng},${center.lat}` : 'none';
  const cacheKey = publicCacheKey(['suggest', mode, q, centerKey]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const suggestions = [];

  if (q && isRecruitmentMode(mode)) {
    // Work autocomplete is SQL-backed and independently capped. Do not load the
    // complete catalog on a cache miss just to scan company/job text in JS.
    // Unlike loadServerCatalog, this path only asks Postgres for capped matches.
    const rows = await loadWorkSuggestionsFromDb(q, 10);
    const companyRows = rows?.filter((row) => row.kind === 'company') ?? [];
    const companyPoiIds = new Set(
      companyRows.map((row) => {
        const siteCount = Number(row.site_count);
        return siteCount === 1 ? row.slug : `${row.slug}:${row.site_id}`;
      }),
    );
    for (const row of rows ?? []) {
      const siteCount = Number(row.site_count);
      const poiId = siteCount === 1 ? row.slug : `${row.slug}:${row.site_id}`;
      const location = { lng: row.lng, lat: row.lat };
      if (row.kind === 'company') {
        suggestions.push({
          type: 'poi',
          id: poiId,
          title: row.company_name,
          subtitle: row.summary || (row.industries ?? []).join(' · '),
          icon: row.logo_emoji || '🏢',
          location,
          distance: center ? haversineDistance(location, center) : undefined,
        });
      } else if (!companyPoiIds.has(poiId)) {
        suggestions.push({
          type: 'position',
          id: row.position_id,
          title: `${row.company_name} · ${row.position_title}`,
          subtitle: row.department ? `${row.department} · ${row.education || ''}` : undefined,
          icon: '💼',
          // Preserve the public `poiId: poi.id` field shape for job rows.
          poiId,
          location,
          distance: center ? haversineDistance(location, center) : undefined,
        });
      }
    }
    const tags = suggestSearchTags(q, 6);
    const counts = await countWorkTagMatchesBatchFromDb(tags);
    tags.forEach((tag, index) => {
      suggestions.push({
        type: 'tag',
        id: tag.id,
        title: tag.title,
        subtitle: `${counts?.[index] ?? 0} 个公司`,
        icon: '🏷️',
      });
    });
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
