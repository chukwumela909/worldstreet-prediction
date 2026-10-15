import Link from "next/link";
import type { HeroIcon } from "@/components/icons";

/**
 * Page body for a header section that has nothing behind it yet (Perps,
 * Live). Says so plainly and sends the visitor back to markets that do
 * exist, rather than showing sample data dressed up as live.
 */
export function ComingSoon({
  icon: Icon,
  title,
  body,
}: {
  icon: HeroIcon;
  title: string;
  body: string;
}) {
  return (
    <>
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 items-start justify-center px-4 pb-16 pt-6 sm:px-6 sm:pt-16">
        <section className="flex w-full max-w-lg flex-col items-center gap-4 rounded-xl border border-border bg-surface px-6 py-12 text-center shadow-card">
          <span className="grid size-12 place-items-center rounded-full bg-element-2 text-accent-ink">
            <Icon className="size-6" />
          </span>
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-secondary">
            Coming soon
          </span>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="max-w-sm text-sm text-secondary">{body}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link
              href="/"
              className="pressable flex h-9 items-center rounded-sm bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              Browse markets
            </Link>
            <Link
              href="/?category=trending"
              className="flex h-9 items-center rounded-sm border border-border bg-surface px-4 text-sm font-medium text-primary transition-colors hover:border-border-active hover:bg-element-2"
            >
              See what&apos;s trending
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
