// ============================================================
// GET /api/modes — 获取可用模式列表
//
// 遵循 tech/08-multi-mode-system.md API 设计。
// 数据源：前端 MODES 注册表（单一事实来源）。
// ============================================================

import { NextResponse } from 'next/server';
import { ACTIVE_MODES, ALL_MODES, MODES } from '@/lib/modes';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';

export function GET(request: Request) {
  const url = new URL(request.url);
  const includeAll = url.searchParams.get('all') === '1';
  const cacheKey = publicCacheKey(['modes', includeAll]);
  const cached = readPublicCache<{ modes: unknown[] }>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const modes = (includeAll ? ALL_MODES : ACTIVE_MODES).map((id) => {
    const config = MODES[id];
    return {
      id,
      name: config.name,
      nameEn: config.nameEn,
      icon: config.icon,
      color: config.color,
      kind: config.kind,
      description: config.description,
    };
  });

  const body = { modes };
  writePublicCache(cacheKey, body);
  return NextResponse.json(body, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
