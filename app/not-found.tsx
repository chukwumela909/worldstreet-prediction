import Link from "next/link";
import { SiteHeader } from "@/components/nav/site-header";

/** Branded 404 — unknown routes and unknown event slugs land here. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <p className="text-5xl">🔮</p>
        <h1 className="text-xl font-semibold tracking-tight">
          This market doesn&rsquo;t exist
        </h1>
        <p className="max-w-sm text-sm leading-6 text-secondary">
          The page you&rsquo;re looking for was moved, resolved, or never
          listed. The odds of finding it here are 0%.
        </p>
        <Link
          href="/"
          className="mt-2 flex h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Browse markets
        </Link>
      </main>
    </>
  );
}
