import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { LiveEvent } from "@/components/event/live-event";
import { getEventBySlug } from "@/lib/polymarket";
import type { MarketEvent } from "@/types/market";

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Live Gamma data only — no fixture fallback. unstable_cache dedupes the
 * request between generateMetadata and the page. An unreachable API
 * throws, surfacing the app error boundary rather than fake data.
 */
async function loadEvent(slug: string): Promise<MarketEvent | undefined> {
  return (await getEventBySlug(slug)) ?? undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadEvent(slug);
  return { title: event ? `${event.title} | Worldstreet` : "Worldstreet" };
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) notFound();

  return (
    <>
      <SiteHeader />
      <LiveEvent event={event} />
    </>
  );
}
