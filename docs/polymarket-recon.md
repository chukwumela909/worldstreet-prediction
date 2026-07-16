# Polymarket UI Recon — Design Tokens & Component Specs

Extracted live from polymarket.com (2026-07-15, dark theme default) via computed styles.
This is the source of truth for the scaffold's token layer. Values are real, not eyeballed.

Polymarket itself uses a two-layer token system: **primitives** (`--neutral-*`, `--green-*`, …)
→ **semantic roles** (`--color-surface`, `--color-text-primary`, …). We mirror that architecture.

---

## 1. Color primitives — DARK theme (default)

### Neutral (bg → text ladder; 0 is darkest in dark mode)
| step | hex |
|------|-----|
| 0    | `#15191d` (page bg) |
| 50   | `#1e2428` (surface/card bg) |
| 100  | `#242b32` (borders, element bg 2) |
| 200  | `#2e3841` (border hover, element bg 3) |
| 300  | `#586879` (text tertiary) |
| 400  | `#697d91` |
| 500  | `#7b8996` (text secondary / muted labels) |
| 600  | `#97a5b4` |
| 700  | `#afbac5` |
| 800  | `#bbc4cd` |
| 900  | `#d2d8df` |
| 950  | `#dee3e7` (text primary) |

### Brand (bright blue accent — Trade button, links, active states)
50 `#132533` · 100 `#112f45` · 200 `#103957` · 300 `#0e446b` · 400 `#0b568d` · **500 `#0093fd`** · 600 `#26a3fd` · 700 `#59b9fe` · 800 `#8ccefe` · 900 `#b8e1fe`

### Blue (secondary blue — Sign Up button, info badges)
50 `#1c2f4b` · 100 `#1a366c` · 200 `#193d8d` · 300 `#1744ae` · 400 `#164bcf` · 500 `#1452f0` · 600 `#4475f3` · 700 `#7398f6` · 800 `#a3bcf9` · 900 `#d3dffc`

### Green (Yes)
50 `#1d3539` · 100 `#234f42` · 200 `#2a684b` · 300 `#308154` · **400 `#359a5e`** (selected solid) · **500 `#3db468`** (text/rest) · 600 `#5fbe82` · 700 `#83c89c` · 800 `#a6d2b6` · 900 `#c9ddd0`

### Red (No)
50 `#2d2833` · 100 `#4c2a32` · 200 `#6b2d32` · 300 `#8b2e32` · **400 `#ac3031`** (selected solid) · **500 `#cb3131`** (text/rest) · 600 `#d05959` · 700 `#d78282` · 800 `#ddaaaa` · 900 `#e2d1d1`

### Yellow
50 `#333c37` · 100 `#5a5933` · 200 `#81772e` · 300 `#a9952a` · 400 `#d0b226` · 500 `#f7d022` · 600 `#f8da52` · 700 `#fae483` · 800 `#fcefb5` · 900 `#fef9e6`

### Others (partial — enough for accents)
- purple: 500 `#7225b6` · 600 `#a261e1` · 700 `#ab75e4` · 800 `#b884e6`
- teal: 600 `#0595b3` · 800 `#05aacc`
- magenta: 600 `#ee2ba6` · 700 `#f84ab2`

### Alpha ladders
- white: 50 `#ffffff05` · 100 `#ffffff0d` · 200 `#ffffff17` · 300 `#ffffff1c` · 400 `#ffffff24` · 500 `#ffffff4a` · 600 `#ffffff7d` · 700 `#ffffff8c` · 800 `#ffffff96` · 900 `#ffffffeb`
- black: 50 `#00000003` · 100 `#0000000a` · 200 `#00000017` · 300 `#0000001f` · 400 `#00000026` · 500 `#0000005c` · 600 `#00000091` · 700 `#0000009e` · 800 `#000000a6` · 900 `#000000e0`

## 2. Color primitives — LIGHT theme

