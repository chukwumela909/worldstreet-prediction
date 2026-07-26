import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { MarketEvent } from "@/types/market";
import { SiteHeader } from "@/components/nav/site-header";
import { LocalEvent } from "@/components/local/local-event";
import { getBayseEventBySlug } from "@/lib/bayse";
import { getWorldstreetEventBySlug } from "@/lib/worldstreet-markets";

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Detail page for a Local event of either origin — one of our own
 * fixed-odds markets, or a Bayse one. Live data only, same no-fixture
 * policy as /event/[slug]; unstable_cache dedupes the fetch between
 * generateMetadata and the page.
 *
 * Ours are checked first: slugs are unique within each source but
 * nothing stops the two from colliding, and a market we wrote should
 * win its own URL.
 */
async function loadEvent(slug: string): Promise<MarketEvent | null> {
  return (
    (await getWorldstreetEventBySlug(slug)) ?? (await getBayseEventBySlug(slug))
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadEvent(slug);
  return { title: event ? `${event.title} | Worldstreet` : "Worldstreet" };
}

export default async function LocalEventPage({ params }: Props) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) notFound();

  return (
    <>
      <SiteHeader activeCategory="local" />
      <LocalEvent event={event} />
    </>
  );
}
