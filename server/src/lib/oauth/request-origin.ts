// Public site origin for OAuth redirect_uri.
//
// `next start -H 0.0.0.0` plus ENV HOSTNAME=0.0.0.0 makes request.url
// `https://0.0.0.0:3000` behind Cloudflare. GitHub then rejects that
// redirect_uri. Prefer PUBLIC_ORIGIN, then forwarded/Host headers, and
// never keep a bind address (0.0.0.0 / ::) as the public origin.

export function parsePublicOriginEnv(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (isBindHostname(url.hostname)) return null;
  return url.origin;
}

export function isBindHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return host === '0.0.0.0' || host === '::';
}

function originFromHostHeader(hostHeader: string, protoHeader: string): string | null {
  const host = hostHeader.split(',')[0]?.trim();
  if (!host) return null;
  const proto = (protoHeader.split(',')[0]?.trim() || 'https').toLowerCase();
  if (proto !== 'http' && proto !== 'https') return null;
  let url: URL;
  try {
    url = new URL(`${proto}://${host}`);
  } catch {
    return null;
  }
  if (isBindHostname(url.hostname)) return null;
  return url.origin;
}

export function resolvePublicOrigin(input: {
  requestOrigin: string;
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = input.env ?? process.env;
  const configured = parsePublicOriginEnv(env.PUBLIC_ORIGIN);
  if (configured) return configured;

  let requestHost = '';
  try {
    requestHost = new URL(input.requestOrigin).hostname;
  } catch {
    requestHost = '';
  }
  if (requestHost && !isBindHostname(requestHost)) {
    return input.requestOrigin;
  }

  const proto = input.forwardedProto ?? '';
  return (
    originFromHostHeader(input.forwardedHost ?? '', proto) ??
    originFromHostHeader(input.host ?? '', proto || 'https') ??
    input.requestOrigin
  );
}

export function publicOriginFromRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolvePublicOrigin({
    requestOrigin: new URL(request.url).origin,
    host: request.headers.get('host'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    forwardedProto: request.headers.get('x-forwarded-proto'),
    env,
  });
}
