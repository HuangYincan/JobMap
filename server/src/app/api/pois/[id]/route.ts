// ============================================================
// GET /api/pois/[id] — POI 详情
//
// 遵循 tech/08-multi-mode-system.md：
//   ?mode=work 指定模式，跨模式 id 冲突时避免歧义
// ============================================================

import { NextResponse } from 'next/server';
import { INTERNSHIP_SEED } from '@/lib/seed-data';
import { isRecruitmentMode } from '@/lib/types';
import type { MapMode } from '@/lib/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'work') as MapMode;
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  if (isRecruitmentMode(mode)) {
    const poi = INTERNSHIP_SEED.find((p) => p.id === id);
    if (!poi) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: `POI ${id} not found` },
        { status: 404 }
      );
    }
    return NextResponse.json(poi);
  }

  // 其他模式：Phase 3+ 实现
  return NextResponse.json(
    { code: 'NOT_IMPLEMENTED', message: `mode ${mode} detail not implemented` },
    { status: 501 }
  );
}
