<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project rules

Prediction market on live Polymarket and Bayse data, styled 1:1 on the WorldStreet prediction marketplace design (tokens v5.1). See README.md; docs/polymarket-recon.md covers the original Polymarket clone the data layer grew out of.

- **Components consume ONLY semantic tokens** (`bg-page`, `bg-surface`, `bg-sunken`, `text-primary`, `text-secondary`, `bg-yes-tint`, `text-yes`, `bg-accent`, `text-on-accent`, `text-accent-ink`, `text-domain`, `rounded-sm|md|xl`, `shadow-card`, ...) — never raw hex, never Tailwind default palette (it is disabled in app/globals.css).
- Token system lives in app/globals.css: Layer 1 primitives (`--neutral-*`, `--brand-*`, ...) → Layer 2 semantic (`--bg-page`, `--yes`, ...) → Tailwind `@theme inline` mapping. Rebrand = repoint primitives; components must never change.
- **Gold fills vs gold text.** The accent is WorldStreet gold (`#e2b43f`). A solid gold surface takes `text-on-accent` (near-black) — never `text-white`, which is about 1.9:1. Gold *copy or icons* use `text-accent-ink`, not `text-accent`: same gold in dark, a deep gold stop in light, where `#e2b43f` on near-white is under 2:1.
- Dark is the default theme (`html[data-theme="dark"]`); light overrides in `[data-theme="light"]`. Both carry the reference palette (dark: the prediction-shell surfaces `#0f0f0f` page / `#141414` card / `#222222` raised). Every ladder dark defines is pinned in light too — add a primitive to dark and you must decide what light does with it.
- Type: Instrument Sans + IBM Plex Mono. Tailwind's text scale is remapped to the reference's sizes — `text-xs` 12 (caption), `text-sm` 13.5 (UI, the body default), `text-base` 15 (body), `text-xl` 19 (heading), `text-3xl` 31 (display).
- Radius: buttons `rounded-sm` and inputs/chips `rounded-md` are 8px, cards `rounded-xl` are 12px. Filled buttons add the `pressable` utility (sheen + 1px press).
- Buy-button state model (trade panels): rest = `text-yes bg-yes-tint` / selected = `text-white bg-yes-solid` (same for no).
- Outcome quotes use components/market/outcome-quote.tsx. Board surfaces (cards, featured market): a `ProbabilityBar` in the outcome's tone (`YES_TONE`/`NO_TONE` for binary sides, else `outcomeTone(i)`, matching the chart's `--chart-n` line) and a `QuotePill` outlined in gold (`PILL_TONE`) — the bar identifies the outcome, the pill is the buy action. The market page's Yes/No buttons use `QuotePill variant="side"`: neutral outline, green/red text.
- Content width is `max-w-[1400px]` with `px-4 sm:px-6` gutters — header, footer and every page share it.
- **Navigation speed rules.** The header lives in the root layout (via `SiteChrome`) — pages never render `SiteHeader`, so it stays mounted while only the page swaps. Every dynamic route has a `loading.tsx` (skeletons in components/skeletons.tsx), which is what lets links prefetch an instant state. Pages don't await data at the top: each slow part sits in its own `<Suspense>`, keyed by the view when the view is a search param (home tabs), so a switch shows its skeleton at once. Home tabs warm each other's feeds with `after()`, and `getEventForPage` reuses events from recent lists. Measure on `next build` + `next start`, never dev.
- /tokens is the live token reference sheet.
