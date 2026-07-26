import Link from "next/link";
import type { ReactNode } from "react";
import { MapPin, TrendingUp, Zap } from "lucide-react";
import { CATEGORY_TABS, DEFAULT_CATEGORY } from "@/lib/categories";
import { ScrollStrip } from "@/components/scroll-strip";

/**
 * Category pill bar (~56px) below the top nav — a slider strip with
 * chevron pagers when the pills overflow. Each pill links to the home
 * page scoped to its own live query (`/?category=...`).
 * Inactive pills text-secondary, active text-primary; 14px semibold.
 *
 * Tabs are addressed by param, never by position. This used to destructure
 * `[trending, worldCup, breaking, ...rest]` off CATEGORY_TABS, which had
 * since grown a `local` entry in second place — so every decoration sat one
 * tab to its left: Local wore the World Cup's football, the World Cup wore
 * Breaking's bolt, and Breaking fell through to the plain list with
 * nothing. Naming them means adding a tab can't shift anyone's identity.
 */

/** Pills that lead the strip, before the featured group. */
const LEAD = ["trending", DEFAULT_CATEGORY] as const;
/** The promoted cluster between the dividers. */
const FEATURED = ["world-cup", "breaking"] as const;

const ICONS: Record<string, ReactNode> = {
  trending: <TrendingUp className="size-4" strokeWidth={2.5} />,
  local: <MapPin className="size-4" strokeWidth={2.5} />,
  "world-cup": <span className="text-base leading-none">⚽</span>,
  breaking: <Zap className="size-4 text-yellow-500" strokeWidth={2.5} />,
};

/**
 * Permanently tinted rather than active/inactive — it is a promoted
 * event, not a place you are. Local deliberately isn't on this list: it is
 * the landing tab, so it is the one pill that most needs to show whether
 * it's the current view.
 */
const PROMOTED = new Set(["world-cup"]);

export function CategoryBar({ active = DEFAULT_CATEGORY }: { active?: string }) {
  const byParam = new Map(CATEGORY_TABS.map((t) => [t.param, t]));
  const pick = (params: readonly string[]) =>
    params.map((p) => byParam.get(p)).filter((t) => t !== undefined);

  const lead = pick(LEAD);
  const featured = pick(FEATURED);
  const rest = CATEGORY_TABS.filter(
    (t) =>
      !(LEAD as readonly string[]).includes(t.param) &&
      !(FEATURED as readonly string[]).includes(t.param),
  );

  const pill = (isActive: boolean, extra = "") =>
    `flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold transition-colors ${
      extra || (isActive ? "text-primary" : "text-secondary hover:text-primary")
    }`;

  // the default tab IS the bare "/", so it must not also be reachable at
  // ?category=<default> — that would be two URLs for the landing page,
  // and the pill would fail its own active check on one of them
  const href = (param: string) =>
    param === DEFAULT_CATEGORY ? "/" : `/?category=${param}`;

  const tabLink = (param: string, label: string) => (
    <Link
      key={param}
      href={href(param)}
      className={pill(
        active === param,
        PROMOTED.has(param)
          ? active === param
            ? "text-yellow-500"
            : "text-yellow-500 hover:text-yellow-600"
          : "",
      )}
    >
      {ICONS[param]}
      {label}
    </Link>
  );

  return (
    <nav className="mx-auto flex h-14 w-full max-w-[1280px] items-center px-6">
      {/* -ml pulls the first pill's padding back so its label lines up with
          the logo and the page content, not the pill's hover box */}
      <ScrollStrip className="-ml-2.5 items-center gap-1">
        {lead.map((t) => tabLink(t.param, t.label))}

        {/* featured group, then divider, like the real site */}
        <span className="mx-1.5 flex items-center gap-1.5">
          <button className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold text-secondary hover:text-primary">
            <span className="text-base leading-none">🎛️</span>
            Combos
          </button>
          {featured.map((t) => tabLink(t.param, t.label))}
          <span className="h-4 w-px bg-border-active/40" />
        </span>

        {rest.map((t) => tabLink(t.param, t.label))}
      </ScrollStrip>
    </nav>
  );
}
