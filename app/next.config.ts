import type { NextConfig } from "next";

// In dev, proxy same-origin /api/* calls to the Fastify backend so the browser
// never makes a cross-origin request (no CORS needed locally). In production,
// point the frontend at the API directly via NEXT_PUBLIC_API_BASE_URL and rely
// on @fastify/cors (WEB_ORIGIN) on the backend.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