| token | hex |
|-------|-----|
| neutral-0 | `#ffffff` |
| neutral-50 | `#f4f5f6` |
| neutral-100 | `#e6e8ea` |
| neutral-200 | `#caced3` |
| neutral-300 | `#aeb4bc` |
| neutral-400 | `#939aa5` |
| neutral-500 | `#77808d` |
| neutral-600 | `#5f6772` |
| neutral-700 | `#484e56` |
| neutral-800 | `#31353a` |
| neutral-900 | `#1a1c1f` |
| neutral-950 | `#0e0f11` |
| brand-500 | `#1452f0` (!) — light mode brand is the classic Polymarket blue, not #0093fd |
| green-500 | `#42c772` |
| red-500 | `#e23939` |
| blue-500 | `#1652f0` |
| yellow-500 | `#f8d743` |

## 3. Semantic tokens (dark values)

| role | value | usage |
|------|-------|-------|
| `bg-page` | neutral-0 `#15191d` | body, nav |
| `bg-surface` | neutral-50 `#1e2428` | cards, inputs, search |
| `bg-element-2` | neutral-100 `#242b32` | chips, secondary buttons |
| `bg-element-3` | neutral-200 `#2e3841` | hover states |
| `border` | neutral-100 `#242b32` | default border |
| `border-hover` | neutral-200 `#2e3841` | |
| `border-active` | neutral-300 `#586879` | |
| `text-primary` | neutral-950 `#dee3e7` (some spots `#f9fafb`/`#e5e5e5`) | |
| `text-secondary` | neutral-500 `#7b8996` | muted labels, inactive tabs/pills |
| `text-tertiary` | neutral-300 `#586879` | volume labels |
| `accent` | brand-500 `#0093fd` | Trade btn, links, active |
| `accent-hover` | brand-600 `#26a3fd` | |
| `yes` | green-500 `#3db468` | |
| `yes-solid` | green-400 `#359a5e` | selected Buy Yes bg |
| `no` | red-500 `#cb3131` | |
| `no-solid` | red-400 `#ac3031` | selected Buy No bg |

Badges: success `#1d3539`/`#5fbe82` · error `#2d2833`/`#d05959` · warning `#333c37`/`#f8da52` · info `#1c2f4b`/`#4475f3`

Chart multi-outcome series palette (sampled from legend dots): `#87bfff`, `#4378ff`, `#fdc503` (more exist; extend with teal/magenta/purple when needed).

## 4. Typography

- **Primary**: Inter (next/font). Font features: `"liga" 1, "calt" 1, "cv01" 1, "cv02" 1, "cv03" 1, "cv04" 1, "cv09" 0, "cv11" 1, "cv15" 1`
- **Display** (available, used sparingly): "Open Sauce One"
- **Mono**: "Geist Mono"
- Body: 16px/24 w400. Negative letter-spacing on UI text (≈ -0.09px at 14px, -0.18px at 16px, -0.2px at 20px).

Scale (Tailwind-style): xs .75rem · sm .875rem · base 1rem · lg 1.125rem · xl 1.25rem · 2xl 1.5rem · 3xl 1.875rem · 4xl 2.25rem · 5xl 3rem · 6xl 3.75rem

Observed usages:
| element | spec |
|---------|------|
| card title | 14px/20 w~590 ls-0.09 `#e5e5e5` |
| card big % | 15px w600 (in-row) / 28px w600 (detail) |
| volume label | 13px/16 w~490 `#586879` |
| event h1 | 20px/24 w600 ls-0.2 |
| section tabs | 16px/20 w600 ls-0.18, active `#e5e5e5`, inactive `#7b8996` |
| buttons | 14px w600 ls-0.09 |
| quick chips | 12px w600 |

## 5. Radius

Base `--radius: .7rem` (11.2px):
- xs 5.2px · sm **7.2px** (Buy Yes/No buttons) · md **9.2px** (search, Trade btn, chips, pills) · lg 11.2px · xl **15.2px** (grid cards ≈16) · 2xl 16px · 3xl 24px · full **18px-height pills** (Log In / Sign Up, h32)

## 6. Shadows

- card: `0 8px 16px rgba(0,0,0,.04)`
- md: `0 8px 16px #0000000f`
- popover/large: `0 18px 60px #00000047`

## 7. Component specs (measured)

### Nav (116px total)
- Top bar ~60px: logo, search (h40, bg surface, radius 9.2, placeholder 14px, left icon inset 44px), "How it works" link (brand blue), Log In (ghost pill: border `#242b32`, h32, radius 18), Sign Up (solid `#164bcf` blue-400, h32, radius 18, w600), hamburger
- Category bar ~56px: pills 14px w600, inactive `#7b8996`, active `#e5e5e5`; icons on featured tabs (Trending, World Cup, Combos)

