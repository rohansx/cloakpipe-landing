# cloakpipe-landing

Marketing landing page and dashboard preview for CloakPipe — **Design V2** (Geist + JetBrains Mono, boxy dark/light theme, green/cyan accent).

Static multi-page site built with [Vite](https://vitejs.dev/). No framework — plain HTML/CSS/JS.

## Pages

| Route            | File             | What it is                                                        |
| ---------------- | ---------------- | ----------------------------------------------------------------- |
| `/`              | `index.html`     | Landing page — hero, pseudonymization story, platform, pricing.   |
| `/dashboard.html`| `dashboard.html` | Dashboard preview — live request stream, latency, policies, etc.  |

The two pages cross-link (hero "See it live" → dashboard; dashboard "Landing" → home).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # → dist/  (both pages)
npm run preview  # serve the production build locally
```

## Structure

```
cloakpipe-landing/
├── index.html          # landing markup
├── dashboard.html      # dashboard markup
├── src/
│   ├── styles.css      # landing styles
│   ├── main.js         # landing JS — theme toggle, hero bar chart, reveal-on-scroll, live counter
│   ├── dashboard.css   # dashboard styles
│   └── dashboard.js    # dashboard JS — theme toggle, latency chart, live feed, KPI tickers, toggles/tabs
├── public/favicon.svg
├── vite.config.ts      # multi-page (index + dashboard)
└── package.json
```

Theme preference persists in `localStorage` under `cp-theme`. Fonts load from Google Fonts.
