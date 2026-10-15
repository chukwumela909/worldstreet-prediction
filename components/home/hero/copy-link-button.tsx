"use client";

import { LinkIcon } from "@heroicons/react/24/outline";
import { showToast } from "@/lib/toast-store";

/** Copies an absolute link to `path` and confirms with a toast. */
export function CopyLinkButton({ path }: { path: string }) {
  return (
    <button
      type="button"
      aria-label="Copy market link"
      title="Copy market link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(path, location.origin).href);
          showToast("Market link copied", "success");
        } catch {
          // clipboard blocked (permissions, insecure context)
          showToast("Could not copy link. Open the market to share its URL.");
        }
      }}
      className="grid size-8 place-items-center rounded-md text-secondary transition-colors hover:bg-element-2 hover:text-primary"
    >
      <LinkIcon className="size-4" />
    </button>
  );
}