### Market card (home grid)
- ~299×180 @1600px viewport → grid is `repeat(auto-fill, minmax(~280px, 1fr))`, gap ~12–16px
- bg `#1e2428`, border 1px `#242b32`, radius 16, padding-top 12, flex col space-between
- shadow `0 8px 16px rgba(0,0,0,.04)`
- binary: icon + title + big % → Buy Yes / Buy No row → volume footer
- multi-outcome: icon + title → scrollable outcome rows (name + % + mini yes/no) → volume footer

### Binary-card gauge (measured 2026-07-16, live DOM + site JS)
- svg 58×34.04, viewBox `-29 -29 58 34.036`, `overflow: visible` — r=29 arc spanning **200°**
  (each end dips 10° below the horizontal), stroke-width 4.5, round caps
- fill grows from the left end; measured endpoints ⇒ fill ends at **(2p−7)°**, track resumes
  at **(2p+5)°** (≈12° visual gap); track = `neutral-200` dark (`#2e3841`)
- fill color, from the site's own bundle:
  `p<30 → red-500 · p<50 → amber-500 · else green-600`, with
  `stroke-opacity = |p−50|/50 × 0.45 + 0.55` (computed on unrounded p)
- amber-500 is Tailwind's default (`#f59e0b` ≈ `lab(72.7% 31.9 97.9)`); red-500/green-600
  are the ladder values above
- text: `%` 16px/20 w500 text-primary, horizontally centered, bottom edge flush with the
  svg bottom (sits inside the arc); "chance" 12px/16 w600 text-secondary directly below;
  whole block 58px wide, right-anchored in the card header

### Buy buttons (states confirmed)
| state | text | bg |
|-------|------|----|
| Yes rest | `#3db468` | green @ 15% opacity |
| Yes selected/hover | `#fff` | solid `#359a5e` |
| No rest | `#cb3131` | red @ 15% opacity |
| No selected | `#fff` | solid `#ac3031` |
- radius 7.2px, h40 (card) / 44–48 (detail rows), 14px w600

### Market detail page
- Breadcrumb (Sports · Soccer), h1 20px w600, legend: colored dot + outcome + %
- Big chance %: 28px w600; delta arrow + % in green/red
- Chart: line strokes via `currentColor`; series colors from palette above; timeframe toggles `1H 6H 1D 1W 1M ALL` 14px w600, inactive `#7b8996`, active `#dee3e7`
- Outcome rows: flag/icon, name, vol, big %, delta, Buy Yes n¢ / Buy No n¢
- Tabs below: Rules · Comments (n) · Top Holders · Activity — 16px w600
- Right rail trade panel (~306px, sticky): market header w/ icon; Buy/Sell tabs (active `#dee3e7`, inactive `#7b8996`); Market/Limit dropdown; Yes/No price toggle (selected = solid green w/ white text); Amount row ($0, huge right-aligned display); quick chips +$1/+$5/+$10/+$100 (bg `#242b32`, h30, radius 9.2, 12px w600 `#7b8996`); **Trade** button solid `#0093fd`, h43, radius 9.2, white text; ToS footnote

### Home layout
- Hero featured card (large, ~838px wide, radius 18) + right rail (promo banners, "Hot topics" ranked list w/ $vol + flame icon, "Explore all" ghost button)
- Below: "All markets" heading + search/filter icons + card grid

## 8. Notes for the rebrand layer

- Components must consume ONLY semantic tokens (`bg-surface`, `text-secondary`, `yes`, `no`, `accent`…)
- Dark = default theme (`data-theme="dark"` on html, same as Polymarket)
- Light theme swaps the primitive ladder (see §2) — brand intentionally differs per theme (`#0093fd` dark / `#1452f0` light)
- Worldstreet rebrand later = new primitive values + font swap, zero component changes

## 9. Motion + hero internals (extracted 2026-07-16, deep-inspected same day)

Measured from live CSS, DOM instance inspection, and MutationObserver traces:

