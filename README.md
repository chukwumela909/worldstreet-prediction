# worldstreet-prediction

A Polymarket-style prediction-market UI, built bit by bit in Next.js.

**Strategy**: faithful clone first, rebrand to Worldstreet later. All components
consume semantic design tokens only, so the rebrand is a token swap — see
[docs/polymarket-recon.md](docs/polymarket-recon.md) for the extracted design
system and [app/globals.css](app/globals.css) for the token layer.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4 (CSS-first config, tokens as CSS variables)
- Inter via `next/font`, dark theme default

## Run

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).
`/tokens` renders the design-token reference sheet.

## Roadmap

1. ✅ Scaffold + design tokens
2. Nav shell + market card + home grid
3. Market detail (chart, trade panel, outcome rows)
4. Portfolio · Activity · Leaderboard
5. Polish (skeletons, light theme, mobile) → rebrand
