import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Polymarket market icons; keep in sync with ALLOWED_ICON_HOSTS
    // in lib/polymarket.ts
    remotePatterns: [
      {
        protocol: "https",
        hostname: "polymarket-upload.s3.us-east-2.amazonaws.com",
      },
    ],
  },
};

export default nextConfig;
