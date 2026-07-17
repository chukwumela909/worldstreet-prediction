import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { PortfolioView } from "@/components/portfolio/portfolio-view";

export const metadata: Metadata = { title: "Portfolio | Worldstreet" };

export default function PortfolioPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1000px] px-4 pb-16 pt-6">
        <PortfolioView />
      </main>
    </>
  );
}
