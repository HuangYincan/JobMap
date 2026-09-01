// Public site origin for OAuth redirect_uri.
//
// Production must configure PUBLIC_ORIGIN explicitly. Request URL and host
// headers are deployment input, not an authentication trust anchor, so they
// are deliberately available only for the safe non-production fallback.

export class PublicOriginConfigurationError extends Error {
  constructor(message = 'PUBLIC_ORIGIN must be a valid non-bind origin in production') {
    super(message);
    this.name = 'PublicOriginConfigurationError';
  }
}

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

  // Never let request-derived values select an OAuth redirect/error origin in
  // production. A missing or malformed PUBLIC_ORIGIN is an operator error and
  // must fail closed rather than redirecting an attacker-chosen host.
  if ((env.NODE_ENV ?? '').trim() === 'production') {
    throw new PublicOriginConfigurationError();
  }

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
