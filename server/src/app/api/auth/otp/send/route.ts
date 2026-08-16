import { NextResponse } from 'next/server';
import { issueOtp } from '@/lib/account-store';

/**
 * Demo: does not send SMS. Always issues code 000000 in memory.
 * Later: call Aliyun PNVS / SMS here. Do not log the code or secrets.
 */
export async function POST(request: Request) {
  let body: { provider?: 'phone' | 'email'; target?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const provider = body.provider === 'email' ? 'email' : 'phone';
  const target = (body.target || '').trim();
  if (!target) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'target required' }, { status: 400 });
  }
  if (provider === 'phone' && !/^\+?\d{6,15}$/.test(target.replace(/[\s-]/g, ''))) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid phone' }, { status: 400 });
  }
  if (provider === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid email' }, { status: 400 });
  }

  const { expiresAt } = await issueOtp(provider, target);
  return NextResponse.json({
    ok: true,
    provider,
    expiresAt,
    // Demo only — remove when Aliyun send is wired.
    demo: true,
    hint: '000000',
  });
}
