import { Suspense } from "react";
import { CategoryBar, CategoryBarView } from "@/components/nav/category-bar";
import { TopNav } from "@/components/nav/top-nav";

/**
 * Sticky page chrome: the top nav over the category row. Rendered once by
 * the root layout (through SiteChrome), so it stays mounted across every
 * navigation — only the page below it swaps, and a loading skeleton can
 * appear under it the instant a link is clicked.
 *
 * The category row reads the URL's search params; on statically rendered
 * pages that has to sit behind Suspense, so the fallback is the same row
 * with no tab marked current.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-page">
      <TopNav />
      <Suspense fallback={<CategoryBarView />}>
        <CategoryBar />
      </Suspense>
    </header>
  );
}
