// /api/me/memories — 用户个性化记忆(tech/30-agent-memory.md §5)。
// GET: 列表(guest → 空 items,仿 saved 路由范式);DELETE: 清除全部(guest → 401)。

import { NextResponse } from 'next/server';
import { readSessionUser } from '@/lib/http-session';
import { clearMemories, listMemories } from '@/lib/memory-store';

export async function GET() {
  const user = await readSessionUser();
  if (!user) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await listMemories(user.id) });
}

export async function DELETE() {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }
  await clearMemories(user.id);
  return NextResponse.json({ ok: true });
}
