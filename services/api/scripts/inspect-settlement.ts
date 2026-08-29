/**
 * Read-only dossier for one settled market — what the book can actually
 * show when a user disputes a settlement.
 *
 *   npm run inspect:settlement -- "Fabrizio Romano"
 *
 * Takes a substring of the event title (as frozen onto positions at
 * trade time) and prints the Settlement record, the market's published
 * rules and dates, and every position it touched. Writes nothing.
 *
 * What it prints depends on origin, and that is the point: a Bayse
 * settlement carries the upstream outcome in `evidence`, while an
 * admin one carries only who declared it — see the note the script
 * prints when it finds the latter.
 */
import { connectDatabase, disconnectDatabase } from "../src/database.js";
import {
  Position,
  Settlement,
  WorldstreetEvent,
  WorldstreetMarket,
} from "../src/trading/models.js";

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG")}`;
const when = (d: unknown) =>
  d instanceof Date ? `${d.toISOString()}  (WAT ${new Date(d.getTime() + 3_600_000).toISOString().slice(11, 19)})` : "—";

const needle = process.argv[2];
if (!needle) {
  console.error('usage: npm run inspect:settlement -- "<event title substring>"');
  process.exit(1);
}

await connectDatabase();

const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const positions = await Position.find({
  eventTitle: { $regex: escaped, $options: "i" },
}).sort({ createdAt: 1 });

if (positions.length === 0) {
  console.log(`No positions found on an event matching "${needle}".`);
  await disconnectDatabase();
  process.exit(0);
}

const marketIds = [...new Set(positions.map((p) => p.marketId))];
console.log(`\n${positions.length} position(s) across ${marketIds.length} market(s).\n`);

for (const marketId of marketIds) {
  const mine = positions.filter((p) => p.marketId === marketId);
  const first = mine[0]!;

  console.log("=".repeat(72));
  console.log(`EVENT   ${first.eventTitle}   (${first.eventSlug})`);
  console.log(`MARKET  ${first.marketTitle}`);
  console.log(`        eventId=${first.eventId}  marketId=${marketId}`);

  const wsEvent = await WorldstreetEvent.findOne({ eventId: first.eventId });
  const wsMarket = await WorldstreetMarket.findOne({ marketId });
  console.log(`ORIGIN  ${wsEvent ? "worldstreet (desk-authored)" : "bayse (upstream)"}`);

  if (wsEvent) {
    console.log(`\n-- published dates --`);
    console.log(`closesAt        ${when(wsEvent.closesAt)}`);
    console.log(`resolutionDate  ${when(wsEvent.resolutionDate)}`);
    console.log(`resolutionSource ${wsEvent.resolutionSource || "—"}`);
    console.log(`eventStatus     ${wsEvent.status}`);
  }
  if (wsMarket) {
    console.log(`\n-- published rules (verbatim) --`);
    console.log(wsMarket.rules || "(empty)");
    console.log(`\nmarketStatus    ${wsMarket.status}`);
    console.log(`resolvedOutcome ${wsMarket.resolvedOutcomeId ?? "—"}`);
    console.log(`outcomes        ${wsMarket.outcomes.map((o) => `${o.label} @ ${naira(o.priceKobo)} [${o.outcomeId}]`).join("\n                ")}`);
  }

  const settlement = await Settlement.findOne({ marketId });
  console.log(`\n-- settlement record --`);
  if (!settlement) {
    console.log("NONE — this market has never been settled.");
  } else {
    console.log(`settledAt       ${when(settlement.get("createdAt"))}`);
    console.log(`source          ${settlement.source}`);
    console.log(`actor           ${settlement.actor}`);
    console.log(`voided          ${settlement.voided}`);
    console.log(`winningOutcome  ${settlement.winningOutcomeId ?? "—"}`);
    console.log(`positionsSettled ${settlement.positionsSettled}`);
    console.log(`payoutTotal     ${naira(settlement.payoutTotalKobo)}`);
    console.log(`evidence        ${JSON.stringify(settlement.evidence, null, 2)}`);
    if (settlement.source === "admin") {
      console.log(
        `\n! admin settlement: the only recorded basis is which admin declared\n` +
          `! the outcome and when. No count, source or cutoff was captured.`,
      );
    }
  }

  console.log(`\n-- positions (${mine.length}) --`);
  for (const p of mine) {
    console.log(
      `${String(p.createdAt instanceof Date ? p.createdAt.toISOString() : "").slice(0, 19)}  ` +
        `${p.authUserId}  ${p.outcomeLabel.padEnd(14)}  ` +
        `stake ${naira(p.stakeKobo).padEnd(12)} @ ${naira(p.priceKobo).padEnd(8)} ` +
        `→ ${p.status.toUpperCase().padEnd(7)} payout-if-won ${naira(p.potentialPayoutKobo)}`,
    );
  }
  console.log();
}

await disconnectDatabase();
