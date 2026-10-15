import type { Metadata } from "next";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";

export const metadata: Metadata = { title: "Leaderboard | WorldStreet" };

export default function LeaderboardPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <LeaderboardView />
      </main>
    </>
  );
}
