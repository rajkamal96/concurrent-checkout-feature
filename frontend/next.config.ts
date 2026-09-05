import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy /api/* calls to the Express backend so the frontend
  // never has to hardcode localhost:3001 in client-side code.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/:path*",
      },
    ];
  },
};

export default nextConfig;
