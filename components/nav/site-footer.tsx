import Link from "next/link";
import { LogoMark } from "@/components/home/hero/shared";

/** Minimal site footer — trust chrome until the full footer slice. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center justify-between gap-3 px-6 py-6 text-[13px] font-medium text-secondary sm:flex-row">
        <span className="flex items-center gap-1.5 text-primary">
          <LogoMark />
          <span className="font-semibold">Worldstreet</span>
          <span className="ml-1 font-normal text-tertiary">© 2026</span>
        </span>
        <nav className="flex items-center gap-5">
          <Link href="/" className="transition-colors hover:text-primary">
            Markets
          </Link>
          <a href="#" className="transition-colors hover:text-primary">
            How it works
          </a>
          <a href="#" className="transition-colors hover:text-primary">
            Terms of Use
          </a>
          <a href="#" className="transition-colors hover:text-primary">
            Privacy
          </a>
        </nav>
      </div>
    </footer>
  );
}
