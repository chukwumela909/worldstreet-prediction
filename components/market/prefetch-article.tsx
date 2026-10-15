"use client";

import { useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * An <article> that warms its market page the moment the pointer (or
 * focus) arrives. Links in view already prefetch the page's loading
 * skeleton; this fetches the page itself, so by the time the click lands
 * the data is usually there. Once per card — the router keeps the result
 * for the client cache's static period.
 */
export function PrefetchArticle({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const warmed = useRef(false);
  const warm = () => {
    if (warmed.current) return;
    warmed.current = true;
    router.prefetch(href);
  };

  return (
    <article className={className} onPointerEnter={warm} onFocus={warm} onTouchStart={warm}>
      {children}
    </article>
  );
}
