import type { NextConfig } from "next";

// Map SDKs dynamically load scripts, styles, workers, tiles, and WebSocket/XHR
// endpoints from their vendor origins. Script origins are explicit; image and
// connection destinations remain network-open because tile/CDN hosts vary by
// engine and region. The policy still blocks plugin execution, framing, and
// form/base-URL hijacking.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data:",
  "font-src 'self' data: https://*.amap.com https://*.map.baidu.com https://map.qq.com https://*.map.qq.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.amap.com https://*.map.baidu.com https://map.qq.com https://*.map.qq.com",
  "style-src 'self' 'unsafe-inline' https://*.map.baidu.com https://*.amap.com https://map.qq.com https://*.map.qq.com",
  "connect-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `${CONTENT_SECURITY_POLICY}` },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
