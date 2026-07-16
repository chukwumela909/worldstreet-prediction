import { CategoryBar } from "@/components/nav/category-bar";
import { TopNav } from "@/components/nav/top-nav";

/** Sticky page chrome shared by home and event pages. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 bg-page">
      <TopNav />
      <CategoryBar />
    </header>
  );
}
