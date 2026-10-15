import type { Metadata } from "next";
import {
  PortfolioView,
  type PortfolioTab,
} from "@/components/portfolio/portfolio-view";

export const metadata: Metadata = { title: "Portfolio | WorldStreet" };

const TABS: readonly PortfolioTab[] = ["open", "settled", "watchlist"];

type Props = {
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function PortfolioPage({ searchParams }: Props) {
  // ?tab=watchlist (the home sidebar's "View saved markets") opens that
  // section; anything else lands wherever the book says
  const { tab } = await searchParams;
  const initialTab = TABS.find((t) => t === tab) ?? null;

  return (
    <>
      <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        {/* keyed so a client-side hop to another ?tab= starts on that tab */}
        <PortfolioView key={initialTab ?? "default"} initialTab={initialTab} />
      </main>
    </>
  );
}
