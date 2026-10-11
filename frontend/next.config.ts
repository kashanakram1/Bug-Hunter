import type { NextConfig } from "next";
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(process.cwd(), '..'),
  turbopack: { root: resolve(process.cwd(), '..') },
  images: { unoptimized: true },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};

export default nextConfig;