| element | spec |
|---------|------|
| buttons (CTA, promo) | `color/background-color 0.12s cubic-bezier(0,0,0.2,1)` (= Tailwind `ease-out`) |
| category pills | `0.15s cubic-bezier(0.4,0,0.2,1)` (= Tailwind `ease-in-out`) |
| carousel dots | `all 0.3s cubic-bezier(0.4,0,0.2,1)` — active-dot width elongation animates |
| comments feed | CSS marquee: `@keyframes marquee-vertical { to { transform: translateY(-33.333%) } }`, `25s linear infinite`, content rendered ×3 |
| scroll fades | `pk-scroll-fade-*` keyframes driving CSS-var mask fades on scrollable strips |

### Hero carousel — true mechanism (MutationObserver-verified)

- ALL slides (10) stay mounted: `absolute inset-0 p-5 pb-4` inside an
  `absolute inset-0 overflow-hidden` viewport in the 908×480 card
  (bg `#181d21`, border `#242b32`, radius 18, shadow `0 4px 16px rgba(0,0,0,…)`).
- Each slide: `transform: translateX((i − active) × 100%)` (shortest-path wrap,
  e.g. slide 6 of 10 sits at −400%), `visibility: visible` ONLY for active ± 1,
  `transition: opacity 120ms ease-in` (no transform transition!).
- **Advancing is an instant transform swap** — a click rewrites the inline styles
  in one frame; there is NO sliding/fading animation of the card content.
- **No auto-advance observed** (~5 min watch, zero index changes) — moves only
  via dots and pager pills. Whole slide is wrapped by an `<a href="/event/…">`
  overlay (`absolute inset-0`).
- Pager pills: h40 rounded-full, bg surface `#1e2428`, hover `neutral-100`,
  text 16px/400 `#dee3e7`, chevron.
- Dots: 30px-tall hit areas (`-mx-1.5`, px-1.5), inner pill h6; active ≈26px
  wide, inactive 6px circles; `transition: all .3s`.

### Hero chart (SVG, 496×276, right column of market slide)

- Per series THREE stacked paths, identical `d`: casing `stroke-neutral-50` 2px
  → color 1.75px → color 2.75px on top (all opacity 1). Effective visual: 2.75px
  colored line; casing separates crossings. Colors this slide: `#FF5952` (red),
  `#87BFFF` (light blue).
- Data is dense (≈1 pt/px, `d` ≈ 20k chars): odds hold flat then jump —
  staircase comes from the data, drawn with linear-ish curve segments.
- End of each line: `<g class="pointer-events-none">` with TWO r=4 circles —
  one persistent at `opacity 0.6`, one pulse layer idling at
  `opacity 0; transform: scale(0)` (pings on live price updates),
  `transform-origin: 50% 50%; transform-box: fill-box`.
- Gridlines: `<line>` per y-tick, `stroke #586879` 1px, dasharray `1,3` (dotted).
- Y ticks: 0% → peak rounded up to multiple of 15 (peak 58 → 0/15/30/45/60),
  anchored right, 12px `#7b8996`.
- X ticks: weekly "Jun 21"-style labels inside plot bottom, anchor middle,
  12px `#2e3841` (very dim).
- Legend: 8px dot + name (secondary) + value with ONE decimal ("57.9%"), 13px.

### Hero market slide (left column)

- Header: icon 56px rounded-md, breadcrumb small secondary, title 24px/600 (an <a>).
- Outcome rows (top 2 only): flag image 30px radius 5.2 (rounded-xs), name 15px
  w450 `#e5e5e5`, big % 20px w600 right-aligned, hairline row borders.
- Below rows: comments marquee window ~224px (avatar 20px, name 13px `#e5e5e5`).
- Footer: "$4B Vol" left + "Ends Jul 20, 2026 · Polymarket" right, 13px w490 `#586879`.

### Other

- Swiper.js IS used for the small spread/total number pickers inside sports game
  cards (`speed: 300, slidesPerView: 'auto', no autoplay, no loop`) — NOT for the hero.
- Charts are SVG. Crosshair: dashed vertical line at hover x, timestamp label at
  top, per-series value pills (colored 3px left bar + name + %, dark surface bg),
  and the chart legend live-updates to the hovered point's values.
- "All markets" filter chips: active = brand-500 @ 20% bg (oklab), `#0093fd` text,
  radius 6px, h32, 14px/500, px-12; inactive = transparent bg, `#7b8996` text.
