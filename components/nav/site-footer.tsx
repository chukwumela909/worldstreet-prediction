import Link from "next/link";
import {
  ArrowUpIcon as ArrowUp,
  ArrowUpRightIcon as ArrowUpRight,
} from "@heroicons/react/24/outline";
import { LogoMark } from "@/components/home/hero/shared";
import { categoryHref } from "@/components/nav/category-icons";
import { CLERK_DOMAIN } from "@/lib/auth-config";

/**
 * Site footer: the WorldStreet Predict lockup with a back-to-top control,
 * four link columns, a fine-print row, and the purple domain fade along
 * the bottom edge. Every link is a real route; the one external link is
 * the central WorldStreet site the login already lives on.
 */
const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Markets",
    links: [
      { label: "Trending", href: categoryHref("trending") },
      { label: "Local", href: categoryHref("local") },
      { label: "Politics", href: categoryHref("politics") },
      { label: "Sports", href: categoryHref("sports") },
      { label: "Crypto", href: categoryHref("crypto") },
      { label: "Finance", href: categoryHref("finance") },
      { label: "Culture", href: categoryHref("culture") },
      { label: "Economy", href: categoryHref("economy") },
      { label: "Weather", href: categoryHref("weather") },
    ],
  },
  {
    title: "Discover",
    links: [
      { label: "Breaking", href: categoryHref("breaking") },
      { label: "World Cup", href: categoryHref("world-cup") },
      { label: "Esports", href: categoryHref("esports") },
      { label: "Tech & science", href: categoryHref("tech") },
      { label: "Geopolitics", href: categoryHref("geopolitics") },
      { label: "Leaderboard", href: "/leaderboard" },
    ],
  },
  {
    title: "Your WorldStreet",
    links: [
      { label: "Portfolio", href: "/portfolio" },
      { label: "Watchlist", href: "/portfolio?tab=watchlist" },
      { label: "Settled positions", href: "/portfolio?tab=settled" },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { label: "WorldStreet Gold", href: `https://www.${CLERK_DOMAIN}`, external: true },
    ],
  },
];

const LINK =
  "flex w-fit max-w-full items-baseline gap-2 py-1 font-mono text-xs leading-normal transition-colors hover:text-domain sm:text-sm before:h-2 before:w-3 before:shrink-0 before:self-center before:border-b before:border-l before:border-border-active before:content-[''] hover:before:border-domain";

export function SiteFooter() {
  return (
    <footer className="relative isolate mt-auto overflow-hidden border-t border-border bg-sunken text-secondary">
      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-4 pt-12 sm:px-6">
        <div className="mb-8 flex items-center justify-between gap-4 sm:mb-12">
          <Link
            href="/"
            aria-label="WorldStreet Predict home"
            className="flex flex-wrap items-center gap-2 text-base text-primary sm:text-xl"
          >
            <LogoMark className="size-8" />
            <strong>WorldStreet</strong>
            <em className="text-base not-italic text-domain sm:ml-2">Predict</em>
          </Link>
          <a
            href="#"
            aria-label="Back to top"
            className="grid size-9 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface hover:text-primary"
          >
            <ArrowUp className="size-4" />
          </a>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-8 lg:grid-cols-4">
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={`Footer ${col.title.toLowerCase()}`}>
              <h2 className="mb-4 text-xs font-semibold uppercase text-primary sm:mb-6">
                {col.title} /
              </h2>
              <ul className="grid gap-2">
                {col.links.map((l) => (
                  <li key={l.label} className="min-w-0">
                    {l.external ? (
                      <a href={l.href} className={LINK}>
                        {l.label}
                        <ArrowUpRight className="size-3 shrink-0 opacity-55" />
                      </a>
                    ) : (
                      <Link href={l.href} className={LINK}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap justify-end gap-4 border-t border-border py-6 text-xs">
          <small className="text-xs">&copy; 2026 WorldStreet</small>
        </div>
      </div>
      {/* the domain fade: sunken into Predict purple, masked at both ends */}
      <div
        aria-hidden="true"
        className="h-32 bg-[linear-gradient(to_bottom,var(--bg-sunken),color-mix(in_srgb,var(--domain-accent)_18%,var(--bg-sunken))_45%,color-mix(in_srgb,var(--domain-accent)_70%,var(--bg-sunken))_85%,var(--domain-accent))] [mask-image:linear-gradient(to_right,transparent,black_20%,black_80%,transparent)] sm:h-40"
      />
    </footer>
  );
}
