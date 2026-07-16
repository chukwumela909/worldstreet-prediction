import { ChevronRight, Flame } from "lucide-react";
import { HOT_TOPICS } from "@/lib/mock-home";

/**
 * Right rail (362px @1280): two promo cards (102px, radius 20, ink palette),
 * Hot topics ranked list, Explore all pill. Specs from homepage recon.
 */
export function PromoRail() {
  return (
    <aside className="hidden w-[362px] shrink-0 flex-col lg:flex">
      {/* Perps promo */}
      <PromoCard
        title="Perps are here"
        body="Go long or short an asset with leverage up to 20x"
        cta="Start trading"
        ctaClass="bg-ink-50 text-ink-text"
        art={<span>🪙</span>}
      />

      {/* Combo promo */}
      <div className="mt-3">
        <PromoCard
          title="Combo Cup"
          body="Build a crazy combo, get paid up to $50K daily"
          cta="Get started"
          ctaClass="bg-promo-purple text-promo-purple-text"
          art={<span>🏆</span>}
          purple
        />
      </div>

      {/* Hot topics */}
      <div className="mt-4">
        <button className="flex w-full items-center gap-1 py-1 text-base font-semibold">
          Hot topics
          <ChevronRight className="size-4 text-secondary" strokeWidth={2.5} />
        </button>
        <ul>
          {HOT_TOPICS.map((t) => (
            <li key={t.rank}>
              <button className="group flex h-[46px] w-full items-center gap-3 text-left">
                <span className="w-4 text-sm font-semibold text-tertiary">
                  {t.rank}
                </span>
                <span className="flex-1 truncate text-sm font-medium">
                  {t.name}
                </span>
                <span className="text-[13px] font-medium tracking-tight text-secondary">
                  {t.volumeToday} today
                </span>
                <Flame className="size-4 fill-flame text-flame" />
                <ChevronRight className="size-4 text-tertiary group-hover:text-secondary" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Explore all */}
      <button className="mt-4 h-10 w-full rounded-full border border-border text-sm font-semibold text-primary transition-colors hover:border-border-hover hover:bg-surface">
        Explore all
      </button>
    </aside>
  );
}

function PromoCard({
  title,
  body,
  cta,
  ctaClass,
  art,
  purple = false,
}: {
  title: string;
  body: string;
  cta: string;
  ctaClass: string;
  art: React.ReactNode;
  purple?: boolean;
}) {
  return (
    <div
      className={`relative h-[102px] overflow-hidden rounded-[20px] border border-ink-100 ${
        purple
          ? "bg-[linear-gradient(105deg,var(--ink-0)_40%,var(--purple-200)_115%)]"
          : "bg-gradient-to-t from-ink-0 to-ink-50"
      }`}
    >
      {/* art peeks over the top edge, left of the CTA */}
      <span
        aria-hidden
        className="absolute -top-1.5 right-[124px] rotate-12 text-3xl opacity-90"
      >
        {art}
      </span>
      <div className="relative flex h-full items-center justify-between px-[21px]">
        <div>
          <p className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink-text">
            {purple && <span className="text-sm leading-none">🟪</span>}
            {title}
          </p>
          <p className="mt-1 max-w-[200px] text-sm leading-[18px] text-secondary">
            {body}
          </p>
        </div>
        <button
          className={`h-8 shrink-0 self-center whitespace-nowrap rounded-full px-3.5 text-sm font-semibold ${ctaClass}`}
        >
          {cta}
        </button>
      </div>
    </div>
  );
}
