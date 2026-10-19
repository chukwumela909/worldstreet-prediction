import type { NextConfig } from "next";

/**
 * Browser security headers on every response.
 *
 * The Content-Security-Policy says where the page may load scripts from
 * and send data to: our own origin, the prediction API, and Clerk (its
 * script and frontend API, telemetry, and its bot check). Injected code
 * can't pull in an outside script or post what it reads — the admin
 * desk's access key sits in sessionStorage — to another server.
 *
 * Inline scripts stay allowed ('unsafe-inline'): App Router streams its
 * page data in inline scripts and the theme boot is one too, and the
 * nonce alternative would render every page per request — no static
 * shells or instant prefetched navigation (AGENTS.md). Images may come
 * from any https host: desk-made markets carry an icon URL of the
 * admin's choosing, and trader avatars can be anyone's.
 *
 * NEXT_PUBLIC_* values are fixed at build time, so the hosts are too.
 */
function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Where clerk-js loads from: `clerk.<satellite domain>` in production, the key's own host on a dev key. */
function clerkHosts(): string[] {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return [];
  const hosts = new Set<string>();
  const encoded = key.split("_")[2];
  if (encoded) {
    const frontendApi = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    if (/^[a-z0-9.-]+$/i.test(frontendApi)) hosts.add(`https://${frontendApi}`);
  }
  const domain = (process.env.NEXT_PUBLIC_CLERK_DOMAIN || "worldstreetgold.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  hosts.add(`https://clerk.${domain}`);
  return [...hosts];
}

const CLERK_PROTECT = "https://*.protect.clerk.com";
const TURNSTILE = "https://challenges.cloudflare.com";

function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV === "development";
  const clerk = clerkHosts();
  const api = origin(process.env.NEXT_PUBLIC_API_URL);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(dev ? ["'unsafe-eval'"] : []), // React's dev error overlay
      ...clerk,
      TURNSTILE,
      CLERK_PROTECT,
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(api ? [api] : []),
      ...clerk,
      "https://clerk-telemetry.com",
      "https://*.clerk-telemetry.com",
      CLERK_PROTECT,
    ],
    "frame-src": ["'self'", TURNSTILE, CLERK_PROTECT],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  // older browsers' version of frame-ancestors: no framing, so no clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // browsers only honour it over https; two years, as the preload list asks
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // no "X-Powered-By: Next.js" advertising the stack
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
