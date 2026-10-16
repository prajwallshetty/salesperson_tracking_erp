/** @type {import('next').NextConfig} */

// Security headers (replaces the legacy Express `helmet()` middleware).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  // Geolocation is required by the salesperson field app; camera for receipt capture.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=()' },
];

const nextConfig = {
  reactStrictMode: false, // Leaflet maps do not tolerate double-mount in dev
  poweredByHeader: false,
  eslint: { dirs: ['src', 'tests', 'prisma', 'scripts'] },
  experimental: {
    // pdfkit reads its font metrics from disk at runtime and must not be bundled.
    serverComponentsExternalPackages: ['pdfkit', '@prisma/client', 'bcryptjs', 'redis', '@redis/client'],
  },
  async headers() {
    const headers = [...securityHeaders];
    if (process.env.NODE_ENV === 'production') {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });
    }
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
