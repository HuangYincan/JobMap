// /api/me/memories — 用户个性化记忆(tech/30-agent-memory.md §5)。
// GET: 列表(guest → 空 items,仿 saved 路由范式);DELETE: 清除全部(guest → 401)。

import { NextResponse } from 'next/server';
import { readSessionUser } from '@/lib/http-session';
import { clearMemories, listMemories, removeMemory } from '@/lib/memory-store';

const MAX_MEMORY_ID_LENGTH = 128;

export async function GET() {
  const user = await readSessionUser();
  if (!user) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await listMemories(user.id) });
}

export async function DELETE(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }

  const memoryId = (new URL(request.url).searchParams.get('id') || '').trim();
  if (!memoryId) {
    await clearMemories(user.id);
    return NextResponse.json({ ok: true });
  }
  if (memoryId.length > MAX_MEMORY_ID_LENGTH) {
    return NextResponse.json(
      { code: 'MEMORY_ID_TOO_LONG', message: `memory id must be at most ${MAX_MEMORY_ID_LENGTH} chars` },
      { status: 400 },
    );
  }
  await removeMemory(user.id, memoryId);
  return NextResponse.json({ ok: true });
}
