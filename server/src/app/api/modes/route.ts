// ============================================================
// GET /api/modes — 获取可用模式列表
//
// 遵循 tech/08-multi-mode-system.md API 设计。
// 数据源：前端 MODES 注册表（单一事实来源）。
// ============================================================

import { NextResponse } from 'next/server';
import { ACTIVE_MODES, ALL_MODES, MODES } from '@/lib/modes';

export function GET(request: Request) {
  const url = new URL(request.url);
  const includeAll = url.searchParams.get('all') === '1';

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

  return NextResponse.json({ modes });
}
