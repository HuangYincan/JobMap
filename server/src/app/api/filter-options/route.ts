// ============================================================
// GET /api/filter-options — 模式筛选器选项
//
// 遵循 tech/10-search-filter.md：
//   返回模式特定筛选器配置 + 动态选项（行业、规模等）
// ============================================================

import { NextResponse } from 'next/server';
import { MODES } from '@/lib/modes';
import type { MapMode } from '@/lib/types';

export function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') as MapMode | null;

  if (!mode || !MODES[mode]) {
    return NextResponse.json(
      { code: 'INVALID_MODE', message: `unknown mode: ${mode}` },
      { status: 400 }
    );
  }

  const config = MODES[mode];
  return NextResponse.json({
    mode,
    filters: config.filters,
    sortOptions: config.sortOptions,
    defaultSort: config.defaultSort,
  });
}
