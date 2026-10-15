import type { Metadata } from "next";
import {
  AdjustmentsVerticalIcon as SlidersVertical,
} from "@heroicons/react/24/outline";
import { ComingSoon } from "@/components/nav/coming-soon";

export const metadata: Metadata = { title: "Perps | WorldStreet" };

export default function PerpsPage() {
  return (
    <ComingSoon
      icon={SlidersVertical}
      title="Perpetuals are on their way"
      body="Go long or short crypto around the clock. Perpetual markets aren't open on WorldStreet yet — until they are, every prediction market is one tap away."
    />
  );
}
