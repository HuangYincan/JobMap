import type { NextConfig } from "next";

// The home route is the map shell. Map SDKs dynamically load scripts, styles,
// workers, tiles, and remote logo/photo images from vendor origins. Keep those
// allowances on that route only: account/agent UI is rendered inside the home
// route today, so it intentionally inherits the map policy without changing
// its existing behavior.
const MAP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data:",
  "font-src 'self' data: https://*.amap.com https://*.map.baidu.com https://map.qq.com https://*.map.qq.com",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://*.amap.com https://*.map.baidu.com https://map.qq.com https://*.map.qq.com`,
  "style-src 'self' 'unsafe-inline' https://*.map.baidu.com https://*.amap.com https://map.qq.com https://*.map.qq.com",
  "connect-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
].join("; ");

// Non-map routes have no browser-side SDK contract. In particular, do not
// carry the map route's unsafe-inline/unsafe-eval allowances to API or future
// server-rendered account routes. Next's own generated assets remain same-origin.
const STRICT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' data:",
  "font-src 'self' data:",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
].join("; ");

type ResponseHeader = { key: string; value: string };

function securityHeaders(csp: string): ResponseHeader[] {
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    ...(process.env.NODE_ENV === "production"
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
      : []),
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      // Only the home route mounts MapShell (including its account and Agent
      // overlays), so this is the sole route that receives SDK allowances.
      {
        source: "/",
        headers: securityHeaders(MAP_CSP),
      },
      // `:path+` excludes `/` while covering API and future non-map routes.
      {
        source: "/:path+",
        headers: securityHeaders(STRICT_CSP),
      },
    ];
  },
};

export default nextConfig;
