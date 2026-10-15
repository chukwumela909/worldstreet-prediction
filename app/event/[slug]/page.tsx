import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LiveEvent } from "@/components/event/live-event";
import { getEventForPage } from "@/lib/polymarket";
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
  return (await getEventForPage(slug)) ?? undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadEvent(slug);
  return { title: event ? `${event.title} | WorldStreet` : "WorldStreet" };
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) notFound();

  return (
    <>
      <LiveEvent event={event} />
    </>
  );
}
