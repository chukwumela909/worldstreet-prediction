import type { Metadata } from "next";
import {
  BoltIcon as Zap,
} from "@heroicons/react/24/outline";
import { ComingSoon } from "@/components/nav/coming-soon";

export const metadata: Metadata = { title: "Live | WorldStreet" };

export default function LivePage() {
  return (
    <ComingSoon
      icon={Zap}
      title="Live markets are on their way"
      body="In-play markets with live scores will show up here. Until then, the Sports tab has today's games and their prices."
    />
  );
}
