"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { EventComment } from "@/lib/polymarket";

/**
 * Vertical comments ticker, exactly Polymarket's mechanism (recon §9):
 * content rendered 3x inside an overflow-hidden window, animated
 * translateY(0 -> -33.333%) over 25s linear infinite; paused on hover.
 *
 * Shows the event's real comments — and shows nothing while they load
 * or if none survive filtering, rather than attributing invented
 * chatter to a real market.
 */

export function CommentsMarquee({ eventId }: { eventId: string }) {
  const [comments, setComments] = useState<EventComment[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/comments?eventId=${encodeURIComponent(eventId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body: { comments: EventComment[] }) => {
        if (!cancelled) setComments(body.comments ?? []);
      })
      .catch(() => {
        // no fabricated fallback for a live market — just go quiet
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // keep the flex slot so the slide layout doesn't jump
  if (!comments || comments.length === 0) {
    return <div className="mt-4 min-h-0 flex-1" />;
  }

  return (
    <div className="group/marquee relative mt-4 min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-16px),transparent)]">
      <div className="flex animate-marquee-vertical flex-col group-hover/marquee:[animation-play-state:paused]">
        {[0, 1, 2].map((copy) => (
          <div key={copy} className="flex shrink-0 flex-col gap-3 pb-3" aria-hidden={copy > 0}>
            {comments.map((c) => (
              <div key={c.id ?? c.user} className="flex gap-2">
                {c.avatarUrl ? (
                  <Image
                    src={c.avatarUrl}
                    alt=""
                    width={24}
                    height={24}
                    className="mt-0.5 size-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="mt-0.5 size-6 shrink-0 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, hsl(${c.hue} 60% 55%), hsl(${c.hue + 60} 60% 45%))`,
                    }}
                  />
                )}
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold leading-4">{c.user}</p>
                  <p className="line-clamp-2 text-[13px] leading-[18px] text-secondary">
                    {c.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
