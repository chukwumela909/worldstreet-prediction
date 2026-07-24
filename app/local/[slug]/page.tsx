import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { LocalEvent } from "@/components/local/local-event";
import { getBayseEventBySlug } from "@/lib/bayse";

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Detail page for a Bayse (Local) event — live Relay data only, same
 * no-fixture policy as /event/[slug]. unstable_cache dedupes the fetch
 * between generateMetadata and the page.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getBayseEventBySlug(slug);
  return { title: event ? `${event.title} | Worldstreet` : "Worldstreet" };
}

export default async function LocalEventPage({ params }: Props) {
  const { slug } = await params;
  const event = await getBayseEventBySlug(slug);
  if (!event) notFound();

  return (
    <>
      <SiteHeader activeCategory="local" />
      <LocalEvent event={event} />
    </>
  );
}
