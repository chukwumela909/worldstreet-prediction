<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project rules

Polymarket UI clone, rebranded to Worldstreet. See README.md and docs/polymarket-recon.md.

- **Components consume ONLY semantic tokens** (`bg-page`, `bg-surface`, `text-primary`, `text-secondary`, `bg-yes-tint`, `text-yes`, `bg-accent`, `text-on-accent`, `rounded-sm|md|xl`, `shadow-card`, ...) — never raw hex, never Tailwind default palette (it is disabled in app/globals.css).
- Token system lives in app/globals.css: Layer 1 primitives (`--neutral-*`, `--brand-*`, ...) → Layer 2 semantic (`--bg-page`, `--yes`, ...) → Tailwind `@theme inline` mapping. Rebrand = repoint primitives; components must never change.
- **Never pair `bg-accent` with `text-white`** — use `text-on-accent`. The accent is Worldstreet gold (`#fecc2f`), on which white is 1.51:1. Any new solid-accent surface takes `text-on-accent`.
- Dark is the default theme (`html[data-theme="dark"]`); light overrides in `[data-theme="light"]`. Dark carries the Worldstreet palette (gold `--brand-*`, bronze `--blue-*`, warm `--neutral-*`); **light has not been rebranded** and pins the Polymarket values explicitly, because it is an override block over a now-gold `:root`. Add a primitive to dark and you must decide what light does with it.
- Buy-button state model: rest = `text-yes bg-yes-tint` / selected = `text-white bg-yes-solid` (same for no). Buttons `rounded-sm` (7.2px), inputs/chips `rounded-md` (9.2px), cards `rounded-xl` (15.2px).
- All measured specs (nav heights, card dims, type sizes) are in docs/polymarket-recon.md — check it before eyeballing.
- /tokens is the live token reference sheet.
