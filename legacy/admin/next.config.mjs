/** @type {import('next').NextConfig} */
const rawBackendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const backendUrl = rawBackendUrl.replace(/\/+$/, '');

const nextConfig = {
  reactStrictMode: false, // Prevents double mounting with Leaflet maps
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
