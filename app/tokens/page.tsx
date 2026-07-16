/**
 * Token reference page — dev-only visual check that the token layer
 * (globals.css) is wired through Tailwind correctly.
 * Every class used here consumes a semantic or primitive token.
 */

const NEUTRALS = [
  "0", "50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950",
] as const;

const LADDERS = ["brand", "blue", "green", "red", "yellow"] as const;
const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"] as const;

// Tailwind needs literal class names — no runtime interpolation.
const LADDER_CLASSES: Record<string, string[]> = {
  neutral: [
    "bg-neutral-0", "bg-neutral-50", "bg-neutral-100", "bg-neutral-200",
    "bg-neutral-300", "bg-neutral-400", "bg-neutral-500", "bg-neutral-600",
    "bg-neutral-700", "bg-neutral-800", "bg-neutral-900", "bg-neutral-950",
  ],
  brand: [
    "bg-brand-50", "bg-brand-100", "bg-brand-200", "bg-brand-300", "bg-brand-400",
    "bg-brand-500", "bg-brand-600", "bg-brand-700", "bg-brand-800", "bg-brand-900",
  ],
  blue: [
    "bg-blue-50", "bg-blue-100", "bg-blue-200", "bg-blue-300", "bg-blue-400",
    "bg-blue-500", "bg-blue-600", "bg-blue-700", "bg-blue-800", "bg-blue-900",
  ],
  green: [
    "bg-green-50", "bg-green-100", "bg-green-200", "bg-green-300", "bg-green-400",
    "bg-green-500", "bg-green-600", "bg-green-700", "bg-green-800", "bg-green-900",
  ],
  red: [
    "bg-red-50", "bg-red-100", "bg-red-200", "bg-red-300", "bg-red-400",
    "bg-red-500", "bg-red-600", "bg-red-700", "bg-red-800", "bg-red-900",
  ],
  yellow: [
    "bg-yellow-50", "bg-yellow-100", "bg-yellow-200", "bg-yellow-300", "bg-yellow-400",
    "bg-yellow-500", "bg-yellow-600", "bg-yellow-700", "bg-yellow-800", "bg-yellow-900",
  ],
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Ladder({ name, steps }: { name: string; steps: readonly string[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-xs text-secondary">{name}</span>
      <div className="flex overflow-hidden rounded-md border border-border">
        {LADDER_CLASSES[name].map((cls, i) => (
          <div key={cls} className={`flex h-10 w-12 items-end justify-center pb-1 ${cls}`}>
            <span className="text-[9px] text-secondary mix-blend-difference">
              {steps[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TokensPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Design tokens</h1>
        <p className="mt-1 text-sm text-secondary">
          Live check of the token layer · values from docs/polymarket-recon.md
        </p>
      </header>

      <Section title="Color primitives">
        <div className="flex flex-col gap-2">
          <Ladder name="neutral" steps={NEUTRALS} />
          {LADDERS.map((l) => (
            <Ladder key={l} name={l} steps={STEPS} />
          ))}
        </div>
      </Section>

      <Section title="Semantic roles">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["bg-page", "bg-page border border-border"],
            ["bg-surface", "bg-surface"],
            ["bg-element-2", "bg-element-2"],
            ["bg-element-3", "bg-element-3"],
            ["accent", "bg-accent"],
            ["yes", "bg-yes"],
            ["no", "bg-no"],
            ["border-active", "bg-border-active"],
          ].map(([label, cls]) => (
            <div key={label} className="flex flex-col gap-1.5">
              <div className={`h-12 rounded-md ${cls}`} />
              <span className="text-xs text-secondary">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-6 text-sm">
          <span className="text-primary">text-primary</span>
          <span className="text-secondary">text-secondary</span>
          <span className="text-tertiary">text-tertiary</span>
          <span className="text-accent">text-accent</span>
        </div>
      </Section>

      <Section title="Buy-button state model">
        <div className="flex flex-wrap gap-3">
          <button className="h-10 rounded-sm bg-yes-tint px-4 text-sm font-semibold text-yes">
            Buy Yes 58.2¢
          </button>
          <button className="h-10 rounded-sm bg-yes-solid px-4 text-sm font-semibold text-white">
            Buy Yes 58.2¢
          </button>
          <button className="h-10 rounded-sm bg-no-tint px-4 text-sm font-semibold text-no">
            Buy No 41.9¢
          </button>
          <button className="h-10 rounded-sm bg-no-solid px-4 text-sm font-semibold text-white">
            Buy No 41.9¢
          </button>
          <button className="h-10 rounded-md bg-accent px-8 text-sm font-semibold text-white hover:bg-accent-hover">
            Trade
          </button>
        </div>
      </Section>

      <Section title="Radius scale (base .7rem)">
        <div className="flex flex-wrap items-end gap-3">
          {[
            ["xs 5.2", "rounded-xs"],
            ["sm 7.2 · buttons", "rounded-sm"],
            ["md 9.2 · inputs", "rounded-md"],
            ["lg 11.2", "rounded-lg"],
            ["xl 15.2 · cards", "rounded-xl"],
            ["2xl 16", "rounded-2xl"],
            ["3xl 24", "rounded-3xl"],
          ].map(([label, cls]) => (
            <div key={label} className="flex flex-col items-center gap-1.5">
              <div className={`h-16 w-24 border border-border-active bg-element-2 ${cls}`} />
              <span className="text-[10px] text-secondary">{label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Surfaces & shadows">
        <div className="flex flex-wrap gap-4">
          <div className="h-28 w-52 rounded-xl border border-border bg-surface p-3 shadow-card">
            <span className="text-xs text-secondary">card · shadow-card</span>
          </div>
          <div className="h-28 w-52 rounded-xl bg-surface p-3 shadow-popover">
            <span className="text-xs text-secondary">popover · shadow-popover</span>
          </div>
        </div>
      </Section>

      <Section title="Type scale (Inter + Polymarket font features)">
        <div className="flex flex-col gap-1">
          <span className="text-xs">text-xs — volume $103,371,986 Vol.</span>
          <span className="text-sm font-semibold">
            text-sm semibold — Will England win the 2026 FIFA World Cup?
          </span>
          <span className="text-base font-semibold">text-base semibold — Comments (3,713)</span>
          <span className="text-xl font-semibold tracking-tight">
            text-xl semibold — World Cup Winner
          </span>
          <span className="text-3xl font-semibold">58% chance</span>
        </div>
      </Section>

      <Section title="Chart series">
        <div className="flex gap-3">
          <div className="h-8 w-24 rounded-md bg-chart-1" />
          <div className="h-8 w-24 rounded-md bg-chart-2" />
          <div className="h-8 w-24 rounded-md bg-chart-3" />
        </div>
      </Section>
    </main>
  );
}
