import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Client router cache. `dynamic` is how long a page the visitor has
    // already seen is reused on the way back (default 0: every tab switch
    // and back-navigation re-rendered on the server); `static` covers full
    // prefetches — the hover warm-ups on cards and category tabs. Prices
    // still move: every board polls its quotes client-side, so a reused
    // page refreshes its numbers on the next tick.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  images: {
    // Upstream icons send no Cache-Control and their file names carry
    // hashes or ids, so an optimized copy can be kept a month instead of
    // the 4-hour default — fewer re-fetches of large originals (some Bayse
    // icons are over 1 MB) and a long browser max-age.
    minimumCacheTTL: 2678400,
    // Market icons; keep in sync with ALLOWED_ICON_HOSTS in
    // lib/polymarket.ts and lib/bayse.ts. img.clerk.com serves trader
    // avatars on the leaderboard.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "polymarket-upload.s3.us-east-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "assets.bayse.markets",
      },
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
};

export default nextConfig;
