// The reviewer workspace's browser code only ever calls same-origin
// `/api/review/...` — this proxy forwards those server-side to the real
// API. That's what lets the API skip a `cors` dependency entirely: the
// browser never makes a cross-origin request in the first place.
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/review/:path*', destination: `${apiBaseUrl}/review/:path*` }];
  },
};

export default nextConfig;
