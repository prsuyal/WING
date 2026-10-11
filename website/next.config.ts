import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  turbopack: { root: fileURLToPath(new URL("..", import.meta.url)) },
  devIndicators: false,
  images: { qualities: [75, 80] },
  logging: { incomingRequests: false },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
      {
        source: "/api/trips/:token",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};
export default config;
