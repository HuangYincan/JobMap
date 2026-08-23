import { NextResponse, type NextRequest } from 'next/server';

/**
 * Authenticated API payloads must not be retained by browsers or shared caches.
 * Avatar bytes intentionally keep their route-level private immutable policy.
 */
export function proxy(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: [
    '/api/auth/:path*',
    '/api/agent/:path*',
    '/api/me/applications/:path*',
    '/api/me/memories/:path*',
    '/api/me/notifications/:path*',
    '/api/me/saved/:path*',
    '/api/me/search-history/:path*',
  ],
};
