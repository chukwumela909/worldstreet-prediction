import type { Metadata } from "next";
import { SiteHeader } from "@/components/nav/site-header";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";

export const metadata: Metadata = { title: "Leaderboard | Worldstreet" };

export default function LeaderboardPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1280px] px-6 pb-16 pt-6">
        <LeaderboardView />
      </main>
    </>
  );
}
