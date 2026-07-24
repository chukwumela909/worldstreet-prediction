import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Market icons; keep in sync with ALLOWED_ICON_HOSTS in
    // lib/polymarket.ts and lib/bayse.ts
    remotePatterns: [
      {
        protocol: "https",
        hostname: "polymarket-upload.s3.us-east-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "assets.bayse.markets",
      },
    ],
  },
};

export default nextConfig;
